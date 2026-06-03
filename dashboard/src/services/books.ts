import { supabase } from './supabase.js';
import { authStore } from '../stores/auth-store.js';

export interface BookCategory {
  id: number;
  name: string;
  slug: string;
  folder_id: number | null;
}

export interface Book {
  id: number;
  category_id: number | null;
  book_id: string | null;  // UUID（與 pdf_path 的 UUID 一致）
  title: string;
  introtext: string | null;
  catalogue: string | null;
  author: string | null;
  author_introtext: string | null;
  publisher: string | null;
  isbn: string | null;
  book_date: string | null;
  publish_date: string | null;
  page_count: number | null;
  pdf_path: string | null;
  thumbnail_url: string | null;
  language: string | null;
  turn_page: 'left' | 'right' | null;
  copyright: string | null;
  download: boolean;
  online_purchase: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookWithCategory extends Book {
  category: BookCategory | null;
}

/**
 * 書庫分類中英文對照（slug → English name）。
 *
 * 不寫入 DB 以避免改動 /books/categories 的 JSON 格式，僅供 dashboard UI 顯示。
 * 新增分類時請同步更新此 map；slug 未列於此者，UI 只顯示中文。
 */
export const BOOKS_CATEGORY_NAME_EN: Record<string, string> = {
  book: 'Other Publications',
  weekly: 'Tzu Chi Weekly',
  daolu: 'Tzu Chi Companion',
  monthly: 'Tzu Chi Monthly',
  footprint: 'Dharma Wisdom',
  yearbook: 'Tzu Chi Almanac',
  'sixty-anniversary': 'Tzu Chi 60th Anniversary Book Collection',
  about: 'About Tzu Chi',
  sustainability: 'Relief, Care, Sustainability',
  journals: 'Journals',
};

export function getCategoryNameEn(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return BOOKS_CATEGORY_NAME_EN[slug] ?? null;
}

/** 「中文 ／ English」格式；無對照時只回中文；空 category 回 fallback。 */
export function getCategoryDisplayName(
  category: { name?: string | null; slug?: string | null } | null | undefined,
  fallback = '未分類'
): string {
  const name = category?.name ?? '';
  if (!name) return fallback;
  const en = getCategoryNameEn(category?.slug);
  return en ? `${name} ／ ${en}` : name;
}

/**
 * 取得書籍分類列表
 */
export async function getBookCategories(): Promise<BookCategory[]> {
  const { data, error } = await supabase
    .from('books_category')
    .select('*')
    .order('sort_order');

  if (error) throw error;
  return data || [];
}

export interface BookListOptions {
  categoryId?: number;
  offset?: number;
  limit?: number;
}

export interface BookListResult {
  books: BookWithCategory[];
  total: number;
}

/**
 * 取得書籍列表（含分類，支援分頁）
 */
export async function getBookList(opts: BookListOptions = {}): Promise<BookListResult> {
  const { categoryId, offset = 0, limit = 24 } = opts;

  let query = supabase
    .from('books')
    .select(
      `
      *,
      category:books_category(*)
    `,
      { count: 'exact' }
    )
    .order('publish_date', { ascending: false });

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) throw error;
  return { books: data || [], total: count ?? 0 };
}

/**
 * 取得各分類 + 全部的書籍筆數（分頁 UI 的 tab count 用）
 */
export async function getBookCategoryCounts(
  categories: BookCategory[]
): Promise<Record<string, number>> {
  const countQueries = [
    supabase.from('books').select('id', { count: 'exact', head: true }),
    ...categories.map((cat) =>
      supabase
        .from('books')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', cat.id)
    ),
  ];

  const results = await Promise.all(countQueries);

  const counts: Record<string, number> = {};
  counts.all = results[0].count ?? 0;
  categories.forEach((cat, i) => {
    counts[cat.id] = results[i + 1].count ?? 0;
  });
  return counts;
}

/**
 * 取得單一書籍詳情
 */
export async function getBook(id: number): Promise<BookWithCategory | null> {
  const { data, error } = await supabase
    .from('books')
    .select(`
      *,
      category:books_category(*)
    `)
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * 更新書籍（透過 Worker API）
 */
export async function updateBook(id: number, updates: Partial<Omit<Book, 'id' | 'created_at' | 'updated_at'>>): Promise<Book> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  const token = authStore.session?.access_token || '';
  const response = await fetch(`/worker/books/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '更新失敗');
  }

  const result = await response.json();
  return result.book;
}

/**
 * 更新書籍封面（Worker multipart API）
 */
export async function uploadBookCover(
  id: number,
  file: File
): Promise<{ thumbnail_url: string; book: Book }> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  const token = authStore.session?.access_token || '';
  const formData = new FormData();
  formData.append('cover_file', file);

  const response = await fetch(`/worker/books/${id}/cover`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '封面更新失敗');
  }

  return response.json();
}

/**
 * 替換書籍 PDF（Worker multipart API，202 + 背景處理）
 * 透過 subscribeToBookUploadProgress(task_id) 監聽進度
 */
export async function replaceBookPdf(
  id: number,
  pdfFile: File,
  opts: {
    coverFile?: File;
    regenerateThumbnail?: boolean;
    userEmail?: string;
  } = {}
): Promise<{ task_id: string; book_id: number }> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  const token = authStore.session?.access_token || '';
  const formData = new FormData();

  // Text fields BEFORE file (見 @fastify/multipart 順序需求)
  if (opts.regenerateThumbnail) formData.append('regenerate_thumbnail', 'true');
  if (opts.userEmail) formData.append('user_email', opts.userEmail);
  if (opts.coverFile) formData.append('cover_file', opts.coverFile);
  formData.append('pdf_file', pdfFile);

  const response = await fetch(`/worker/books/${id}/pdf`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'PDF 替換失敗');
  }

  return response.json();
}

/**
 * 刪除書籍
 */
export async function deleteBook(id: number): Promise<void> {
  const { error } = await supabase
    .from('books')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
