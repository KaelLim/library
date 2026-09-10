// Pure formatting helpers for the "latest weekly EDM" flat JSON. No I/O.
//
// 背景（bug fix）：舊版把有文章的 category「壓縮」成連續 section 編號——
//   for cid 1..8: if (article) sections.push(article)
//   result[`section${idx+1}_*`] = ...   // idx 是壓縮後的位置
// 因此某個 category 沒有文章時，後面的會整個往前遞補：category 5 缺 → 6 變 section5、
// 7 變 section6、8 變 section7，尾端 section8 變空。這對「section 位置固定」的 EDM 模板
// 是錯的（section6 應永遠是 category 6）。
//
// 新語意：section 編號 == category_id（固定位置，1→8）。沒有文章的 category 那組欄位
// 一律回空字串（保持該 section 為 null 的概念），不遞補、不位移。

/**
 * PostgREST 內嵌 to-one 關聯（`category:category_id(name)`）在執行期是單一物件，
 * 但 supabase-js 的型別推斷有時會標成陣列。兩種形狀都接受，讀取時正規化。
 */
export type EdmCategoryRef = { name?: string | null } | Array<{ name?: string | null }> | null;

export interface EdmArticle {
  id: number;
  title?: string | null;
  description?: string | null;
  content?: string | null;
  category_id: number;
  category?: EdmCategoryRef;
}

/** 從物件或陣列形狀的 category 關聯取出名稱；取不到回空字串。 */
export function categoryName(cat: EdmCategoryRef | undefined): string {
  if (!cat) return '';
  const one = Array.isArray(cat) ? cat[0] : cat;
  return one?.name || '';
}

export interface EdmWeekly {
  week_number: number;
  publish_date: string; // ISO date/timestamp
}

export interface EdmUrlHelpers {
  /** 週報前台網址（不含尾斜線），如 https://weekly.tzuchi.org.tw */
  frontendUrl: string;
  /** 將相對路徑轉為完整公開 URL；已是完整 URL 的原樣回傳，無法轉換回 null。 */
  toPublicUrl: (path: string | null | undefined, bucket?: string) => string | null;
}

const UTM_SOURCE = 'aq_edm';
const UTM_MEDIUM = 'email';
export const EDM_MAX_CATEGORY = 8; // category_id 固定 1~8

/** 從 markdown 內容抓出所有圖片 URL（`![alt](url)`）。 */
export function extractImagesFromMarkdown(content: string): string[] {
  if (!content) return [];
  const regex = /!\[[^\]]*\]\(([^\s)]+)\)/g;
  const images: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    images.push(match[1]);
  }
  return images;
}

/** 取第一張圖：markdown `![](...)` 優先，其次 HTML `<img src="">`；都沒有回空字串。 */
export function extractFirstImage(content: string | null | undefined): string {
  if (!content) return '';
  const md = extractImagesFromMarkdown(content);
  if (md[0]) return md[0];
  const htmlMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return htmlMatch ? htmlMatch[1] : '';
}

/**
 * 每個 category 取「id 最小」那篇。對輸入順序不敏感（內部以 id 取最小），
 * 呼叫端不必先排序。
 */
export function pickFirstArticlePerCategory<T extends { id: number; category_id: number }>(
  articles: T[]
): Map<number, T> {
  const byCategoryId = new Map<number, T>();
  for (const a of articles) {
    const existing = byCategoryId.get(a.category_id);
    if (!existing || a.id < existing.id) {
      byCategoryId.set(a.category_id, a);
    }
  }
  return byCategoryId;
}

/** 顯示日期 `YYYY年M月D日`（不補 0）＋ `YYYYMMDD`（補 0，供 utm_campaign）。以 UTC 解讀。 */
export function formatEdmDate(publishDateIso: string): { titleDate: string; yyyymmdd: string } {
  const d = new Date(publishDateIso);
  const yyyy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  return {
    titleDate: `${yyyy}年${mm}月${dd}日`,
    yyyymmdd: `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`,
  };
}

/**
 * 組出 EDM 可直接消費的扁平 key-value JSON。
 *
 * section 編號 == category_id（固定位置）。`maxCategory`（預設 8）以內每個 category 都會
 * 產生 `section{N}_pic/_title/_text/_link` 四個欄位；沒有文章的 category 四個欄位都是空字串。
 */
export function buildEdmPayload(
  weekly: EdmWeekly,
  articles: EdmArticle[],
  helpers: EdmUrlHelpers,
  opts: { maxCategory?: number } = {}
): Record<string, string | number> {
  const maxCategory = opts.maxCategory ?? EDM_MAX_CATEGORY;
  const byCategoryId = pickFirstArticlePerCategory(articles);

  const { titleDate, yyyymmdd } = formatEdmDate(weekly.publish_date);
  const campaign = `weekly-${weekly.week_number}-${yyyymmdd}`;

  const homepageParams = new URLSearchParams({
    utm_source: UTM_SOURCE,
    utm_medium: UTM_MEDIUM,
    utm_campaign: campaign,
  });

  const result: Record<string, string | number> = {
    title_num: weekly.week_number,
    title_date: titleDate,
    title_link: `${helpers.frontendUrl}/?${homepageParams.toString()}`,
  };

  for (let cid = 1; cid <= maxCategory; cid++) {
    const a = byCategoryId.get(cid);

    // 沒有文章的 category：該組固定留空，section 位置不位移。
    if (!a) {
      result[`section${cid}_pic`] = '';
      result[`section${cid}_title`] = '';
      result[`section${cid}_text`] = '';
      result[`section${cid}_link`] = '';
      continue;
    }

    // 第一張圖：markdown 優先，HTML img 次之；相對路徑轉公開 URL。
    const rawPic = extractFirstImage(a.content);
    result[`section${cid}_pic`] = rawPic ? helpers.toPublicUrl(rawPic, 'weekly') || rawPic : '';
    result[`section${cid}_title`] = a.title || '';
    result[`section${cid}_text`] = a.description || '';

    const articleParams = new URLSearchParams({
      utm_source: UTM_SOURCE,
      utm_medium: UTM_MEDIUM,
      utm_campaign: campaign,
      utm_content: `${a.id}-${categoryName(a.category)}`,
    });
    result[`section${cid}_link`] = `${helpers.frontendUrl}/article/${a.id}/?${articleParams.toString()}`;
  }

  return result;
}
