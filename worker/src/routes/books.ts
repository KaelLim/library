import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import {
  getBooksCategories,
  getBooks,
  getBookById,
  updateBook,
  deleteBook,
  uploadBookThumbnail,
  removeBookThumbnail,
  getBooksWithoutThumbnail,
  downloadBookPdf,
  insertAuditLog,
} from '../services/supabase.js';
import { extractPdfThumbnail, isQpdfAvailable } from '../services/pdf-compressor.js';
import {
  MAX_COVER_SIZE,
  isSupportedImage,
  normalizeCover,
  startBookCreate,
  startBookPdfReplace,
} from '../services/book-upload.js';

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
      return reply.status(400).send({ error: 'MISSING_FILE', message: 'PDF file is required' });
    }
    if (!fields.title) {
      return reply.status(400).send({ error: 'MISSING_TITLE', message: 'title is required' });
    }

    let result;
    try {
      result = startBookCreate({
        rawPdfBuffer,
        pdfFilename,
        coverBuffer,
        fields,
        log: request.log,
      });
    } catch (err) {
      return reply.status(400).send({
        error: 'INVALID_PDF',
        message: err instanceof Error ? err.message : '上傳的檔案不是有效的 PDF',
      });
    }

    return reply.status(202).send({
      success: true,
      message: '檔案已接收，後台處理中',
      task_id: result.taskId,
      title: result.title,
    });
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

  // 替換電子書 PDF（multipart，202 + broadcast）
  // book_id 保持不變，pdf_path 指向新檔，舊 PDF 自動清除
  fastify.post<{ Params: { id: string } }>(
    '/:id/pdf',
    { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const bookId = parseInt(request.params.id, 10);
      const book = await getBookById(bookId);
      if (!book) {
        return reply.status(404).send({
          error: 'BOOK_NOT_FOUND',
          message: `Book ${bookId} not found`,
        });
      }

      const fields: Record<string, string> = {};
      let rawPdfBuffer: Buffer | null = null;
      let coverBuffer: Buffer | null = null;

      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            const buf = Buffer.concat(chunks);

            if (part.fieldname === 'pdf_file') {
              rawPdfBuffer = buf;
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
          message: 'pdf_file is required',
        });
      }

      let result;
      try {
        result = startBookPdfReplace({
          book,
          rawPdfBuffer,
          coverBuffer,
          fields,
          log: request.log,
        });
      } catch (err) {
        return reply.status(400).send({
          error: 'INVALID_PDF',
          message: err instanceof Error ? err.message : '上傳的檔案不是有效的 PDF',
        });
      }

      return reply.status(202).send({
        success: true,
        message: 'PDF 已接收，後台處理中',
        task_id: result.taskId,
        book_id: result.bookId,
      });
    },
  );

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
        const { buffer: normalizedBuffer, format } = await normalizeCover(coverBuffer);
        const thumbnailUrl = await uploadBookThumbnail(normalizedBuffer, uuid, format);

        // 若舊封面副檔名與新封面不同（例如從 jpg 換成 png），清掉舊檔避免孤兒
        if (book.thumbnail_url && book.thumbnail_url !== thumbnailUrl) {
          await removeBookThumbnail(book.thumbnail_url).catch((err) => {
            request.log.warn({ err }, '[Books] 清除舊封面失敗');
          });
        }

        const updated = await updateBook(bookId, { thumbnail_url: thumbnailUrl });

        await insertAuditLog({
          user_email: (request as any).user?.email || null,
          action: 'update_book_cover',
          table_name: 'books',
          record_id: bookId,
          old_data: { thumbnail_url: book.thumbnail_url },
          new_data: { thumbnail_url: thumbnailUrl },
          metadata: { size: coverBuffer.length, format },
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
