// 解析後的文稿結構
export interface ParsedArticle {
  title: string;
  description?: string;
  content: string;
}

export interface ParsedCategory {
  category_id: number;
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
  description: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id?: number;
  user_email: string | null;
  action: 'login' | 'logout' | 'insert' | 'update' | 'delete' | 'import' | 'ai_transform' | 'create_book' | 'upload_pdf';
  table_name: string | null;
  record_id: number | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at?: string;
}

// =====================
// 電子書系統
// =====================

export interface BooksCategory {
  id: number;
  name: string;
  slug: string | null;
  folder_id: string | null;  // FlipHTML5 資料夾 ID
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Book {
  id: number;
  category_id: number | null;

  // FlipHTML5 相關
  book_url: string | null;
  book_id: string | null;
  thumbnail_url: string | null;

  // 書籍資訊
  title: string;
  introtext: string | null;
  catalogue: string | null;

  // 作者/出版
  author: string | null;
  author_introtext: string | null;
  publisher: string | null;
  book_date: string | null;
  isbn: string | null;

  // 檔案
  pdf_path: string | null;
  cover_image: string | null;

  // 設定
  language: string;
  turn_page: 'left' | 'right';
  copyright: string | null;
  download: boolean;
  online_purchase: string | null;

  // 統計
  hits: number;

  // 時間戳
  publish_date: string | null;
  created_at: string;
  updated_at: string;
}

export type BookInsert = Omit<Book, 'id' | 'created_at' | 'updated_at' | 'hits'> & {
  hits?: number;
};

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
