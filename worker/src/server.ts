import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { runImportWorker } from './worker.js';
import { rewriteForDigital, generateDescription } from './services/ai-rewriter.js';
import { buildExportUrl } from './services/google-docs.js';
import { extractFolderId, listImagesRecursive } from './services/google-drive.js';
import {
  initSupabase,
  getArticleById,
  insertArticle,
  insertAuditLog,
  updateArticle,
  getArticlesWithoutDescription,
  getBooksCategories,
  getBooksCategoryBySlug,
  insertBook,
  getBooks,
  getBookById,
  getBookByPdfPath,
  incrementBookHits,
  updateBook,
  deleteBook,
  uploadBookPdf,
  uploadBookThumbnail,
  getBooksWithoutThumbnail,
  downloadBookPdf,
} from './services/supabase.js';
import { compressPdf, extractPdfThumbnail, isGhostscriptAvailable } from './services/pdf-compressor.js';
import { apiV1Routes } from './routes/api-v1.js';

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

// ===========================================
// PDF Reader 靜態檔案 + SSR
// ===========================================

const BOOKS_DIR = process.env.BOOKS_DIR || join(process.cwd(), 'books');

// 靜態檔案服務（reply.sendFile）
await fastify.register(fastifyStatic, {
  root: BOOKS_DIR,
  prefix: '/books/r/',
  serve: false, // 不自動註冊路由，由 SSR handler 統一處理
});

// 讀取 index.html 模板（啟動時一次性載入）
let bookTemplate = '';
try {
  bookTemplate = readFileSync(join(BOOKS_DIR, 'index.html'), 'utf-8');
} catch {
  console.warn('[Books] index.html not found in', BOOKS_DIR);
}

// SSR 路由 + 靜態檔案：/books/r/*
const STATIC_FILES = new Set(['style.css', 'app.js', 'page-flip.mp3']);

fastify.get<{
  Params: { '*': string };
}>('/books/r/*', async (request, reply) => {
  const wildcard = request.params['*']; // e.g. "2f4d6a72-..." or "style.css"

  // 靜態檔案直接回傳
  if (STATIC_FILES.has(wildcard)) {
    return reply.sendFile(wildcard);
  }

  // UUID → storage path: books/{uuid}.pdf
  const pdfPath = `books/${wildcard}.pdf`;

  if (!bookTemplate) {
    return reply.status(500).send({ error: 'Reader template not found' });
  }

  // 查詢 DB 取得書籍資料
  const book = await getBookByPdfPath(pdfPath);
  if (!book) {
    return reply.status(404).send({ error: 'Book not found' });
  }

  const pdfSrc = `/storage/v1/object/public/books/${pdfPath}`;
  const ogImage = book.thumbnail_url || '';
  const ogDescription = book.introtext || '';
  const ogAuthor = book.author || '';

  // 注入 meta tags 和 config
  const injectedHtml = bookTemplate
    .replace(
      '<title>PDF Page Flip Demo</title>',
      `<title>${escapeHtml(book.title)}</title>
    <meta property="og:title" content="${escapeAttr(book.title)}" />
    <meta property="og:description" content="${escapeAttr(ogDescription)}" />
    <meta property="og:image" content="${escapeAttr(ogImage)}" />
    <meta property="og:type" content="book" />
    <meta property="book:author" content="${escapeAttr(ogAuthor)}" />
    <meta name="description" content="${escapeAttr(ogDescription)}" />`
    )
    .replace(
      '</head>',
      `<script>window.__BOOK_CONFIG__=${JSON.stringify({
        pdfSrc,
        turnPage: book.turn_page,
        title: book.title,
      }).replace(/</g, '\\u003c')};</script>\n</head>`
    );

  // 背景更新點擊數
  incrementBookHits(book.id).catch(() => {});

  return reply.type('text/html').send(injectedHtml);
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Public API v1
await fastify.register(apiV1Routes, { prefix: '/api/v1' });

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Test Google Drive access
fastify.post<{
  Body: { folder_url: string; provider_token: string };
}>('/test-drive', async (request, reply) => {
  const { folder_url, provider_token } = request.body;

  if (!folder_url || !provider_token) {
    return reply.status(400).send({
      error: 'MISSING_PARAMS',
      message: 'folder_url and provider_token are required',
    });
  }

  const folderId = extractFolderId(folder_url);
  if (!folderId) {
    return reply.status(400).send({
      error: 'INVALID_FOLDER_URL',
      message: 'Invalid Google Drive folder URL',
    });
  }

  try {
    const files = await listImagesRecursive(provider_token, folderId);
    return { folder_id: folderId, total: files.length, files };
  } catch (error) {
    return reply.status(400).send({
      error: 'DRIVE_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Import endpoint
fastify.post<{
  Body: {
    doc_url: string;
    weekly_id?: number;
    user_email?: string;
    drive_folder_url?: string;
    provider_token?: string;
  };
}>('/import', async (request, reply) => {
  const { doc_url, weekly_id, user_email, drive_folder_url, provider_token } = request.body;

  console.log(`[Import] weekly_id=${weekly_id}, drive_folder_url=${drive_folder_url ? 'YES' : 'NO'}, provider_token=${provider_token ? 'YES' : 'NO'}`);

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
      driveFolderUrl: drive_folder_url,
      providerToken: provider_token,
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
    (async () => {
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
    })().catch(err => console.error('Batch generate descriptions failed:', err));
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

// 創建電子書（上傳 PDF + 資料庫）
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
      book_id: fields.book_id || null,
      thumbnail_url: thumbnailUrl,
      title,
      introtext: fields.introtext || fields.description || null,
      catalogue: fields.catalogue || null,
      author: fields.author || null,
      author_introtext: fields.author_introtext || null,
      publisher: fields.publisher || null,
      book_date: fields.book_date || null,
      isbn: fields.isbn || null,
      pdf_path: storageResult.path,
      cover_image: fields.cover_image || null,
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

// 批次產生缺少縮圖的書籍縮圖
fastify.post<{
  Body: { limit?: number };
}>('/books/generate-thumbnails', async (request, reply) => {
  const { limit = 20 } = request.body || {};

  try {
    const books = await getBooksWithoutThumbnail(limit);

    if (books.length === 0) {
      return { success: true, message: 'All books have thumbnails', processed: 0 };
    }

    // 回傳 202，背景處理
    reply.status(202).send({
      success: true,
      message: `Processing ${books.length} books`,
      processing: books.length,
    });

    // 背景逐一處理
    (async () => {
      let success = 0;
      let failed = 0;

      for (const book of books) {
        try {
          if (!book.pdf_path) continue;

          // 下載 PDF
          const pdfBuffer = await downloadBookPdf(book.pdf_path);
          if (!pdfBuffer) {
            console.warn(`[Thumbnails] PDF not found: ${book.pdf_path}`);
            failed++;
            continue;
          }

          // 擷取縮圖
          const thumbBuffer = await extractPdfThumbnail(pdfBuffer);
          if (!thumbBuffer) {
            failed++;
            continue;
          }

          // 上傳縮圖
          const uuid = book.pdf_path.replace(/^books\//, '').replace(/\.pdf$/, '');
          const thumbnailUrl = await uploadBookThumbnail(thumbBuffer, uuid);

          // 更新 DB
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
