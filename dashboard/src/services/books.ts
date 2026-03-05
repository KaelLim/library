import { supabase } from './supabase.js';

export interface BookCategory {
  id: number;
  name: string;
  slug: string;
  folder_id: number | null;
}

export interface Book {
  id: number;
  category_id: number | null;
  book_url: string | null;
  book_id: string | null;
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
  cover_image: string | null;
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
 * 取得書籍分類列表
 */
export async function getBookCategories(): Promise<BookCategory[]> {
  const { data, error } = await supabase
    .from('books_category')
    .select('*')
    .order('id');

  if (error) throw error;
  return data || [];
}

/**
 * 取得書籍列表（含分類）
 */
export async function getBookList(categoryId?: number): Promise<BookWithCategory[]> {
  let query = supabase
    .from('books')
    .select(`
      *,
      category:books_category(*)
    `)
    .order('created_at', { ascending: false });

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
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
  const response = await fetch(`/worker/books/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
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
 * 刪除書籍
 */
export async function deleteBook(id: number): Promise<void> {
  const { error } = await supabase
    .from('books')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
