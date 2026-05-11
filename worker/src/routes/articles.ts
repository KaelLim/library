import type { FastifyPluginAsync } from 'fastify';
import { rewriteForDigital, generateDescription } from '../services/ai-rewriter.js';
import { generateArticleAudio } from '../services/tts.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getArticleById,
  insertArticle,
  insertAuditLog,
  updateArticle,
  getArticlesWithoutDescription,
  broadcastAudioProgress,
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
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
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
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
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
  }>('/batch-generate-descriptions', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
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
        let success = 0;
        let failed = 0;
        for (const article of articles) {
          try {
            const categoryName = article.category?.name || '未分類';
            const description = await generateDescription(article.title, article.content, categoryName);
            await updateArticle(article.id, { description });
            console.log(`[${article.id}] Description generated: ${description.substring(0, 50)}...`);
            success++;
          } catch (err) {
            console.error(`[${article.id}] Failed:`, err);
            failed++;
          }
        }
        console.log(`Batch description generation completed: ${success} success, ${failed} failed`);
        await insertAuditLog({
          user_email: null,
          action: 'batch_generate_descriptions',
          table_name: 'articles',
          record_id: null,
          old_data: null,
          new_data: { total: articles.length, success, failed },
          metadata: null,
        });
      })().catch(err => console.error('Batch generate descriptions failed:', err));
    } catch (error) {
      console.error('Batch generate descriptions failed:', error);
      return reply.status(500).send({
        error: 'BATCH_GENERATE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Generate audio for a single digital article
  fastify.post<{
    Body: { article_id: number };
  }>('/generate-audio', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
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

    const article = await getArticleById(article_id);
    if (!article) {
      return reply.status(404).send({
        error: 'ARTICLE_NOT_FOUND',
        message: `Article ${article_id} not found`,
      });
    }

    if (article.platform !== 'digital') {
      return reply.status(400).send({
        error: 'NOT_DIGITAL_ARTICLE',
        message: 'Only digital articles can generate audio',
      });
    }

    // 非同步執行，立即回傳 202
    reply.status(202).send({
      success: true,
      message: `Generating audio for article ${article_id}`,
      article_id,
    });

    (async () => {
      try {
        const result = await generateArticleAudio(
          article.weekly_id,
          article_id,
          article.content,
          async (msg) => {
            await broadcastAudioProgress(article_id, { status: 'processing', message: msg });
          },
        );
        console.log(`[generate-audio] Article ${article_id}: ${result.duration.toFixed(1)}s, mp3=${result.mp3Url}`);

        await broadcastAudioProgress(article_id, {
          status: 'completed',
          message: '語音生成完成',
          mp3Url: result.mp3Url,
          srtUrl: result.srtUrl,
          duration: result.duration,
        });

        await insertAuditLog({
          user_email: (request as any).user?.email || null,
          action: 'ai_transform',
          table_name: 'articles',
          record_id: article_id,
          old_data: null,
          new_data: null,
          metadata: {
            type: 'generate_audio',
            weekly_id: article.weekly_id,
            duration: result.duration,
            mp3_url: result.mp3Url,
            srt_url: result.srtUrl,
          },
        });
      } catch (err) {
        console.error(`[generate-audio] Article ${article_id} failed:`, err);
        await broadcastAudioProgress(article_id, {
          status: 'failed',
          message: err instanceof Error ? err.message : '語音生成失敗',
        });
      }
    })().catch(() => {});
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
