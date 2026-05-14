-- ============================================================
-- books.book_id 索引：加速 Reader URL 查詢
-- ============================================================
-- /books/r/{book_id} 路由用 book_id 查 row（取代舊的 pdf_path 反推）
-- 原本只有 idx_books_pdf_path，加上 book_id 索引讓 reader 查詢走 index scan
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_books_book_id
  ON public.books USING BTREE (book_id);
