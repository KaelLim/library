import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { runImportWorker } from './worker.js';
import { rewriteForDigital } from './services/ai-rewriter.js';
import { buildExportUrl } from './services/google-docs.js';
import {
  initSupabase,
  getArticleById,
  getDigitalArticle,
  updateArticle,
  insertArticle,
  insertAuditLog,
} from './services/supabase.js';

// Initialize Supabase
initSupabase();

const fastify = Fastify({
  logger: true,
});

// Enable CORS
await fastify.register(cors, {
  origin: true,
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
    // Get the docs version article
    const docsArticle = await getArticleById(article_id);
    if (!docsArticle) {
      return reply.status(404).send({
        error: 'ARTICLE_NOT_FOUND',
        message: `Article ${article_id} not found`,
      });
    }

    // Find or create the digital version
    const digitalArticle = await getDigitalArticle(
      docsArticle.weekly_id,
      docsArticle.category_id,
      docsArticle.order_number
    );

    // Rewrite the article
    const rewritten = await rewriteForDigital(docsArticle.title, docsArticle.content, docsArticle.weekly_id);

    // Update or insert digital version
    if (digitalArticle) {
      await updateArticle(digitalArticle.id, {
        title: rewritten.title,
        content: rewritten.content,
      });
    } else {
      await insertArticle({
        weekly_id: docsArticle.weekly_id,
        category_id: docsArticle.category_id,
        platform: 'digital',
        title: rewritten.title,
        content: rewritten.content,
        order_number: docsArticle.order_number,
      });
    }

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
