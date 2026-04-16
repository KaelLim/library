import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  getBooksCategories,
  getBooksCategoryBySlug,
  insertBook,
  getBooks,
  getBookById,
  updateBook,
  deleteBook,
  uploadBookPdf,
  uploadBookThumbnail,
  getBooksWithoutThumbnail,
  downloadBookPdf,
  insertAuditLog,
  broadcastBookUploadProgress,
} from '../services/supabase.js';
import { compressPdf, extractPdfThumbnail, isQpdfAvailable } from '../services/pdf-compressor.js';

const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

/** 檢查是否為支援的圖片格式（JPEG / PNG / WebP magic bytes） */
function isSupportedImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) return true;
  // WebP: 'RIFF' ... 'WEBP'
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) return true;
  return false;
}

/** 將封面圖片統一轉為 JPEG（最大寬 1200px、品質 85） */
async function normalizeCover(buf: Buffer): Promise<Buffer> {
  return await sharp(buf)
    .rotate() // 依 EXIF 方向自動轉正
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

export const bookRoutes: FastifyPluginAsync = async (fastify) => {
  // 取得所有電子書分類
  fastify.get('/categories', async () => {
    const categories = await getBooksCategories();
    return { success: true, categories };
  });

  // 取得所有電子書
  fastify.get<{
    Querystring: { category_id?: string; limit?: string; offset?: string };
  }>('/', async (request) => {
    const { category_id, limit, offset } = request.query;
    const books = await getBooks({
      categoryId: category_id ? parseInt(category_id, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return { success: true, books };
  });

  // 取得單一電子書
  fastify.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const bookId = parseInt(request.params.id, 10);
    const book = await getBookById(bookId);

    if (!book) {
      return reply.status(404).send({
        error: 'BOOK_NOT_FOUND',
        message: `Book ${bookId} not found`,
      });
    }

    return { success: true, book };
  });

  // 創建電子書（非同步 202 模式：接收檔案後背景處理）
  fastify.post('/create', { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    // --- 同步部分：遍歷 multipart parts（支援 pdf_file 必填 + cover_file 可選） ---
    const fields: Record<string, string> = {};
    let rawPdfBuffer: Buffer | null = null;
    let pdfFilename = '';
    let coverBuffer: Buffer | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          const buf = Buffer.concat(chunks);

          if (part.fieldname === 'pdf_file') {
            rawPdfBuffer = buf;
            pdfFilename = part.filename;
          } else if (part.fieldname === 'cover_file') {
            if (buf.length > MAX_COVER_SIZE) {
              return reply.status(400).send({
                error: 'COVER_TOO_LARGE',
                message: `封面檔案超過上限 ${MAX_COVER_SIZE / 1024 / 1024}MB`,
              });
            }
            if (!isSupportedImage(buf)) {
              return reply.status(400).send({
                error: 'INVALID_COVER',
                message: '封面必須是 JPG、PNG 或 WebP 格式',
              });
            }
            coverBuffer = buf;
          }
          // 忽略其他未知檔案欄位
        } else if (part.type === 'field') {
          const v = (part as { value: unknown }).value;
          if (typeof v === 'string') fields[part.fieldname] = v;
        }
      }
    } catch (err) {
      request.log.error(err);
      return reply.status(400).send({
        error: 'UPLOAD_ERROR',
        message: err instanceof Error ? err.message : '檔案讀取失敗',
      });
    }

    if (!rawPdfBuffer) {
      return reply.status(400).send({
        error: 'MISSING_FILE',
        message: 'PDF file is required',
      });
    }

    const title = fields.title;
    if (!title) {
      return reply.status(400).send({
        error: 'MISSING_TITLE',
        message: 'title is required',
      });
    }

    // Validate PDF magic bytes
    if (rawPdfBuffer.length < 4 || rawPdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
      return reply.status(400).send({
        error: 'INVALID_PDF',
        message: '上傳的檔案不是有效的 PDF',
      });
    }

    const taskId = randomUUID();
    const filename = pdfFilename;

    // 立即回 202 Accepted
    reply.status(202).send({
      success: true,
      message: '檔案已接收，後台處理中',
      task_id: taskId,
      title,
    });

    // --- 非同步部分：背景處理 ---
    (async () => {
      try {
        // 0. 壓縮 PDF
        const VALID_QUALITIES = ['screen', 'ebook', 'printer', 'prepress'] as const;
        type Quality = (typeof VALID_QUALITIES)[number];
        const rawQuality = fields.compression_quality;
        const compressionQuality: Quality = VALID_QUALITIES.includes(rawQuality as Quality)
          ? (rawQuality as Quality)
          : 'ebook';
        const skipCompression = fields.skip_compression === 'true';

        let pdfBuffer: Buffer = rawPdfBuffer;
        let compressionInfo: { originalSize: number; compressedSize: number; ratio: number } | null = null;

        if (!skipCompression) {
          await broadcastBookUploadProgress(taskId, { step: 'compressing', progress: '壓縮 PDF 中...' });
          console.log('[Books] Compressing PDF...');
          const compressed = await compressPdf(rawPdfBuffer, { quality: compressionQuality });
          pdfBuffer = Buffer.from(compressed.buffer);
          compressionInfo = {
            originalSize: compressed.originalSize,
            compressedSize: compressed.compressedSize,
            ratio: compressed.ratio,
          };
          console.log(`[Books] Compression: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB (${(compressed.ratio * 100).toFixed(1)}%)`);
        }

        // 1. 上傳 PDF 到 Supabase Storage
        await broadcastBookUploadProgress(taskId, { step: 'uploading', progress: '上傳 PDF 中...' });
        console.log('[Books] Uploading PDF to storage...');
        const storageResult = await uploadBookPdf(pdfBuffer, filename);
        console.log(`[Books] PDF uploaded: ${storageResult.path}`);

        // 1.5 產生縮圖：優先使用使用者上傳的封面，否則擷取 PDF 第一頁
        let thumbnailUrl = fields.thumbnail_url || null;
        if (!thumbnailUrl) {
          const uuid = storageResult.path.replace(/^books\//, '').replace(/\.pdf$/, '');
          let thumbBuffer: Buffer | null = null;

          if (coverBuffer) {
            await broadcastBookUploadProgress(taskId, { step: 'thumbnail', progress: '處理封面中...' });
            console.log('[Books] Using uploaded cover image');
            thumbBuffer = await normalizeCover(coverBuffer);
          } else {
            await broadcastBookUploadProgress(taskId, { step: 'thumbnail', progress: '從 PDF 擷取封面中...' });
            console.log('[Books] Extracting thumbnail from PDF first page');
            thumbBuffer = await extractPdfThumbnail(pdfBuffer);
          }

          if (thumbBuffer) {
            thumbnailUrl = await uploadBookThumbnail(thumbBuffer, uuid);
            console.log(`[Books] Thumbnail saved: ${thumbnailUrl}`);
          }
        }

        // 2. 取得分類資訊
        let categoryId: number | undefined;
        if (fields.category_id) {
          categoryId = parseInt(fields.category_id, 10);
        } else if (fields.category_slug) {
          const category = await getBooksCategoryBySlug(fields.category_slug);
          if (category) {
            categoryId = category.id;
          }
        }

        // 3. 寫入資料庫
        await broadcastBookUploadProgress(taskId, { step: 'saving', progress: '寫入資料庫中...' });
        const book = await insertBook({
          category_id: categoryId || null,
          book_id: storageResult.uuid,
          title,
          introtext: fields.introtext || fields.description || null,
          catalogue: fields.catalogue || null,
          author: fields.author || null,
          author_introtext: fields.author_introtext || null,
          publisher: fields.publisher || null,
          book_date: fields.book_date || null,
          isbn: fields.isbn || null,
          pdf_path: storageResult.path,
          thumbnail_url: thumbnailUrl,
          language: fields.language || 'zh-TW',
          turn_page: (fields.turn_page as 'left' | 'right') || 'left',
          copyright: fields.copyright || null,
          download: fields.download !== 'false',
          online_purchase: fields.online_purchase || null,
          publish_date: fields.publish_date || null,
        });

        console.log(`[Books] Book record created: ${book.id}`);

        // 4. 記錄 audit log
        await insertAuditLog({
          user_email: fields.user_email || null,
          action: 'create_book',
          table_name: 'books',
          record_id: book.id,
          old_data: null,
          new_data: { title },
          metadata: {
            pdf_path: storageResult.path,
            compression: compressionInfo,
            cover_source: coverBuffer ? 'uploaded' : 'pdf_first_page',
          },
        });

        // 5. 廣播完成
        await broadcastBookUploadProgress(taskId, {
          step: 'completed',
          progress: '電子書建立成功',
          book: {
            id: book.id,
            book_id: book.book_id,
            title: book.title,
            thumbnail_url: book.thumbnail_url,
            pdf_path: book.pdf_path,
          },
        });
      } catch (error) {
        console.error('[Books] Background processing error:', error);
        await broadcastBookUploadProgress(taskId, {
          step: 'failed',
          error: error instanceof Error ? error.message : '電子書建立失敗',
        }).catch(() => {});
      }
    })().catch(() => {});
  });

  // 更新電子書
  fastify.put<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const bookId = parseInt(request.params.id, 10);
    const updates = request.body;

    try {
      const book = await updateBook(bookId, updates as any);
      return { success: true, book };
    } catch (error) {
      return reply.status(500).send({
        error: 'BOOK_UPDATE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 更新電子書封面（單獨 multipart 端點）
  fastify.post<{ Params: { id: string } }>(
    '/:id/cover',
    { preHandler: [requireAuth], config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const bookId = parseInt(request.params.id, 10);
      const book = await getBookById(bookId);
      if (!book) {
        return reply.status(404).send({
          error: 'BOOK_NOT_FOUND',
          message: `Book ${bookId} not found`,
        });
      }

      let coverBuffer: Buffer | null = null;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file' && part.fieldname === 'cover_file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            const buf = Buffer.concat(chunks);
            if (buf.length > MAX_COVER_SIZE) {
              return reply.status(400).send({
                error: 'COVER_TOO_LARGE',
                message: `封面檔案超過上限 ${MAX_COVER_SIZE / 1024 / 1024}MB`,
              });
            }
            if (!isSupportedImage(buf)) {
              return reply.status(400).send({
                error: 'INVALID_COVER',
                message: '封面必須是 JPG、PNG 或 WebP 格式',
              });
            }
            coverBuffer = buf;
          }
        }
      } catch (err) {
        request.log.error(err);
        return reply.status(400).send({
          error: 'UPLOAD_ERROR',
          message: err instanceof Error ? err.message : '封面讀取失敗',
        });
      }

      if (!coverBuffer) {
        return reply.status(400).send({
          error: 'MISSING_COVER',
          message: 'cover_file is required',
        });
      }

      // 取得用於 thumbnail 檔名的 UUID（優先用 book_id，否則從 pdf_path 推導）
      let uuid = book.book_id;
      if (!uuid && book.pdf_path) {
        uuid = book.pdf_path.replace(/^books\//, '').replace(/\.pdf$/, '');
      }
      if (!uuid) {
        return reply.status(400).send({
          error: 'NO_BOOK_UUID',
          message: '此書籍沒有 book_id 或 pdf_path，無法更新封面',
        });
      }

      try {
        const jpeg = await normalizeCover(coverBuffer);
        const thumbnailUrl = await uploadBookThumbnail(jpeg, uuid);
        const updated = await updateBook(bookId, { thumbnail_url: thumbnailUrl });

        await insertAuditLog({
          user_email: (request as any).user?.email || null,
          action: 'update_book_cover',
          table_name: 'books',
          record_id: bookId,
          old_data: { thumbnail_url: book.thumbnail_url },
          new_data: { thumbnail_url: thumbnailUrl },
          metadata: { size: coverBuffer.length },
        });

        return { success: true, book: updated, thumbnail_url: thumbnailUrl };
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'COVER_UPDATE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  // 刪除電子書
  fastify.delete<{
    Params: { id: string };
  }>('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const bookId = parseInt(request.params.id, 10);

    try {
      await deleteBook(bookId);
      return { success: true, message: 'Book deleted' };
    } catch (error) {
      return reply.status(500).send({
        error: 'BOOK_DELETE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 檢查 PDF 優化功能狀態
  fastify.get('/compression-status', async () => {
    const qpdfAvailable = await isQpdfAvailable();
    return {
      success: true,
      qpdf_available: qpdfAvailable,
      compression_enabled: qpdfAvailable,
      method: 'qpdf (lossless)',
      note: qpdfAvailable ? 'PDF 無損優化功能正常' : '需要安裝 qpdf 才能啟用優化功能',
    };
  });

  // 批次產生缺少縮圖的書籍縮圖
  fastify.post<{
    Body: { limit?: number };
  }>('/generate-thumbnails', { preHandler: [requireAuth] }, async (request, reply) => {
    const { limit = 20 } = request.body || {};

    try {
      const books = await getBooksWithoutThumbnail(limit);

      if (books.length === 0) {
        return { success: true, message: 'All books have thumbnails', processed: 0 };
      }

      reply.status(202).send({
        success: true,
        message: `Processing ${books.length} books`,
        processing: books.length,
      });

      (async () => {
        let success = 0;
        let failed = 0;

        for (const book of books) {
          try {
            if (!book.pdf_path) continue;

            const pdfBuffer = await downloadBookPdf(book.pdf_path);
            if (!pdfBuffer) {
              console.warn(`[Thumbnails] PDF not found: ${book.pdf_path}`);
              failed++;
              continue;
            }

            const thumbBuffer = await extractPdfThumbnail(pdfBuffer);
            if (!thumbBuffer) {
              failed++;
              continue;
            }

            const uuid = book.pdf_path.replace(/^books\//, '').replace(/\.pdf$/, '');
            const thumbnailUrl = await uploadBookThumbnail(thumbBuffer, uuid);

            await updateBook(book.id, { thumbnail_url: thumbnailUrl });
            console.log(`[Thumbnails] ${book.id}: ${book.title} → ${thumbnailUrl}`);
            success++;
          } catch (err) {
            console.error(`[Thumbnails] ${book.id} failed:`, err);
            failed++;
          }
        }

        console.log(`[Thumbnails] Done: ${success} success, ${failed} failed`);
        await insertAuditLog({
          user_email: null,
          action: 'batch_generate_thumbnails',
          table_name: 'books',
          record_id: null,
          old_data: null,
          new_data: { total: books.length, success, failed },
          metadata: null,
        });
      })().catch(err => console.error('[Thumbnails] Batch failed:', err));
    } catch (error) {
      console.error('[Thumbnails] Batch failed:', error);
      return reply.status(500).send({
        error: 'THUMBNAIL_BATCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
