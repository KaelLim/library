import { FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getSupabase, insertAuditLog, getBookById } from '../services/supabase.js';
import { subscribeToken, unsubscribeToken, sendPushNotification } from '../services/push-notification.js';
import { requireAuth } from '../middleware/auth.js';
import {
  MAX_COVER_SIZE,
  isSupportedImage,
  startBookCreate,
  startBookPdfReplace,
} from '../services/book-upload.js';

const PUBLIC_BASE = process.env.SUPABASE_PUBLIC_URL || process.env.API_EXTERNAL_URL || 'http://localhost:8000';
const WEEKLY_FRONTEND_URL = process.env.WEEKLY_FRONTEND_URL || 'https://weekly.tzuchi.org.tw';

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
        description: '週報、文章、電子書 API（讀取公開、上傳需授權）',
        version: '1.0.0',
      },
      tags: [
        { name: '週報', description: '週報、文章、分類' },
        { name: '電子書', description: '電子書與電子書分類' },
        { name: '電子書上傳', description: '電子書上傳 / 替換 PDF（需授權）' },
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

  // GET /weekly/latest/edm - 最新一期週報 EDM 扁平 JSON（公開，不需認證）
  fastify.get('/weekly/latest/edm', {
    schema: {
      tags: ['週報'],
      summary: '最新一期週報（EDM 扁平 JSON）',
      description: [
        '取得最新一期已發布週報，回傳 EDM 系統可直接消費的扁平 key-value JSON。',
        '',
        '**section 編號規則**：依 `category_id` 1→8 順序，每個 category 取 `platform=digital` 且 `id` 最小那篇。',
        '找到幾篇就回幾組 section（連續編號從 1 開始，沒文章的 category 自動省略，**最多 8 組**）。',
        '',
        '**動態欄位**：`section{N}_pic`、`section{N}_title`、`section{N}_text`、`section{N}_link`（N 為 1 ~ 8）。',
        '',
        '**圖片來源**：從 `articles.content` 解析第一張圖（先試 markdown `![](...)`，再試 HTML `<img src="">`）。',
        '解析不到回空字串 `""`。',
      ].join('\n'),
      response: {
        200: {
          type: 'object',
          properties: {
            title_num: { type: 'integer', description: '週報期數（week_number）' },
            title_date: { type: 'string', description: '顯示日期，如 "2026年5月19日"（不補 0）' },
            title_link: { type: 'string', description: '週報首頁連結（含 UTM）' },
          },
          additionalProperties: { type: 'string' },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const { data: weekly, error: wErr } = await getSupabase()
      .from('weekly')
      .select('week_number, publish_date')
      .eq('status', 'published')
      .order('week_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (wErr) throw wErr;
    if (!weekly || !weekly.publish_date) {
      return reply.status(404).send({
        error: 'NO_WEEKLY',
        message: 'No published weekly found',
      });
    }

    const { data: articles, error: aErr } = await getSupabase()
      .from('articles')
      .select('id, title, description, content, category_id, category:category_id(name)')
      .eq('weekly_id', weekly.week_number)
      .eq('platform', 'digital')
      .order('category_id', { ascending: true })
      .order('id', { ascending: true });

    if (aErr) throw aErr;

    // 每個 category 取 id 最小的那篇（已 ORDER BY category_id, id ASC，第一次出現就是最小的）
    const byCategoryId = new Map<number, (typeof articles)[number]>();
    for (const a of articles || []) {
      if (!byCategoryId.has(a.category_id)) byCategoryId.set(a.category_id, a);
    }

    // 按 category_id 1→8 順序收集
    const sections: (typeof articles)[number][] = [];
    for (let cid = 1; cid <= 8; cid++) {
      const a = byCategoryId.get(cid);
      if (a) sections.push(a);
    }

    // 格式化日期
    const pubDate = new Date(weekly.publish_date);
    const yyyy = pubDate.getUTCFullYear();
    const mm = pubDate.getUTCMonth() + 1;
    const dd = pubDate.getUTCDate();
    const titleDate = `${yyyy}年${mm}月${dd}日`;
    const yyyymmdd = `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`;

    const campaign = `weekly-${weekly.week_number}-${yyyymmdd}`;
    const homepageParams = new URLSearchParams({
      utm_source: 'aq_edm',
      utm_medium: 'email',
      utm_campaign: campaign,
    });

    const result: Record<string, string | number> = {
      title_num: weekly.week_number,
      title_date: titleDate,
      title_link: `${WEEKLY_FRONTEND_URL}/?${homepageParams.toString()}`,
    };

    for (let idx = 0; idx < sections.length; idx++) {
      const a = sections[idx] as any;
      const n = idx + 1;

      // 第一張圖：markdown 優先，HTML img 次之
      const mdImages = extractImagesFromMarkdown(a.content || '');
      let pic = mdImages[0] || '';
      if (!pic) {
        const htmlMatch = (a.content || '').match(/<img[^>]+src=["']([^"']+)["']/i);
        if (htmlMatch) pic = htmlMatch[1];
      }

      const categoryName = a.category?.name || '';
      const articleParams = new URLSearchParams({
        utm_source: 'aq_edm',
        utm_medium: 'email',
        utm_campaign: campaign,
        utm_content: `${a.id}-${categoryName}`,
      });

      result[`section${n}_pic`] = pic ? (toPublicUrl(pic, 'weekly') || pic) : '';
      result[`section${n}_title`] = a.title || '';
      result[`section${n}_text`] = a.description || '';
      result[`section${n}_link`] = `${WEEKLY_FRONTEND_URL}/article/${a.id}/?${articleParams.toString()}`;
    }

    return result;
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
      .order('category_id', { ascending: true })
      .order('id', { ascending: true })
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

  // ============================================================
  // /public/books/* — 對外公開電子書 API
  // ------------------------------------------------------------
  // 同一張 books 表、同一個 books bucket，但這組 endpoint：
  //   * 只回 category.slug='public' 的書（其它分類不曝光在這裡）
  //   * 開放 CORS = *、Cache-Control: public（外站可直接 fetch / iframe）
  //   * shape 精簡：拿掉內部欄位 (hits, created_at, updated_at)，
  //     URL 一律組好（pdf_url / thumbnail_url / reader_url / embed_url）
  // 既有 /api/v1/books 行為不變、繼續看得到 public 分類的書（管理介面用）。
  // ============================================================

  /** 對外公開回應的共用 header（每個 public 路由 handler 開頭呼叫一次） */
  function setPublicResponseHeaders(reply: any, maxAgeSeconds = 300) {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.removeHeader('Access-Control-Allow-Credentials');
    reply.header('Cache-Control', `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}`);
  }

  /** 內部 books row → 對外精簡 shape */
  function toPublicBookShape(b: any) {
    return {
      id: b.id,
      title: b.title,
      description: b.introtext ?? null,
      catalogue: b.catalogue ?? null,
      author: b.author ?? null,
      author_introtext: b.author_introtext ?? null,
      publisher: b.publisher ?? null,
      book_date: b.book_date ?? null,
      publish_date: b.publish_date ?? null,
      isbn: b.isbn ?? null,
      language: b.language ?? null,
      turn_page: b.turn_page ?? null,
      copyright: b.copyright ?? null,
      pdf_url: toPublicUrl(b.pdf_path, 'books'),
      thumbnail_url: toPublicUrl(b.thumbnail_url, 'books'),
      reader_url: b.book_id ? `${PUBLIC_BASE}/books/r/${b.book_id}` : null,
      embed_url: b.book_id ? `${PUBLIC_BASE}/books/r/${b.book_id}?embed=1` : null,
      category: b.category
        ? {
            id: b.category.id,
            slug: b.category.slug,
            name: b.category.name,
            name_en: b.category.name_en,
          }
        : null,
    };
  }

  /** 解析 slug='public' 的 category id，cache 在 closure 內避免每次 query */
  let publicCategoryIdCache: number | null = null;
  async function getPublicCategoryId(): Promise<number | null> {
    if (publicCategoryIdCache !== null) return publicCategoryIdCache;
    const { data, error } = await getSupabase()
      .from('books_category')
      .select('id')
      .eq('slug', 'public')
      .maybeSingle();
    if (error || !data) return null;
    publicCategoryIdCache = data.id;
    return data.id;
  }

  // GET /public/books/categories - 公開分類資訊（含 book_count）
  fastify.get('/public/books/categories', {
    schema: {
      tags: ['電子書'],
      summary: '公開電子書分類',
      description: '回傳 slug=\'public\' 的分類資訊（含書籍數）。供外站顯示分類標題用。',
    },
  }, async (_request, reply) => {
    setPublicResponseHeaders(reply, 600);

    const { data, error } = await getSupabase()
      .from('books_category')
      .select('*, books(count)')
      .eq('slug', 'public');

    if (error) throw error;
    return (data || []).map((c: any) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      name_en: c.name_en,
      sort_order: c.sort_order,
      book_count: c.books?.[0]?.count || 0,
    }));
  });

  // GET /public/books - 公開電子書列表 / 搜尋
  fastify.get<{
    Querystring: { q?: string; limit?: string; offset?: string };
  }>('/public/books', {
    schema: {
      tags: ['電子書'],
      summary: '公開電子書列表',
      description: [
        '回傳分類為「公開出版」（slug=\'public\'）的電子書，shape 為精簡對外格式（含 embed_url）。',
        '`Access-Control-Allow-Origin: *`、`Cache-Control: public, max-age=300`，可從任意網域 fetch 或 iframe 嵌入。',
        '提供 `q` 時對 title / author / publisher / isbn / introtext 做模糊搜尋。',
      ].join('\n\n'),
      querystring: {
        type: 'object',
        properties: {
          ...paginationQueryProps,
          q: { type: 'string', description: '關鍵字搜尋' },
        },
      },
    },
  }, async (request, reply) => {
    setPublicResponseHeaders(reply);

    const { q, limit: limitStr, offset: offsetStr } = request.query;
    const { limit, offset } = parsePagination(limitStr, offsetStr);

    const publicCatId = await getPublicCategoryId();
    if (publicCatId === null) {
      // 沒裝 public 分類也不要 500，直接回空列表（migration 還沒跑時保持 graceful）
      return paginate([], 0, limit, offset);
    }

    let query = getSupabase()
      .from('books')
      .select('*, category:category_id(*)', { count: 'exact' })
      .eq('category_id', publicCatId)
      .order('publish_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (q) {
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

    const books = (data || []).map(toPublicBookShape);
    return paginate(books, count || 0, limit, offset);
  });

  // GET /public/books/:id - 單本公開電子書
  fastify.get<{
    Params: { id: string };
  }>('/public/books/:id', {
    schema: {
      tags: ['電子書'],
      summary: '單本公開電子書',
      description: '取得單本公開電子書詳情；若該書不屬於 public 分類回 404。',
      params: {
        type: 'object',
        properties: { id: { type: 'string', description: '電子書 ID' } },
      },
    },
  }, async (request, reply) => {
    setPublicResponseHeaders(reply);

    const bookId = parseInt(request.params.id, 10);
    if (!Number.isFinite(bookId)) {
      return reply.status(400).send({ error: 'BAD_ID', message: 'id must be a number' });
    }

    const publicCatId = await getPublicCategoryId();
    if (publicCatId === null) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'public category not configured' });
    }

    const { data, error } = await getSupabase()
      .from('books')
      .select('*, category:category_id(*)')
      .eq('id', bookId)
      .eq('category_id', publicCatId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: `Public book ${bookId} not found` });
    }

    return toPublicBookShape(data);
  });

  // POST /books - 上傳新電子書（multipart/form-data，202 + task_id 廣播進度）
  // validatorCompiler no-op：保留 schema 供 OpenAPI 文件使用，但跳過 AJV 驗證
  // （multipart body 由 request.parts() 讀取，不會填入 request.body，AJV 會誤判 "body must be object"）
  fastify.post('/books', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    validatorCompiler: () => () => true,
    schema: {
      tags: ['電子書上傳'],
      summary: '上傳新電子書',
      description: [
        '使用 multipart/form-data 上傳 PDF 檔，背景進行壓縮 / 縮圖 / 寫入資料庫。',
        '立即回 202 + `task_id`，可訂閱 Supabase Realtime channel `book-upload:{task_id}` 監聽進度。',
        '步驟事件：`compressing` → `uploading` → `thumbnail` → `saving` → `completed`（或 `failed`）。',
      ].join('\n\n'),
      consumes: ['multipart/form-data'],
      body: {
        type: 'object',
        required: ['pdf_file', 'title'],
        properties: {
          pdf_file: { type: 'string', format: 'binary', description: 'PDF 檔（必填）' },
          cover_file: { type: 'string', format: 'binary', description: '封面圖（可選；JPG/PNG/WebP，<=10MB）' },
          title: { type: 'string', description: '書名（必填）' },
          category_id: { type: 'string', description: '分類 ID（與 category_slug 擇一）' },
          category_slug: { type: 'string', description: '分類 slug（與 category_id 擇一）' },
          introtext: { type: 'string', description: '簡介' },
          description: { type: 'string', description: '簡介（introtext 的別名）' },
          catalogue: { type: 'string', description: '目錄' },
          author: { type: 'string', description: '作者' },
          author_introtext: { type: 'string', description: '作者簡介' },
          publisher: { type: 'string', description: '出版社' },
          book_date: { type: 'string', description: '出版日期（YYYY-MM-DD）' },
          isbn: { type: 'string', description: 'ISBN' },
          language: { type: 'string', default: 'zh-TW', description: '語言（預設 zh-TW）' },
          turn_page: { type: 'string', enum: ['left', 'right'], default: 'left', description: '翻頁方向：left=中文右翻左，right=英文左翻右' },
          copyright: { type: 'string', description: '版權聲明' },
          download: { type: 'string', enum: ['true', 'false'], default: 'true', description: '是否允許下載' },
          online_purchase: { type: 'string', description: '線上購買連結' },
          publish_date: { type: 'string', description: '上架日期（YYYY-MM-DD）' },
          thumbnail_url: { type: 'string', description: '已有縮圖 URL（提供時跳過自動產生）' },
          skip_compression: { type: 'string', enum: ['true', 'false'], default: 'false', description: '是否略過 PDF 壓縮' },
          compression_quality: { type: 'string', enum: ['screen', 'ebook', 'printer', 'prepress'], default: 'ebook', description: 'PDF 壓縮品質' },
          user_email: { type: 'string', description: '寫入 audit log 的使用者 email' },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            task_id: { type: 'string', description: 'Realtime 廣播 channel ID' },
            title: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const fields: Record<string, string> = {};
    let rawPdfBuffer: Buffer | null = null;
    let pdfFilename = '';
    let coverBuffer: Buffer | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          const buf = Buffer.concat(chunks);

          if (part.fieldname === 'pdf_file') {
            rawPdfBuffer = buf;
            pdfFilename = part.filename;
          } else if (part.fieldname === 'cover_file') {
            if (buf.length > MAX_COVER_SIZE) {
              return reply.status(400).send({
                error: 'COVER_TOO_LARGE',
                message: `封面檔案超過上限 ${MAX_COVER_SIZE / 1024 / 1024}MB`,
              });
            }
            if (!isSupportedImage(buf)) {
              return reply.status(400).send({
                error: 'INVALID_COVER',
                message: '封面必須是 JPG、PNG 或 WebP 格式',
              });
            }
            coverBuffer = buf;
          }
        } else if (part.type === 'field') {
          const v = (part as { value: unknown }).value;
          if (typeof v === 'string') fields[part.fieldname] = v;
        }
      }
    } catch (err) {
      request.log.error(err);
      return reply.status(400).send({
        error: 'UPLOAD_ERROR',
        message: err instanceof Error ? err.message : '檔案讀取失敗',
      });
    }

    if (!rawPdfBuffer) {
      return reply.status(400).send({ error: 'MISSING_FILE', message: 'pdf_file is required' });
    }
    if (!fields.title) {
      return reply.status(400).send({ error: 'MISSING_TITLE', message: 'title is required' });
    }

    let result;
    try {
      result = startBookCreate({ rawPdfBuffer, pdfFilename, coverBuffer, fields, log: request.log });
    } catch (err) {
      return reply.status(400).send({
        error: 'INVALID_PDF',
        message: err instanceof Error ? err.message : '上傳的檔案不是有效的 PDF',
      });
    }

    return reply.status(202).send({
      success: true,
      message: '檔案已接收，後台處理中',
      task_id: result.taskId,
      title: result.title,
    });
  });

  // POST /books/:id/pdf - 替換電子書 PDF
  // validatorCompiler no-op：理由同上（multipart 無法被 AJV 驗證），id 參數在 handler 中以 parseInt + getBookById 處理
  fastify.post<{ Params: { id: string } }>('/books/:id/pdf', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    validatorCompiler: () => () => true,
    schema: {
      tags: ['電子書上傳'],
      summary: '替換電子書 PDF',
      description: [
        '替換現有電子書的 PDF 檔。**`book_id` 保持不變**，因此外部 reader URL `/books/r/{book_id}` 永遠有效。',
        '舊 PDF 在 DB 更新成功後才會自動清除。回 202 + `task_id`，訂閱 channel `book-upload:{task_id}` 監聽進度。',
      ].join('\n\n'),
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        properties: { id: { type: 'string', description: '電子書 ID（books.id）' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['pdf_file'],
        properties: {
          pdf_file: { type: 'string', format: 'binary', description: 'PDF 檔（必填）' },
          cover_file: { type: 'string', format: 'binary', description: '新封面圖（可選；提供時覆蓋舊縮圖）' },
          regenerate_thumbnail: { type: 'string', enum: ['true', 'false'], default: 'false', description: '未提供 cover_file 時，是否從新 PDF 第一頁重新擷取縮圖' },
          skip_compression: { type: 'string', enum: ['true', 'false'], default: 'false', description: '是否略過 PDF 壓縮' },
          compression_quality: { type: 'string', enum: ['screen', 'ebook', 'printer', 'prepress'], default: 'ebook', description: 'PDF 壓縮品質' },
          user_email: { type: 'string', description: '寫入 audit log 的使用者 email' },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            task_id: { type: 'string', description: 'Realtime 廣播 channel ID' },
            book_id: { type: 'number' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const bookId = parseInt(request.params.id, 10);
    const book = await getBookById(bookId);
    if (!book) {
      return reply.status(404).send({ error: 'BOOK_NOT_FOUND', message: `Book ${bookId} not found` });
    }

    const fields: Record<string, string> = {};
    let rawPdfBuffer: Buffer | null = null;
    let coverBuffer: Buffer | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          const buf = Buffer.concat(chunks);

          if (part.fieldname === 'pdf_file') {
            rawPdfBuffer = buf;
          } else if (part.fieldname === 'cover_file') {
            if (buf.length > MAX_COVER_SIZE) {
              return reply.status(400).send({
                error: 'COVER_TOO_LARGE',
                message: `封面檔案超過上限 ${MAX_COVER_SIZE / 1024 / 1024}MB`,
              });
            }
            if (!isSupportedImage(buf)) {
              return reply.status(400).send({
                error: 'INVALID_COVER',
                message: '封面必須是 JPG、PNG 或 WebP 格式',
              });
            }
            coverBuffer = buf;
          }
        } else if (part.type === 'field') {
          const v = (part as { value: unknown }).value;
          if (typeof v === 'string') fields[part.fieldname] = v;
        }
      }
    } catch (err) {
      request.log.error(err);
      return reply.status(400).send({
        error: 'UPLOAD_ERROR',
        message: err instanceof Error ? err.message : '檔案讀取失敗',
      });
    }

    if (!rawPdfBuffer) {
      return reply.status(400).send({ error: 'MISSING_FILE', message: 'pdf_file is required' });
    }

    let result;
    try {
      result = startBookPdfReplace({ book, rawPdfBuffer, coverBuffer, fields, log: request.log });
    } catch (err) {
      return reply.status(400).send({
        error: 'INVALID_PDF',
        message: err instanceof Error ? err.message : '上傳的檔案不是有效的 PDF',
      });
    }

    return reply.status(202).send({
      success: true,
      message: 'PDF 已接收，後台處理中',
      task_id: result.taskId,
      book_id: result.bookId,
    });
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
