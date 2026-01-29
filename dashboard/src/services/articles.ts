import { supabase } from './supabase.js';
import type { Article, Category, Platform } from '../types/index.js';

export interface ArticleWithCategory extends Article {
  category: Category;
}

export async function getArticles(
  weeklyId: number,
  platform?: Platform,
  categoryId?: number
): Promise<ArticleWithCategory[]> {
  let query = supabase
    .from('articles')
    .select('*, category(*)')
    .eq('weekly_id', weeklyId)
    .order('category_id', { ascending: true })
    .order('id', { ascending: true });

  if (platform) {
    query = query.eq('platform', platform);
  }

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching articles:', error);
    throw new Error(error.message);
  }

  return (data || []) as ArticleWithCategory[];
}

export async function getArticle(id: number): Promise<ArticleWithCategory | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('*, category(*)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching article:', error);
    throw new Error(error.message);
  }

  return data as ArticleWithCategory;
}

export async function updateArticle(
  id: number,
  updates: { title?: string; content?: string }
): Promise<Article> {
  const { data, error } = await supabase
    .from('articles')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating article:', error);
    throw new Error(error.message);
  }

  return data;
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('category')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching categories:', error);
    throw new Error(error.message);
  }

  return data || [];
}

export async function getArticleCountsByCategory(
  weeklyId: number,
  platform: Platform
): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from('articles')
    .select('category_id')
    .eq('weekly_id', weeklyId)
    .eq('platform', platform);

  if (error) {
    console.error('Error fetching article counts:', error);
    throw new Error(error.message);
  }

  const counts = new Map<number, number>();
  for (const item of data || []) {
    const current = counts.get(item.category_id) || 0;
    counts.set(item.category_id, current + 1);
  }

  return counts;
}
