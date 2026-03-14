import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import {
  getBooksCategories,
  getBooksCategoryBySlug,
  insertBook,
  getBooks,
  getBookById,
  incrementBookHits,
  updateBook,
  deleteBook,
  uploadBookPdf,
  uploadBookThumbnail,
  getBooksWithoutThumbnail,
  downloadBookPdf,
  insertAuditLog,
} from '../services/supabase.js';
import { compressPdf, extractPdfThumbnail, isGhostscriptAvailable } from '../services/pdf-compressor.js';

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

  // 創建電子書（上傳 PDF + 資料庫）
  fastify.post('/create', { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          error: 'MISSING_FILE',
          message: 'PDF file is required',
        });
      }

      // Get form fields
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(data.fields)) {
        if (key === 'pdf_file') continue;
        if (value && typeof value === 'object' && 'value' in value) {
          fields[key] = (value as { value: string }).value;
        } else if (typeof value === 'string') {
          fields[key] = value;
        } else if (Array.isArray(value) && value.length > 0) {
          const firstValue = value[0] as { value?: string };
          if (typeof firstValue === 'object' && firstValue.value) {
            fields[key] = firstValue.value;
          }
        }
      }

      const title = fields.title;
      if (!title) {
        return reply.status(400).send({
          error: 'MISSING_TITLE',
          message: 'title is required',
        });
      }

      // Read file buffer
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const rawPdfBuffer = Buffer.concat(chunks);

      // Validate PDF magic bytes
      if (rawPdfBuffer.length < 4 || rawPdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
        return reply.status(400).send({
          error: 'INVALID_PDF',
          message: '上傳的檔案不是有效的 PDF',
        });
      }

      // 0. 壓縮 PDF
      const compressionQuality = (fields.compression_quality as 'screen' | 'ebook' | 'printer' | 'prepress') || 'ebook';
      const skipCompression = fields.skip_compression === 'true';

      let pdfBuffer: Buffer = rawPdfBuffer;
      let compressionInfo: { originalSize: number; compressedSize: number; ratio: number } | null = null;

      if (!skipCompression) {
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
      console.log('[Books] Uploading PDF to storage...');
      const storageResult = await uploadBookPdf(pdfBuffer, data.filename);
      console.log(`[Books] PDF uploaded: ${storageResult.path}`);

      // 1.5 擷取第一頁縮圖
      let thumbnailUrl = fields.thumbnail_url || null;
      if (!thumbnailUrl) {
        const uuid = storageResult.path.replace(/^books\//, '').replace(/\.pdf$/, '');
        const thumbBuffer = await extractPdfThumbnail(pdfBuffer);
        if (thumbBuffer) {
          thumbnailUrl = await uploadBookThumbnail(thumbBuffer, uuid);
          console.log(`[Books] Thumbnail generated: ${thumbnailUrl}`);
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
      const book = await insertBook({
        category_id: categoryId || null,
        book_url: fields.book_url || null,
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
        },
      });

      return {
        success: true,
        message: '電子書創建成功',
        book: {
          id: book.id,
          title: book.title,
          book_url: book.book_url,
          thumbnail_url: book.thumbnail_url,
          pdf_path: book.pdf_path,
        },
        compression: compressionInfo ? {
          original_size: compressionInfo.originalSize,
          compressed_size: compressionInfo.compressedSize,
          ratio: `${(compressionInfo.ratio * 100).toFixed(1)}%`,
          saved: `${((1 - compressionInfo.ratio) * 100).toFixed(1)}%`,
        } : null,
      };
    } catch (error) {
      console.error('[Books] Error:', error);
      return reply.status(500).send({
        error: 'BOOK_CREATE_ERROR',
        message: '電子書建立失敗，請稍後再試',
      });
    }
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

  // 檢查 PDF 壓縮功能狀態
  fastify.get('/compression-status', async () => {
    const gsAvailable = await isGhostscriptAvailable();
    return {
      success: true,
      ghostscript_available: gsAvailable,
      compression_enabled: gsAvailable,
      quality_options: ['screen', 'ebook', 'printer', 'prepress'],
      recommended: 'ebook',
      note: gsAvailable ? 'PDF 壓縮功能正常' : '需要安裝 Ghostscript 才能啟用壓縮功能',
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
