-- ============================================================
-- 007: 新增 4 個書庫分類
--   - 慈濟六十紀念套書 (sixty-anniversary)
--   - 認識慈濟 (about)
--   - 人道關懷與永續 (sustainability)
--   - 刊物出版 (journals)
-- ============================================================
-- 中英文對照在 dashboard 前端 BOOKS_CATEGORY_NAME_EN 維護，
-- 不寫入 DB 以避免影響 /books/categories API 的 JSON 格式。
-- 新增分類時記得同步更新 dashboard/src/services/books.ts。
--
-- folder_id 暫留 NULL；待 FlipHTML5 對應資料夾建立後，
-- 可在 dashboard 編輯或直接 UPDATE。
-- ============================================================

INSERT INTO public.books_category (name, slug, folder_id, sort_order) VALUES
  ('慈濟六十紀念套書', 'sixty-anniversary', NULL, 7),
  ('認識慈濟',         'about',             NULL, 8),
  ('人道關懷與永續',   'sustainability',    NULL, 9),
  ('刊物出版',         'journals',          NULL, 10)
ON CONFLICT (name) DO NOTHING;

-- 重設 sequence（若有手動指定 id 的情況）
SELECT setval(
  'books_category_id_seq',
  (SELECT MAX(id) FROM public.books_category)
);
