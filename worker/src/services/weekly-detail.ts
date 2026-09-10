// Pure grouping helper for the "weekly detail" response shape. No I/O.
//
// 同時給 GET /weekly/:id 與 GET /weekly/latest 使用：把一期的文章依 category 分組、
// 依 category.sort_order 排序，並附上每組與整期的 article_count。與原本內嵌在
// /weekly/:id handler 的邏輯等價（抽出以便重用與測試）。

export interface DetailArticle {
  category_id: number;
  category?: { name?: string | null; sort_order?: number | null } | null;
  [key: string]: unknown;
}

export interface WeeklyDetailCategory {
  id: number;
  name: string;
  sort_order: number;
  articles: Record<string, unknown>[];
  article_count: number;
}

export interface WeeklyDetail extends Record<string, unknown> {
  article_count: number;
  categories: WeeklyDetailCategory[];
}

/**
 * 把整期文章依 category 分組（依 sort_order 排序），組出週報詳情回應。
 * 每篇文章會移除內嵌的 `category` 物件（分類資訊已提升到 group 層級）。
 */
export function buildWeeklyDetail(
  weekly: Record<string, unknown>,
  articles: DetailArticle[]
): WeeklyDetail {
  const categoryMap = new Map<
    number,
    { id: number; name: string; sort_order: number; articles: Record<string, unknown>[] }
  >();

  for (const article of articles) {
    const cat = article.category;
    const catId = article.category_id;
    if (!categoryMap.has(catId)) {
      categoryMap.set(catId, {
        id: catId,
        name: cat?.name || '未分類',
        sort_order: cat?.sort_order || 0,
        articles: [],
      });
    }
    const { category, ...rest } = article;
    categoryMap.get(catId)!.articles.push(rest);
  }

  const categories = Array.from(categoryMap.values())
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((cat) => ({ ...cat, article_count: cat.articles.length }));

  return {
    ...weekly,
    article_count: articles.length,
    categories,
  };
}
