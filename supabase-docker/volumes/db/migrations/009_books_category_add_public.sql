-- ============================================================
-- 009: 新增「公開出版」分類（slug='public'），供外部站台抓取 / 嵌入
-- ============================================================
-- 設計：
--   * 同一張 books 表、同一個 books bucket。
--   * 這個分類的書另外經由 /api/v1/public/books/* 對外輸出
--     （CORS = *、shape 較精簡、可長期 cache）。
--   * 既有 API (/api/v1/books) 仍會看得到它，behaviour 不變。
--
-- folder_id 留 NULL —— FlipHTML5 不一定對應到這個分類。
-- sort_order = 11，排在 008 加進來的 10 筆之後。
-- ============================================================

INSERT INTO public.books_category (name, name_en, slug, folder_id, sort_order) VALUES
  ('公開出版', 'Public', 'public', NULL, 11)
ON CONFLICT (name) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  slug = EXCLUDED.slug,
  sort_order = EXCLUDED.sort_order;

-- 重設 sequence（若手動插入過任意 id 才需要，這裡保險起見一起跑）
SELECT setval('books_category_id_seq', (SELECT MAX(id) FROM public.books_category));

COMMENT ON COLUMN public.books_category.slug IS
  '分類英文 slug；slug=''public'' 的分類會額外曝光在 /api/v1/public/books/* 公開 API。';
