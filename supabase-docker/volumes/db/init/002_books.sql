-- =============================================
-- 電子書系統 Schema
-- =============================================

-- 電子書分類
CREATE TABLE IF NOT EXISTS public.books_category (
  id BIGSERIAL NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  folder_id TEXT,                     -- FlipHTML5 資料夾 ID
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT books_category_pkey PRIMARY KEY (id),
  CONSTRAINT books_category_name_key UNIQUE (name)
);

-- 電子書
CREATE TABLE IF NOT EXISTS public.books (
  id BIGSERIAL NOT NULL,
  category_id BIGINT REFERENCES public.books_category(id) ON DELETE SET NULL,

  -- 識別
  book_id UUID DEFAULT gen_random_uuid(),  -- UUID 識別碼（與 pdf_path 的 UUID 一致）

  -- 書籍資訊
  title TEXT NOT NULL,
  introtext TEXT,                     -- 簡介
  catalogue TEXT,                     -- 目錄

  -- 作者/出版
  author TEXT,
  author_introtext TEXT,              -- 作者介紹
  publisher TEXT,
  book_date DATE,                     -- 出版日期
  isbn TEXT,

  -- 檔案
  pdf_path TEXT,                      -- bucket 路徑 or 外部 URL
  thumbnail_url TEXT,                 -- 縮圖 URL

  -- 設定
  language TEXT DEFAULT 'zh-TW',
  turn_page TEXT DEFAULT 'left',      -- left (由右往左翻) / right
  copyright TEXT,                     -- 慈濟基金會所有 / 移轉授權使用
  download BOOLEAN DEFAULT TRUE,
  online_purchase TEXT,

  -- 統計
  hits INTEGER DEFAULT 0,

  -- 時間戳
  publish_date DATE,                  -- 上架日期
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT books_pkey PRIMARY KEY (id),
  CONSTRAINT books_turn_page_check CHECK (turn_page IN ('left', 'right')),
  CONSTRAINT books_copyright_check CHECK (copyright IN ('慈濟基金會所有', '移轉授權使用'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_books_category_id ON public.books USING BTREE (category_id);
CREATE INDEX IF NOT EXISTS idx_books_created_at ON public.books USING BTREE (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_title ON public.books USING BTREE (title);
CREATE INDEX IF NOT EXISTS idx_books_pdf_path ON public.books USING BTREE (pdf_path);

-- 更新 audit_logs action check (需要先刪除再重建)
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'upload_pdf',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push'
  )
);

-- 預設電子書分類（來自既有資料）
INSERT INTO public.books_category (id, name, slug, folder_id, sort_order) VALUES
  (1, '書籍', 'book', '7405576', 1),
  (2, '慈濟週報', 'weekly', '7742461', 2),
  (3, '慈濟道侶', 'daolu', '7405577', 3),
  (4, '慈濟月刊', 'monthly', '7405573', 4),
  (5, '宗門足跡', 'footprint', '7405572', 5),
  (6, '慈濟年鑑', 'yearbook', '7405570', 6)
ON CONFLICT (name) DO UPDATE SET
  folder_id = EXCLUDED.folder_id,
  slug = EXCLUDED.slug;

-- 重設 sequence
SELECT setval('books_category_id_seq', (SELECT MAX(id) FROM books_category));

-- RLS Policies
ALTER TABLE public.books_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

-- 允許 authenticated 用戶讀取
CREATE POLICY "Allow authenticated read books_category" ON public.books_category
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read books" ON public.books
  FOR SELECT TO authenticated USING (true);

-- 允許 service_role 完全存取
CREATE POLICY "Allow service_role all books_category" ON public.books_category
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role all books" ON public.books
  FOR ALL TO service_role USING (true) WITH CHECK (true);
