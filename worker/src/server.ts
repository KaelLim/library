import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { runImportWorker } from './worker.js';
import { buildExportUrl } from './services/google-docs.js';
import { extractFolderId, listImagesRecursive } from './services/google-drive.js';
import { initSupabase, getBookByPdfPath, incrementBookHits } from './services/supabase.js';
import { apiV1Routes } from './routes/api-v1.js';
import { articleRoutes } from './routes/articles.js';
import { bookRoutes } from './routes/books.js';
import { requireAuth } from './middleware/auth.js';

// Initialize Supabase
initSupabase();

const fastify = Fastify({
  logger: true,
  keepAliveTimeout: 65000,  // 65s > Kong's 60s upstream timeout
  connectionTimeout: 0,     // 不限制連線建立時間
});

// Security headers（helmet）— Book Reader SSR 需要 inline script，CSP 暫不強制
await fastify.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// Enable CORS — 由 ALLOWED_ORIGINS 環境變數控制，fallback 到本機開發預設值
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:8973,http://localhost:8000,http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

await fastify.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

// Rate limiting
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// 全域錯誤處理：避免錯誤訊息外洩內部細節
fastify.setErrorHandler((err: FastifyError, request, reply) => {
  request.log.error(err);
  const status = err.statusCode ?? 500;
  const safeMessage =
    status >= 500
      ? 'Internal server error'
      : err.message || 'Bad request';
  reply.status(status).send({
    error: err.code ?? err.name ?? 'INTERNAL_ERROR',
    message: safeMessage,
  });
});

// Multipart support (for file uploads)
await fastify.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB
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
  serve: false,
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
  const wildcard = request.params['*'];

  if (STATIC_FILES.has(wildcard)) {
    return reply.sendFile(wildcard);
  }

  const pdfPath = `books/${wildcard}.pdf`;

  if (!bookTemplate) {
    return reply.status(500).send({ error: 'Reader template not found' });
  }

  const book = await getBookByPdfPath(pdfPath);
  if (!book) {
    return reply.status(404).send({ error: 'Book not found' });
  }

  const pdfSrc = `/storage/v1/object/public/books/${pdfPath}`;
  const ogImage = book.thumbnail_url || '';
  const ogDescription = book.introtext || '';
  const ogAuthor = book.author || '';

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
      `<script>window.__BOOK_CONFIG__=${safeJsonForScript({
        pdfSrc,
        turnPage: book.turn_page === 'right' ? 'right' : 'left',
        title: book.title,
      })};</script>\n</head>`
    );

  incrementBookHits(book.id).catch(() => {});

  return reply.type('text/html').send(injectedHtml);
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeJsonForScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
}

// ===========================================
// Routes
// ===========================================

// Public API v1
await fastify.register(apiV1Routes, { prefix: '/api/v1' });

// Article routes (rewrite, description)
await fastify.register(articleRoutes);

// Book routes (CRUD, thumbnails)
await fastify.register(bookRoutes, { prefix: '/books' });

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Track last AI activity (used by session-streamer idle timeout)
export function updateAiActivity(): void {
  // no-op: auto-logout removed, kept for session-streamer compatibility
}

// Claude Code auth status check
fastify.get('/claude/status', {
  preHandler: [requireAuth],
}, async (_request, reply) => {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('claude', ['auth', 'status'], { timeout: 10000 });
    const authInfo = JSON.parse(stdout);
    return {
      authenticated: authInfo.loggedIn === true,
      message: authInfo.loggedIn ? 'Claude Code 已登入' : 'Claude Code 尚未登入',
      email: authInfo.email || undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return reply.status(200).send({ authenticated: false, message: 'Claude Code 尚未登入', detail: msg });
  }
});

// Test Google Drive access
fastify.post<{
  Body: { folder_url: string; provider_token: string };
}>('/test-drive', {
  preHandler: [requireAuth],
  schema: {
    body: {
      type: 'object',
      required: ['folder_url', 'provider_token'],
      properties: {
        folder_url: { type: 'string' },
        provider_token: { type: 'string' },
      },
    },
  },
}, async (request, reply) => {
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
}>('/import', {
  preHandler: [requireAuth],
  config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  schema: {
    body: {
      type: 'object',
      required: ['doc_url'],
      properties: {
        doc_url: { type: 'string' },
        weekly_id: { type: 'integer' },
        user_email: { type: 'string' },
        drive_folder_url: { type: 'string' },
        provider_token: { type: 'string' },
      },
    },
  },
}, async (request, reply) => {
  const { doc_url, weekly_id, user_email, drive_folder_url, provider_token } = request.body;

  console.log(`[Import] weekly_id=${weekly_id}, drive_folder_url=${drive_folder_url ? 'YES' : 'NO'}, provider_token=${provider_token ? 'YES' : 'NO'}`);

  if (!doc_url) {
    return reply.status(400).send({
      error: 'MISSING_DOC_URL',
      message: 'doc_url is required',
    });
  }

  const docIdMatch = doc_url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!docIdMatch) {
    return reply.status(400).send({
      error: 'INVALID_DOC_URL',
      message: 'Invalid Google Docs URL',
    });
  }

  const docId = docIdMatch[1];

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
      message: '無法連接 Google Docs，請稍後再試',
    });
  }

  reply.status(202).send({
    success: true,
    message: 'Import started',
    weekly_id: weekly_id,
  });

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

// ===========================================
// Start server
// ===========================================

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
