import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
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
