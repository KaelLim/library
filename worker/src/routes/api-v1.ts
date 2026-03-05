import { FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getSupabase } from '../services/supabase.js';

const paginationQueryProps = {
  limit: { type: 'string', description: '每頁筆數 (max 100, default 20)' },
  offset: { type: 'string', description: '起始位置 (default 0)' },
};

const apiV1Routes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: '慈濟週報 Public API',
        description: '週報、文章、電子書公開唯讀 API',
        version: '1.0.0',
      },
      tags: [
        { name: '週報', description: '週報、文章、分類' },
        { name: '電子書', description: '電子書與電子書分類' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  });
  // GET /weekly - 週報列表（含文章數）
  fastify.get<{
    Querystring: { status?: string; limit?: string; offset?: string };
  }>('/weekly', {
    schema: {
      tags: ['週報'],
      summary: '週報列表',
      description: '取得週報列表，含各期文章數',
      querystring: {
        type: 'object',
        properties: {
          ...paginationQueryProps,
          status: { type: 'string', enum: ['draft', 'published', 'archived'], description: '篩選狀態' },
        },
      },
    },
  }, async (request) => {
    const { status, limit: limitStr, offset: offsetStr } = request.query;
    const limit = Math.min(parseInt(limitStr || '20', 10), 100);
    const offset = parseInt(offsetStr || '0', 10);

    let query = getSupabase()
      .from('weekly')
      .select('*, articles(count)', { count: 'exact' })
      .order('week_number', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const weekly = (data || []).map((w: any) => ({
      ...w,
      article_count: w.articles?.[0]?.count || 0,
      articles: undefined,
    }));

    return { weekly, total: count || 0, limit, offset };
  });

  // GET /weekly/:id - 週報詳情（含分類＋文章）
  fastify.get<{
    Params: { id: string };
    Querystring: { platform?: string };
  }>('/weekly/:id', {
    schema: {
      tags: ['週報'],
      summary: '週報詳情',
      description: '取得單期週報詳情，含分類與文章',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '週報期數 (week_number)' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['docs', 'digital'], description: '篩選平台版本' },
        },
      },
    },
  }, async (request, reply) => {
    const weekNumber = parseInt(request.params.id, 10);
    const { platform } = request.query;

    const { data: weekly, error: weeklyError } = await getSupabase()
      .from('weekly')
      .select('*')
      .eq('week_number', weekNumber)
      .single();

    if (weeklyError || !weekly) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Weekly ${weekNumber} not found`,
      });
    }

    let articlesQuery = getSupabase()
      .from('articles')
      .select('*, category:category_id(*)')
      .eq('weekly_id', weekNumber)
      .order('category_id')
      .order('id');

    if (platform) {
      articlesQuery = articlesQuery.eq('platform', platform);
    }

    const { data: articles, error: articlesError } = await articlesQuery;
    if (articlesError) throw articlesError;

    // Group articles by category
    const categoryMap = new Map<number, { id: number; name: string; sort_order: number; articles: any[] }>();
    for (const article of articles || []) {
      const cat = (article as any).category;
      const catId = article.category_id;
      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, {
          id: catId,
          name: cat?.name || '未分類',
          sort_order: cat?.sort_order || 0,
          articles: [],
        });
      }
      const { category, ...articleData } = article as any;
      categoryMap.get(catId)!.articles.push(articleData);
    }

    const categories = Array.from(categoryMap.values()).sort((a, b) => a.sort_order - b.sort_order);

    return {
      ...weekly,
      categories,
    };
  });

  // GET /articles - 文章列表
  fastify.get<{
    Querystring: { weekly_id?: string; platform?: string; category_id?: string; limit?: string; offset?: string };
  }>('/articles', {
    schema: {
      tags: ['週報'],
      summary: '文章列表',
      description: '取得文章列表，支援多種篩選條件',
      querystring: {
        type: 'object',
        properties: {
          ...paginationQueryProps,
          weekly_id: { type: 'string', description: '篩選週報期數' },
          platform: { type: 'string', enum: ['docs', 'digital'], description: '篩選平台版本' },
          category_id: { type: 'string', description: '篩選分類 ID' },
        },
      },
    },
  }, async (request) => {
    const { weekly_id, platform, category_id, limit: limitStr, offset: offsetStr } = request.query;
    const limit = Math.min(parseInt(limitStr || '20', 10), 100);
    const offset = parseInt(offsetStr || '0', 10);

    let query = getSupabase()
      .from('articles')
      .select('*, category:category_id(*)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (weekly_id) query = query.eq('weekly_id', parseInt(weekly_id, 10));
    if (platform) query = query.eq('platform', platform);
    if (category_id) query = query.eq('category_id', parseInt(category_id, 10));

    const { data, count, error } = await query;
    if (error) throw error;

    return { articles: data || [], total: count || 0, limit, offset };
  });

  // GET /articles/:id - 單篇文章
  fastify.get<{
    Params: { id: string };
  }>('/articles/:id', {
    schema: {
      tags: ['週報'],
      summary: '單篇文章',
      description: '取得單篇文章詳情',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '文章 ID' },
        },
      },
    },
  }, async (request, reply) => {
    const articleId = parseInt(request.params.id, 10);

    const { data, error } = await getSupabase()
      .from('articles')
      .select('*, category:category_id(*)')
      .eq('id', articleId)
      .single();

    if (error || !data) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Article ${articleId} not found`,
      });
    }

    return data;
  });

  // GET /books/categories - 電子書分類
  fastify.get('/books/categories', {
    schema: {
      tags: ['電子書'],
      summary: '電子書分類',
      description: '取得所有電子書分類',
    },
  }, async () => {
    const { data, error } = await getSupabase()
      .from('books_category')
      .select('*')
      .order('sort_order');

    if (error) throw error;
    return data || [];
  });

  // GET /books - 電子書列表
  fastify.get<{
    Querystring: { category_id?: string; limit?: string; offset?: string };
  }>('/books', {
    schema: {
      tags: ['電子書'],
      summary: '電子書列表',
      description: '取得電子書列表',
      querystring: {
        type: 'object',
        properties: {
          ...paginationQueryProps,
          category_id: { type: 'string', description: '篩選分類 ID' },
        },
      },
    },
  }, async (request) => {
    const { category_id, limit: limitStr, offset: offsetStr } = request.query;
    const limit = Math.min(parseInt(limitStr || '20', 10), 100);
    const offset = parseInt(offsetStr || '0', 10);

    let query = getSupabase()
      .from('books')
      .select('*, category:category_id(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category_id) query = query.eq('category_id', parseInt(category_id, 10));

    const { data, count, error } = await query;
    if (error) throw error;

    return { books: data || [], total: count || 0, limit, offset };
  });

  // GET /books/:id - 單本電子書
  fastify.get<{
    Params: { id: string };
  }>('/books/:id', {
    schema: {
      tags: ['電子書'],
      summary: '單本電子書',
      description: '取得單本電子書詳情',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '電子書 ID' },
        },
      },
    },
  }, async (request, reply) => {
    const bookId = parseInt(request.params.id, 10);

    const { data, error } = await getSupabase()
      .from('books')
      .select('*, category:category_id(*)')
      .eq('id', bookId)
      .single();

    if (error || !data) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Book ${bookId} not found`,
      });
    }

    return data;
  });

  // GET /categories - 週報文章分類
  fastify.get('/categories', {
    schema: {
      tags: ['週報'],
      summary: '週報文章分類',
      description: '取得所有週報文章分類（8 個固定分類）',
    },
  }, async () => {
    const { data, error } = await getSupabase()
      .from('category')
      .select('*')
      .order('sort_order');

    if (error) throw error;
    return data || [];
  });
};

export { apiV1Routes };
