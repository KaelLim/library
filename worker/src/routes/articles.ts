import type { FastifyPluginAsync } from 'fastify';
import { rewriteForDigital, generateDescription } from '../services/ai-rewriter.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getArticleById,
  insertArticle,
  insertAuditLog,
  updateArticle,
  getArticlesWithoutDescription,
} from '../services/supabase.js';

export const articleRoutes: FastifyPluginAsync = async (fastify) => {
  // Rewrite endpoint
  fastify.post<{
    Body: {
      article_id: number;
      user_email?: string;
    };
  }>('/rewrite', {
    preHandler: [requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['article_id'],
        properties: {
          article_id: { type: 'integer' },
          user_email: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { article_id, user_email } = request.body;

    if (!article_id) {
      return reply.status(400).send({
        error: 'MISSING_ARTICLE_ID',
        message: 'article_id is required',
      });
    }

    try {
      const docsArticle = await getArticleById(article_id);
      if (!docsArticle) {
        return reply.status(404).send({
          error: 'ARTICLE_NOT_FOUND',
          message: `Article ${article_id} not found`,
        });
      }

      const categoryName = docsArticle.category?.name || '未分類';
      const rewritten = await rewriteForDigital(docsArticle.title, docsArticle.content, docsArticle.weekly_id, categoryName);

      await insertArticle({
        weekly_id: docsArticle.weekly_id,
        category_id: docsArticle.category_id,
        platform: 'digital',
        title: rewritten.title,
        description: rewritten.description,
        content: rewritten.content,
      });

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
    Body: { article_id: number };
  }>('/generate-description', {
    preHandler: [requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['article_id'],
        properties: {
          article_id: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
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

      return { success: true, article_id, description };
    } catch (error) {
      console.error('Generate description failed:', error);
      return reply.status(500).send({
        error: 'GENERATE_DESCRIPTION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Batch generate descriptions
  fastify.post<{
    Body: { limit?: number };
  }>('/batch-generate-descriptions', { preHandler: [requireAuth] }, async (request, reply) => {
    const { limit = 10 } = request.body || {};

    try {
      const articles = await getArticlesWithoutDescription(limit);

      if (articles.length === 0) {
        return { success: true, message: 'No articles need description', processed: 0, remaining: 0 };
      }

      reply.status(202).send({
        success: true,
        message: `Processing ${articles.length} articles`,
        processing: articles.length,
      });

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
};
