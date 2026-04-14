import { FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getSupabase, insertAuditLog } from '../services/supabase.js';
import { subscribeToken, unsubscribeToken, sendPushNotification } from '../services/push-notification.js';
import { requireAuth } from '../middleware/auth.js';

const PUBLIC_BASE = process.env.SUPABASE_PUBLIC_URL || process.env.API_EXTERNAL_URL || 'http://localhost:8000';

/** 將相對路徑轉為完整公開 URL，已是完整 URL 的不動 */
function toPublicUrl(path: string | null | undefined, bucket?: string): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `${PUBLIC_BASE}${path}`;
  // 相對路徑：需要加上 bucket 名稱
  const bucketPrefix = bucket ? `${bucket}/` : '';
  return `${PUBLIC_BASE}/storage/v1/object/public/${bucketPrefix}${path}`;
}

const paginationQueryProps = {
  limit: { type: 'string', description: '每頁筆數 (max 100, default 20)' },
  offset: { type: 'string', description: '起始位置 (default 0)' },
};

function parsePagination(limitStr?: string, offsetStr?: string, defaults = { limit: 20, max: 100 }) {
  const limit = Math.min(Math.max(parseInt(limitStr || String(defaults.limit), 10) || defaults.limit, 1), defaults.max);
  const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);
  return { limit, offset };
}

function paginate<T>(data: T[], total: number, limit: number, offset: number) {
  const page = Math.floor(offset / limit) + 1;
  const page_count = Math.ceil(total / limit) || 1;
  return { total, page, page_count, limit, offset, data };
}

function extractImagesFromMarkdown(content: string): string[] {
  if (!content) return [];
  const regex = /!\[[^\]]*\]\(([^\s)]+)\)/g;
  const images: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    images.push(match[1]);
  }
  return images;
}

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
    const { limit, offset } = parsePagination(limitStr, offsetStr);

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

    const rows = (data || []).map((w: any) => ({
      ...w,
      article_count: w.articles?.[0]?.count || 0,
      articles: undefined,
    }));

    return paginate(rows, count || 0, limit, offset);
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
    const categoryMap = new Map<number, { id: number; name: string; sort_order: number; articles: Record<string, unknown>[] }>();
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

    const categories = Array.from(categoryMap.values())
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((cat) => ({ ...cat, article_count: cat.articles.length }));

    return {
      ...weekly,
      article_count: (articles || []).length,
      categories,
    };
  });

  // GET /weekly-feed - 週報 Feed（含文章摘要，取代 N+1 查詢）
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/weekly-feed', {
    schema: {
      tags: ['週報'],
      summary: '週報 Feed（含文章摘要）',
      description: '一次回傳週報列表 + 每期各分類第一篇文章，取代 N+1 查詢',
      querystring: {
        type: 'object',
        properties: {
          ...paginationQueryProps,
        },
      },
    },
  }, async (request) => {
    const { limit: limitStr, offset: offsetStr } = request.query;
    const { limit, offset } = parsePagination(limitStr, offsetStr, { limit: 6, max: 20 });

    // 1. 取得週報列表
    const { data: weeklyList, count, error: weeklyError } = await getSupabase()
      .from('weekly')
      .select('*', { count: 'exact' })
      .eq('status', 'published')
      .order('week_number', { ascending: false })
      .range(offset, offset + limit - 1);

    if (weeklyError) throw weeklyError;
    if (!weeklyList || weeklyList.length === 0) {
      return paginate([], count || 0, limit, offset);
    }

    // 2. 一次取得所有相關文章（IN query，取代 N+1）
    const weekNumbers = weeklyList.map((w: any) => w.week_number);
    const { data: allArticles, error: artError } = await getSupabase()
      .from('articles')
      .select('id, title, description, content, category_id, weekly_id')
      .in('weekly_id', weekNumbers)
      .eq('platform', 'digital')
      .order('category_id')
      .order('id');

    if (artError) throw artError;

    // 3. 按 weekly_id 分組，每個 category 取第一篇
    const articlesByWeekly = new Map<number, any[]>();
    for (const art of allArticles || []) {
      if (!articlesByWeekly.has(art.weekly_id)) {
        articlesByWeekly.set(art.weekly_id, []);
      }
      articlesByWeekly.get(art.weekly_id)!.push(art);
    }

    // 4. 組合結果
    const data = weeklyList.map((weekly: any) => {
      const articles = articlesByWeekly.get(weekly.week_number) || [];

      const categoryFirstMap = new Map<number, any>();
      for (const art of articles) {
        if (!categoryFirstMap.has(art.category_id)) {
          const images = extractImagesFromMarkdown(art.content);
          categoryFirstMap.set(art.category_id, {
            id: art.id,
            title: art.title,
            description: art.description,
            category_id: art.category_id,
            images,
          });
        }
      }

      const slides = Array.from(categoryFirstMap.values())
        .sort((a, b) => a.category_id - b.category_id);

      return {
        weekly_id: weekly.week_number,
        publish_date: weekly.publish_date,
        status: weekly.status,
        slides,
      };
    });

    return paginate(data, count || 0, limit, offset);
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
    const { limit, offset } = parsePagination(limitStr, offsetStr);

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

    // 為 digital 文稿附加 mp3_url（批次 check Storage）
    const articles = data || [];
    if (weekly_id && articles.length > 0) {
      const wid = parseInt(weekly_id, 10);
      const { data: mp3Files } = await getSupabase().storage
        .from('weekly')
        .list(`articles/${wid}/mp3`);

      if (mp3Files) {
        const mp3Set = new Set(mp3Files.map(f => f.name));
        const baseUrl = `${PUBLIC_BASE}/storage/v1/object/public/weekly`;
        for (const article of articles) {
          if (mp3Set.has(`${article.id}.mp3`)) {
            (article as any).mp3_url = `${baseUrl}/articles/${wid}/mp3/${article.id}.mp3`;
          }
        }
      }
    }

    return paginate(articles, count || 0, limit, offset);
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

    // 檢查 mp3 是否存在
    const mp3Path = `articles/${data.weekly_id}/mp3/${data.id}.mp3`;
    const { data: mp3Files } = await getSupabase().storage
      .from('weekly')
      .list(`articles/${data.weekly_id}/mp3`, { search: `${data.id}.mp3` });

    if (mp3Files?.some(f => f.name === `${data.id}.mp3`)) {
      const baseUrl = `${PUBLIC_BASE}/storage/v1/object/public/weekly`;
      (data as any).mp3_url = `${baseUrl}/${mp3Path}`;
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
      .select('*, books(count)')
      .order('sort_order');

    if (error) throw error;
    return (data || []).map((c: any) => ({
      ...c,
      book_count: c.books?.[0]?.count || 0,
      books: undefined,
    }));
  });

  // GET /books - 電子書列表 / 搜尋
  fastify.get<{
    Querystring: { category_id?: string; q?: string; limit?: string; offset?: string };
  }>('/books', {
    schema: {
      tags: ['電子書'],
      summary: '電子書列表 / 搜尋',
      description: '取得電子書列表；提供 q 時對 title / author / publisher / isbn / introtext 做模糊搜尋',
      querystring: {
        type: 'object',
        properties: {
          ...paginationQueryProps,
          category_id: { type: 'string', description: '篩選分類 ID' },
          q: { type: 'string', description: '關鍵字搜尋（標題／作者／出版社／ISBN／簡介）' },
        },
      },
    },
  }, async (request) => {
    const { category_id, q, limit: limitStr, offset: offsetStr } = request.query;
    const { limit, offset } = parsePagination(limitStr, offsetStr);

    let query = getSupabase()
      .from('books')
      .select('*, category:category_id(*)', { count: 'exact' })
      .order('publish_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category_id) query = query.eq('category_id', parseInt(category_id, 10));

    if (q) {
      // 白名單過濾：只保留字母、數字、中日韓文字、空白、常見標點；
      // 其餘字元（逗號、括號、反斜線、%、* 等會破壞 PostgREST or() 語法）全部移除
      const keyword = q
        .trim()
        .replace(/[^\p{L}\p{N}\s\-_.@]/gu, '')
        .slice(0, 100);
      if (keyword) {
        const pattern = `%${keyword}%`;
        query = query.or(
          `title.ilike.${pattern},author.ilike.${pattern},publisher.ilike.${pattern},isbn.ilike.${pattern},introtext.ilike.${pattern}`
        );
      }
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const books = (data || []).map((b: any) => ({
      ...b,
      pdf_path: toPublicUrl(b.pdf_path, 'books'),
      thumbnail_url: toPublicUrl(b.thumbnail_url, 'books'),
      reader_url: b.book_id ? `${PUBLIC_BASE}/books/r/${b.book_id}` : null,
    }));

    return paginate(books, count || 0, limit, offset);
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

    return {
      ...data,
      pdf_path: toPublicUrl(data.pdf_path, 'books'),
      thumbnail_url: toPublicUrl(data.thumbnail_url, 'books'),
      reader_url: data.book_id ? `${PUBLIC_BASE}/books/r/${data.book_id}` : null,
    };
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
      .select('*, articles(count)')
      .order('sort_order');

    if (error) throw error;
    return (data || []).map((c: any) => ({
      ...c,
      article_count: c.articles?.[0]?.count || 0,
      articles: undefined,
    }));
  });
  // POST /push/subscribe - 訂閱推播
  fastify.post<{
    Body: { token: string };
  }>('/push/subscribe', {
    schema: {
      tags: ['推播'],
      summary: '訂閱推播',
      description: '註冊 FCM token 以接收推播通知',
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            minLength: 50,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9_:-]+$',
            description: 'FCM token',
          },
        },
      },
    },
  }, async (request) => {
    const { token } = request.body;
    return subscribeToken(token);
  });

  // POST /push/unsubscribe - 取消訂閱
  fastify.post<{
    Body: { token: string };
  }>('/push/unsubscribe', {
    schema: {
      tags: ['推播'],
      summary: '取消訂閱推播',
      description: '停用 FCM token',
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            minLength: 50,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9_:-]+$',
            description: 'FCM token',
          },
        },
      },
    },
  }, async (request) => {
    const { token } = request.body;
    return unsubscribeToken(token);
  });

  // POST /push/send - 發送推播（dashboard 用）
  fastify.post<{
    Body: { title: string; body: string; url?: string; source?: string };
  }>('/push/send', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    schema: {
      tags: ['推播'],
      summary: '發送推播通知',
      description: '發送推播通知給所有訂閱者',
      body: {
        type: 'object',
        required: ['title', 'body'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 100, description: '通知標題' },
          body: { type: 'string', minLength: 1, maxLength: 500, description: '通知內文' },
          url: { type: 'string', maxLength: 500, pattern: '^(https://|/)', description: '點擊後開啟的網址' },
          source: { type: 'string', enum: ['custom', 'weekly_publish', 'article'], default: 'custom', description: '推播來源' },
        },
      },
    },
  }, async (request) => {
    const { title, body, url, source = 'custom' } = request.body;
    const result = await sendPushNotification({ title, body, url });

    // 寫入 audit log（使用 insertAuditLog helper，同 books.ts / articles.ts 寫法）
    await insertAuditLog({
      user_email: (request as any).user?.email || null,
      action: 'send_push',
      table_name: 'push_subscriptions',
      record_id: null,
      old_data: null,
      new_data: null,
      metadata: { title, body, url, sent: result.sent, failed: result.failed, source },
    });

    return result;
  });

  // GET /push/logs - 查詢推播歷史
  fastify.get<{
    Querystring: { limit?: string; offset?: string; source?: string };
  }>('/push/logs', {
    preHandler: [requireAuth],
    schema: {
      tags: ['推播'],
      summary: '查詢推播歷史',
      description: '從 audit_logs 查詢推播紀錄',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
          offset: { type: 'string' },
          source: { type: 'string', enum: ['custom', 'weekly_publish', 'article'] },
        },
      },
    },
  }, async (request) => {
    const { limit: limitStr, offset: offsetStr, source } = request.query;
    const { limit, offset } = parsePagination(limitStr, offsetStr);

    const supabase = getSupabase();

    // Count query
    let countQuery = supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'send_push');

    if (source) {
      countQuery = countQuery.eq('metadata->>source', source);
    }

    const { count } = await countQuery;

    // Data query
    let dataQuery = supabase
      .from('audit_logs')
      .select('id, user_email, metadata, created_at')
      .eq('action', 'send_push')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (source) {
      dataQuery = dataQuery.eq('metadata->>source', source);
    }

    const { data, error } = await dataQuery;

    if (error) throw error;

    return paginate(data || [], count || 0, limit, offset);
  });
};

export { apiV1Routes };
