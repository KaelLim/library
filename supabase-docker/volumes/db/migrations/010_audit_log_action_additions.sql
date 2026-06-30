-- 補齊 audit_logs.action CHECK：補上 worker 已 deploy 但 DB CHECK 未跟上的 3 個 action
-- - image_match        (6a3f10d)  per-category image matcher 匯入流程
-- - update_book_cover  (7e7fd72)  電子書封面替換
-- - upload_image       (2072142)  文章編輯器圖片上傳
--
-- 同模式：002_add_send_push_action.sql

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'update_book_cover',
    'upload_pdf', 'upload_image',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push', 'image_match'
  )
);
