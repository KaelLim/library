import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Article, AuditLog, Category, Weekly } from '../types/index.js';

let supabase: SupabaseClient;

export function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  supabase = createClient(url, key);
  return supabase;
}

export function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase not initialized. Call initSupabase() first.');
  }
  return supabase;
}

// =====================
// Weekly 操作
// =====================

export async function getOrCreateWeekly(weekNumber: number): Promise<Weekly> {
  const { data: existing } = await getSupabase()
    .from('weekly')
    .select('*')
    .eq('week_number', weekNumber)
    .single();

  if (existing) {
    return existing as Weekly;
  }

  const { data, error } = await getSupabase()
    .from('weekly')
    .insert({ week_number: weekNumber })
    .select()
    .single();

  if (error) throw error;
  return data as Weekly;
}

// =====================
// Category 操作
// =====================

export async function getCategoryByName(name: string): Promise<Category | null> {
  const { data } = await getSupabase()
    .from('category')
    .select('*')
    .eq('name', name)
    .single();

  return data as Category | null;
}

export async function getOrCreateCategory(name: string, sortOrder: number): Promise<Category> {
  const existing = await getCategoryByName(name);
  if (existing) return existing;

  const { data, error } = await getSupabase()
    .from('category')
    .insert({ name, sort_order: sortOrder })
    .select()
    .single();

  if (error) throw error;
  return data as Category;
}

// =====================
// Articles 操作
// =====================

export async function insertArticle(article: Omit<Article, 'id' | 'created_at' | 'updated_at'>): Promise<Article> {
  const { data, error } = await getSupabase()
    .from('articles')
    .insert(article)
    .select()
    .single();

  if (error) throw error;
  return data as Article;
}

export async function getArticlesByWeekly(weeklyId: number, platform: 'docs' | 'digital'): Promise<Article[]> {
  const { data, error } = await getSupabase()
    .from('articles')
    .select('*')
    .eq('weekly_id', weeklyId)
    .eq('platform', platform)
    .order('category_id')
    .order('order_number');

  if (error) throw error;
  return data as Article[];
}

// =====================
// Audit Log 操作
// =====================

export async function writeAuditLog(log: Omit<AuditLog, 'id' | 'created_at'>): Promise<void> {
  const { error } = await getSupabase()
    .from('audit_logs')
    .insert(log);

  if (error) {
    console.error('Failed to write audit log:', error);
  }
}

// =====================
// Storage 操作
// =====================

export async function uploadToStorage(
  bucket: string,
  path: string,
  content: Buffer | string,
  contentType: string
): Promise<string> {
  const { error } = await getSupabase()
    .storage
    .from(bucket)
    .upload(path, content, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  const { data } = getSupabase()
    .storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
}

export async function uploadImage(
  weeklyId: number,
  filename: string,
  imageBuffer: Buffer,
  contentType: string
): Promise<string> {
  const path = `articles/${weeklyId}/images/${filename}`;
  return uploadToStorage('weekly', path, imageBuffer, contentType);
}

export async function uploadMarkdown(
  weeklyId: number,
  filename: string,
  content: string
): Promise<string> {
  const path = `articles/${weeklyId}/${filename}`;
  return uploadToStorage('weekly', path, content, 'text/markdown');
}
