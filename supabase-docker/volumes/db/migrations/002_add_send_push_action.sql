-- 補齊所有 action 類型（含已存在但遺漏的 + 新增 send_push）
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'upload_pdf',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push'
  )
);
