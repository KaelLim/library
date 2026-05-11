-- ============================================================
-- 為 articles 表加入 sort_order 欄位
-- ============================================================
-- 變更內容：
--   1. ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
--   2. 依現有 id 順序 backfill（同一 weekly_id + category_id + platform 內 0-indexed）
--   3. 加複合索引加速 ORDER BY 查詢
-- ============================================================

-- 1. 新增欄位（先 nullable 再回填，最後加 NOT NULL，避免 backfill 過程中違反 constraint）
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- 2. Backfill：同 (weekly_id, category_id, platform) 群組內，按 id 升冪設定 0-indexed sort_order
UPDATE public.articles a
SET sort_order = sub.rn - 1
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY weekly_id, category_id, platform
           ORDER BY id ASC
         ) AS rn
  FROM public.articles
) sub
WHERE a.id = sub.id
  AND a.sort_order IS NULL;

-- 3. 加 NOT NULL + DEFAULT 約束
ALTER TABLE public.articles
  ALTER COLUMN sort_order SET DEFAULT 0;

ALTER TABLE public.articles
  ALTER COLUMN sort_order SET NOT NULL;

-- 4. 複合索引：ORDER BY category_id, sort_order, id 用
CREATE INDEX IF NOT EXISTS idx_articles_weekly_category_order
  ON public.articles (weekly_id, category_id, sort_order, id);

COMMENT ON COLUMN public.articles.sort_order IS
  'Display order within (weekly_id, category_id, platform). '
  '0-indexed, set by AI parser per original document order. '
  'ORDER BY sort_order, id (id as tiebreaker).';
