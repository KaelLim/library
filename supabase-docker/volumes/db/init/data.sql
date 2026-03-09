-- =============================================
-- 週報系統 Schema
-- =============================================

-- 週報期數
CREATE TABLE IF NOT EXISTS public.weekly (
  week_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  publish_date DATE,
  import_step TEXT,
  import_progress TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT weekly_pkey PRIMARY KEY (week_number),
  CONSTRAINT weekly_status_check CHECK (status IN ('draft', 'published', 'archived'))
);

-- 文稿分類（固定 8 個）
CREATE TABLE IF NOT EXISTS public.category (
  id BIGSERIAL NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT category_pkey PRIMARY KEY (id),
  CONSTRAINT category_name_key UNIQUE (name)
);

-- 文稿
CREATE TABLE IF NOT EXISTS public.articles (
  id BIGSERIAL NOT NULL,
  weekly_id INTEGER NOT NULL REFERENCES public.weekly(week_number) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES public.category(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL DEFAULT 'docs',
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT articles_pkey PRIMARY KEY (id),
  CONSTRAINT articles_platform_check CHECK (platform IN ('docs', 'digital'))
);

-- 稽核日誌
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL NOT NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id INTEGER,
  old_data JSONB,
  new_data JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_action_check CHECK (
    action IN ('login', 'logout', 'insert', 'update', 'delete', 'import', 'ai_transform', 'create_book', 'upload_pdf')
  )
);

-- 允許登入的使用者
CREATE TABLE IF NOT EXISTS public.allowed_users (
  id BIGSERIAL NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT allowed_users_pkey PRIMARY KEY (id),
  CONSTRAINT allowed_users_email_key UNIQUE (email)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_articles_weekly_id ON public.articles USING BTREE (weekly_id);
CREATE INDEX IF NOT EXISTS idx_articles_category_id ON public.articles USING BTREE (category_id);
CREATE INDEX IF NOT EXISTS idx_articles_platform ON public.articles USING BTREE (platform);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs USING BTREE (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs USING BTREE (action);

-- 預設 8 個固定分類
INSERT INTO public.category (id, name, sort_order) VALUES
  (1, '全球焦點', 1),
  (2, '證嚴上人開示', 2),
  (3, '慈濟要聞', 3),
  (4, '慈善志業要聞', 4),
  (5, '里仁為美', 5),
  (6, '大醫行願', 6),
  (7, '春風化雨', 7),
  (8, '人文馨香', 8)
ON CONFLICT (name) DO NOTHING;

-- 重設 sequence
SELECT setval('category_id_seq', (SELECT COALESCE(MAX(id), 1) FROM category));

-- Storage bucket for weekly articles (public: images are accessed by the public website)
INSERT INTO storage.buckets (id, name, public) VALUES ('weekly', 'weekly', true)
ON CONFLICT (id) DO NOTHING;
