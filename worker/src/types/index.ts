// 解析後的文稿結構
export interface ParsedArticle {
  order_number: number;
  title: string;
  content: string;
}

export interface ParsedCategory {
  name: string;
  sort_order: number;
  articles: ParsedArticle[];
}

export interface ParsedWeekly {
  weekly_id: number;
  categories: ParsedCategory[];
}

// 資料庫表結構
export interface Weekly {
  week_number: number;
  status: 'draft' | 'published' | 'archived';
  publish_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: number;
  weekly_id: number;
  category_id: number;
  platform: 'docs' | 'digital';
  title: string;
  content: string;
  order_number: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id?: number;
  user_email: string | null;
  action: 'login' | 'logout' | 'insert' | 'update' | 'delete' | 'import' | 'ai_transform';
  table_name: string | null;
  record_id: number | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at?: string;
}

// Worker 進度狀態
export type ImportStep =
  | 'starting'
  | 'exporting_docs'
  | 'converting_images'
  | 'uploading_original'
  | 'ai_parsing'
  | 'uploading_clean'
  | 'importing_docs'
  | 'ai_rewriting'
  | 'importing_digital'
  | 'completed'
  | 'failed';

export interface ImportProgress {
  step: ImportStep;
  progress?: string;
  error?: string;
}
