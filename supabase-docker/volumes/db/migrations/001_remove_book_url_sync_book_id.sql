-- Migration: 移除 book_url 欄位，同步 book_id 與 pdf_path UUID
-- 執行環境：正式環境 Supabase Studio SQL Editor
-- 日期：2026-03-16

-- 1. 同步既有資料：將 pdf_path 的 UUID 寫入 book_id
UPDATE public.books
SET book_id = (regexp_match(pdf_path, 'books/([0-9a-f-]+)\.pdf'))[1]::uuid
WHERE pdf_path IS NOT NULL
  AND pdf_path ~ 'books/[0-9a-f-]+\.pdf'
  AND (book_id IS NULL OR book_id::text != (regexp_match(pdf_path, 'books/([0-9a-f-]+)\.pdf'))[1]);

-- 2. 移除 book_url 欄位
ALTER TABLE public.books DROP COLUMN IF EXISTS book_url;
