// Database types - copied and adapted from worker/src/types/index.ts

export interface Weekly {
  week_number: number;
  status: 'draft' | 'published' | 'archived';
  publish_date: string | null;
  import_step: string | null;
  import_progress: string | null;
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
  description: string | null;
  content: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  category?: Category;
}

export interface AuditLog {
  id: number;
  user_email: string | null;
  action: 'login' | 'logout' | 'insert' | 'update' | 'delete' | 'import' | 'ai_transform' | 'create_book' | 'upload_pdf';
  table_name: string | null;
  record_id: number | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AllowedUser {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string;
}

export type WeeklyStatus = Weekly['status'];
export type Platform = Article['platform'];
export type AuditAction = AuditLog['action'];
