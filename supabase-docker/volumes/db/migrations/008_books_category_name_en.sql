-- ============================================================
-- 008: 為 books_category 加上 name_en 欄位（英文名稱），並回填 10 個分類
-- ============================================================
-- Additive change — 既有欄位 (id, name, slug, folder_id, sort_order,
-- created_at, updated_at) 完全不動，API 回應只是多一個 name_en 欄位。
-- 只讀舊欄位的 consumer 不會壞；要顯示英文者讀 name_en 即可。
--
-- 若有人新增其它分類但未提供英文，name_en 留 NULL，前端會 fallback
-- 為純中文顯示。
-- ============================================================

ALTER TABLE public.books_category
  ADD COLUMN IF NOT EXISTS name_en TEXT;

UPDATE public.books_category SET name_en = CASE name
  WHEN '書籍'             THEN 'Other Publications'
  WHEN '慈濟週報'         THEN 'Tzu Chi Weekly'
  WHEN '慈濟道侶'         THEN 'Tzu Chi Companion'
  WHEN '慈濟月刊'         THEN 'Tzu Chi Monthly'
  WHEN '宗門足跡'         THEN 'Dharma Wisdom'
  WHEN '慈濟年鑑'         THEN 'Tzu Chi Almanac'
  WHEN '慈濟六十紀念套書' THEN 'Tzu Chi 60th Anniversary Book Collection'
  WHEN '認識慈濟'         THEN 'About Tzu Chi'
  WHEN '人道關懷與永續'   THEN 'Relief, Care, Sustainability'
  WHEN '刊物出版'         THEN 'Journals'
  ELSE name_en
END
WHERE name IN (
  '書籍', '慈濟週報', '慈濟道侶', '慈濟月刊', '宗門足跡', '慈濟年鑑',
  '慈濟六十紀念套書', '認識慈濟', '人道關懷與永續', '刊物出版'
);

COMMENT ON COLUMN public.books_category.name_en IS
  '分類的英文名稱（additive，不影響既有欄位）。新分類若沒有英文則留 NULL，前端會 fallback 為純中文顯示。';
