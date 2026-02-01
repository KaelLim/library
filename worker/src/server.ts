import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { runImportWorker } from './worker.js';
import { rewriteForDigital, generateDescription } from './services/ai-rewriter.js';
import { buildExportUrl } from './services/google-docs.js';
import {
  initSupabase,
  getArticleById,
  insertArticle,
  insertAuditLog,
  updateArticle,
  getArticlesWithoutDescription,
  // Books
  getBooksCategories,
  getBooksCategoryBySlug,
  insertBook,
  getBooks,
  getBookById,
  updateBook,
  deleteBook,
  uploadBookPdf,
} from './services/supabase.js';
import {
  createFlipBookFromPdf,
  getDefaultBookConfig,
  updateFlipBookConfig,
  turnPageToRightToLeft,
} from './services/fliphtml5.js';
import { compressPdf, isGhostscriptAvailable } from './services/pdf-compressor.js';

// Initialize Supabase
initSupabase();

const fastify = Fastify({
  logger: true,
});

// Enable CORS
await fastify.register(cors, {
  origin: true,
});

// Enable multipart/form-data for file uploads
await fastify.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 500, // 500MB max
  },
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Import endpoint
fastify.post<{
  Body: {
    doc_url: string;
    weekly_id?: number;
    user_email?: string;
  };
}>('/import', async (request, reply) => {
  const { doc_url, weekly_id, user_email } = request.body;

  if (!doc_url) {
    return reply.status(400).send({
      error: 'MISSING_DOC_URL',
      message: 'doc_url is required',
    });
  }

  // Extract doc_id from URL
  const docIdMatch = doc_url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!docIdMatch) {
    return reply.status(400).send({
      error: 'INVALID_DOC_URL',
      message: 'Invalid Google Docs URL',
    });
  }

  const docId = docIdMatch[1];

  // Validate Google Doc is accessible before starting import
  const exportUrl = buildExportUrl(docId);
  try {
    const checkResponse = await fetch(exportUrl, { method: 'HEAD' });
    if (!checkResponse.ok) {
      const errorMap: Record<number, { error: string; message: string }> = {
        401: { error: 'DOC_UNAUTHORIZED', message: '無法存取文件，請確認文件已設為「知道連結的人都可以檢視」' },
        403: { error: 'DOC_FORBIDDEN', message: '無法存取文件，請確認文件已設為「知道連結的人都可以檢視」' },
        404: { error: 'DOC_NOT_FOUND', message: '找不到文件，請確認 URL 正確' },
      };
      const err = errorMap[checkResponse.status] || {
        error: 'DOC_ACCESS_ERROR',
        message: `無法存取文件: ${checkResponse.status} ${checkResponse.statusText}`,
      };
      return reply.status(400).send(err);
    }
  } catch (error) {
    return reply.status(500).send({
      error: 'DOC_FETCH_ERROR',
      message: `無法連接 Google Docs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // Start import in background
  reply.status(202).send({
    success: true,
    message: 'Import started',
    weekly_id: weekly_id,
  });

  // Run import asynchronously
  runImportWorker(
    {
      docId,
      weeklyId: weekly_id,
      userEmail: user_email,
    },
    (step, progress, error) => {
      if (error) {
        console.error(`[${step}] Error: ${error}`);
      } else {
        console.log(`[${step}] ${progress || 'done'}`);
      }
    }
  ).catch((err) => {
    console.error('Import failed:', err);
  });
});

// Rewrite endpoint
fastify.post<{
  Body: {
    article_id: number;
    user_email?: string;
  };
}>('/rewrite', async (request, reply) => {
  const { article_id, user_email } = request.body;

  if (!article_id) {
    return reply.status(400).send({
      error: 'MISSING_ARTICLE_ID',
      message: 'article_id is required',
    });
  }

  try {
    // Get the docs version article with category
    const docsArticle = await getArticleById(article_id);
    if (!docsArticle) {
      return reply.status(404).send({
        error: 'ARTICLE_NOT_FOUND',
        message: `Article ${article_id} not found`,
      });
    }

    // Get category name for the rewriter
    const categoryName = docsArticle.category?.name || '未分類';

    // Rewrite the article with category context
    const rewritten = await rewriteForDigital(docsArticle.title, docsArticle.content, docsArticle.weekly_id, categoryName);

    // Insert digital version
    await insertArticle({
      weekly_id: docsArticle.weekly_id,
      category_id: docsArticle.category_id,
      platform: 'digital',
      title: rewritten.title,
      description: rewritten.description,
      content: rewritten.content,
    });

    // Log the action
    await insertAuditLog({
      user_email: user_email || null,
      action: 'ai_transform',
      table_name: 'articles',
      record_id: article_id,
      old_data: null,
      new_data: null,
      metadata: {
        weekly_id: docsArticle.weekly_id,
        original_title: docsArticle.title,
        rewritten_title: rewritten.title,
      },
    });

    return {
      success: true,
      article_id,
      message: 'Article rewritten successfully',
    };
  } catch (error) {
    console.error('Rewrite failed:', error);
    return reply.status(500).send({
      error: 'REWRITE_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Generate description for a single article
fastify.post<{
  Body: {
    article_id: number;
  };
}>('/generate-description', async (request, reply) => {
  const { article_id } = request.body;

  if (!article_id) {
    return reply.status(400).send({
      error: 'MISSING_ARTICLE_ID',
      message: 'article_id is required',
    });
  }

  try {
    const article = await getArticleById(article_id);
    if (!article) {
      return reply.status(404).send({
        error: 'ARTICLE_NOT_FOUND',
        message: `Article ${article_id} not found`,
      });
    }

    const categoryName = article.category?.name || '未分類';
    const description = await generateDescription(article.title, article.content, categoryName);

    await updateArticle(article_id, { description });

    return {
      success: true,
      article_id,
      description,
    };
  } catch (error) {
    console.error('Generate description failed:', error);
    return reply.status(500).send({
      error: 'GENERATE_DESCRIPTION_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Batch generate descriptions for articles without description
fastify.post<{
  Body: {
    limit?: number;
  };
}>('/batch-generate-descriptions', async (request, reply) => {
  const { limit = 10 } = request.body || {};

  try {
    const articles = await getArticlesWithoutDescription(limit);

    if (articles.length === 0) {
      return {
        success: true,
        message: 'No articles need description',
        processed: 0,
        remaining: 0,
      };
    }

    // 回傳 202，背景處理
    reply.status(202).send({
      success: true,
      message: `Processing ${articles.length} articles`,
      processing: articles.length,
    });

    // 背景逐一處理
    for (const article of articles) {
      try {
        const categoryName = article.category?.name || '未分類';
        const description = await generateDescription(article.title, article.content, categoryName);
        await updateArticle(article.id, { description });
        console.log(`[${article.id}] Description generated: ${description.substring(0, 50)}...`);
      } catch (err) {
        console.error(`[${article.id}] Failed:`, err);
      }
    }

    console.log(`Batch description generation completed: ${articles.length} articles`);
  } catch (error) {
    console.error('Batch generate descriptions failed:', error);
    return reply.status(500).send({
      error: 'BATCH_GENERATE_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get count of articles without description
fastify.get('/articles-without-description', async () => {
  const articles = await getArticlesWithoutDescription(10000);
  return {
    count: articles.length,
    sample: articles.slice(0, 5).map(a => ({ id: a.id, title: a.title, platform: a.platform })),
  };
});

// ===========================================
// FlipHTML5 電子書 API
// ===========================================

// ===========================================
// Books 電子書 API
// ===========================================

// 取得所有電子書分類
fastify.get('/books/categories', async () => {
  const categories = await getBooksCategories();
  return { success: true, categories };
});

// 取得所有電子書
fastify.get<{
  Querystring: {
    category_id?: string;
    limit?: string;
    offset?: string;
  };
}>('/books', async (request) => {
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
}>('/books/:id', async (request, reply) => {
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

// 創建電子書（上傳 PDF + FlipHTML5 + 資料庫）
fastify.post('/books/create', async (request, reply) => {
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
    console.log('[Books] Field keys:', Object.keys(data.fields));
    for (const [key, value] of Object.entries(data.fields)) {
      if (key === 'pdf_file') continue; // Skip file field
      console.log(`[Books] Field "${key}":`, typeof value);
      if (value && typeof value === 'object' && 'value' in value) {
        fields[key] = (value as { value: string }).value;
      } else if (typeof value === 'string') {
        fields[key] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        // Handle array of field values (multiple same-name fields)
        const firstValue = value[0] as { value?: string };
        if (typeof firstValue === 'object' && firstValue.value) {
          fields[key] = firstValue.value;
        }
      }
    }
    console.log('[Books] Parsed fields:', fields);

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

    // 0. 壓縮 PDF（保持高畫質）
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

    // 1. 上傳 PDF 到 Supabase Storage (UUID 命名)
    console.log('[Books] Uploading PDF to storage...');
    const storageResult = await uploadBookPdf(pdfBuffer, data.filename);
    console.log(`[Books] PDF uploaded: ${storageResult.path}`);

    // 2. 取得分類資訊（包含 folder_id）
    let folderId: number | undefined;
    let categoryId: number | undefined;
    let category: Awaited<ReturnType<typeof getBooksCategoryBySlug>> = null;

    if (fields.category_id) {
      categoryId = parseInt(fields.category_id, 10);
      // 根據 ID 取得分類以獲取 folder_id
      const categories = await getBooksCategories();
      category = categories.find(c => c.id === categoryId) || null;
    } else if (fields.category_slug) {
      category = await getBooksCategoryBySlug(fields.category_slug);
      if (category) {
        categoryId = category.id;
      }
    }

    // 優先順序：手動指定 > 分類的 folder_id
    if (fields.folder_id) {
      folderId = parseInt(fields.folder_id, 10);
    } else if (category?.folder_id) {
      folderId = parseInt(category.folder_id, 10);
    }

    // 3. 上傳到 FlipHTML5 並創建電子書
    console.log('[Books] Creating FlipBook...');
    const flipResult = await createFlipBookFromPdf(pdfBuffer, `${title}.pdf`, title, {
      description: fields.introtext || fields.description,
      folderId,
      metadata: {
        author: fields.author,
        publisher: fields.publisher,
        isbn: fields.isbn,
        book_date: fields.book_date,
      },
    });

    if (!flipResult.success) {
      return reply.status(500).send({
        error: 'FLIPBOOK_CREATE_FAILED',
        message: flipResult.message,
      });
    }

    console.log(`[Books] FlipBook created: ${flipResult.bookId}`);

    // 4. 寫入資料庫
    const book = await insertBook({
      category_id: categoryId || null,
      book_url: flipResult.bookUrl || null,
      book_id: flipResult.bookId || null,
      thumbnail_url: flipResult.thumbnailUrl || null,
      title,
      introtext: fields.introtext || fields.description || null,
      catalogue: fields.catalogue || null,
      author: fields.author || null,
      author_introtext: fields.author_introtext || null,
      publisher: fields.publisher || null,
      book_date: fields.book_date || null,
      isbn: fields.isbn || null,
      pdf_path: storageResult.path,
      cover_image: flipResult.thumbnailUrl || fields.cover_image || null,
      language: fields.language || 'zh-TW',
      turn_page: (fields.turn_page as 'left' | 'right') || 'left',
      copyright: fields.copyright || null,
      download: fields.download !== 'false',
      online_purchase: fields.online_purchase || null,
      publish_date: fields.publish_date || null,
    });

    console.log(`[Books] Book record created: ${book.id}`);

    // 5. 記錄 audit log
    await insertAuditLog({
      user_email: fields.user_email || null,
      action: 'create_book',
      table_name: 'books',
      record_id: book.id,
      old_data: null,
      new_data: { title, book_id: flipResult.bookId },
      metadata: {
        pdf_path: storageResult.path,
        book_url: flipResult.bookUrl,
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
        book_id: book.book_id,
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
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 更新電子書
fastify.put<{
  Params: { id: string };
  Body: Record<string, unknown>;
}>('/books/:id', async (request, reply) => {
  const bookId = parseInt(request.params.id, 10);
  const updates = request.body as {
    turn_page?: 'left' | 'right';
    [key: string]: unknown;
  };

  try {
    // 先取得現有書籍資料
    const existingBook = await getBookById(bookId);
    if (!existingBook) {
      return reply.status(404).send({
        error: 'BOOK_NOT_FOUND',
        message: `Book ${bookId} not found`,
      });
    }

    // 如果 turn_page 有變更，同步更新 FlipHTML5
    if (updates.turn_page && existingBook.book_id && updates.turn_page !== existingBook.turn_page) {
      console.log(`[Books] Syncing turn_page to FlipHTML5: ${updates.turn_page}`);
      const flipResult = await updateFlipBookConfig(existingBook.book_id, {
        RightToLeft: turnPageToRightToLeft(updates.turn_page),
      });

      if (!flipResult.success) {
        console.warn(`[Books] FlipHTML5 sync failed: ${flipResult.message}`);
        // 不阻止更新，只是警告
      }
    }

    // 更新資料庫
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
}>('/books/:id', async (request, reply) => {
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

// Get default FlipBook config (for reference)
fastify.get('/books/fliphtml5-config', async () => {
  return {
    success: true,
    config: getDefaultBookConfig(),
  };
});

// 檢查 PDF 壓縮功能狀態
fastify.get('/books/compression-status', async () => {
  const gsAvailable = await isGhostscriptAvailable();
  return {
    success: true,
    ghostscript_available: gsAvailable,
    compression_enabled: gsAvailable,
    quality_options: ['screen', 'ebook', 'printer', 'prepress'],
    recommended: 'ebook',
    note: gsAvailable
      ? 'PDF 壓縮功能正常'
      : '需要安裝 Ghostscript 才能啟用壓縮功能',
  };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Worker server running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
