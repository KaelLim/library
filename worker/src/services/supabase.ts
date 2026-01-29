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
    .order('id');

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

// =====================
// 額外方法（HTTP API 用）
// =====================

export async function getArticleById(articleId: number): Promise<(Article & { category?: Category }) | null> {
  const { data } = await getSupabase()
    .from('articles')
    .select('*, category:category_id(*)')
    .eq('id', articleId)
    .single();

  return data as (Article & { category?: Category }) | null;
}


export async function updateArticle(
  articleId: number,
  updates: Partial<Pick<Article, 'title' | 'description' | 'content'>>
): Promise<void> {
  const { error } = await getSupabase()
    .from('articles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', articleId);

  if (error) throw error;
}

export async function getArticlesWithoutDescription(
  limit: number = 100
): Promise<(Article & { category?: Category })[]> {
  const { data, error } = await getSupabase()
    .from('articles')
    .select('*, category:category_id(*)')
    .is('description', null)
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data as (Article & { category?: Category })[];
}

export async function insertAuditLog(log: Omit<AuditLog, 'id' | 'created_at'>): Promise<void> {
  await writeAuditLog(log);
}

// =====================
// Import Progress 操作
// =====================

export interface ImportProgress {
  step: string;
  progress?: string;
  error?: string;
}

/**
 * 更新 weekly 表的匯入進度
 */
export async function updateImportProgress(
  weeklyId: number,
  progress: ImportProgress
): Promise<void> {
  const { error } = await getSupabase()
    .from('weekly')
    .update({
      import_step: progress.step,
      import_progress: progress.progress || null,
      import_error: progress.error || null,
    })
    .eq('week_number', weeklyId);

  if (error) {
    console.error('Failed to update import progress:', error);
  }
}

/**
 * 清除匯入進度（匯入完成或失敗後）
 */
export async function clearImportProgress(weeklyId: number): Promise<void> {
  const { error } = await getSupabase()
    .from('weekly')
    .update({
      import_step: null,
      import_progress: null,
      import_error: null,
    })
    .eq('week_number', weeklyId);

  if (error) {
    console.error('Failed to clear import progress:', error);
  }
}

/**
 * 廣播匯入進度到 Realtime channel
 */
export async function broadcastImportProgress(
  weeklyId: number,
  progress: ImportProgress
): Promise<void> {
  const channel = getSupabase().channel(`import:${weeklyId}`);

  await channel.send({
    type: 'broadcast',
    event: 'progress',
    payload: progress,
  });
}
