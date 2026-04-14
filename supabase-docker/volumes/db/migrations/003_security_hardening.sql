-- ============================================================
-- ISO 27001 安全強化：audit log 保留 + allowed_users 角色欄位
-- ============================================================
-- 本 migration 只做 schema 變更，不改變應用程式行為：
--   1. audit_logs 加索引並建立 6 個月歸檔函式（由 pg_cron 或 cron job 觸發）
--   2. allowed_users 新增 role 欄位（預設 'viewer'），尚未啟用 requireRole 檢查
-- ============================================================

-- 1. audit_logs.created_at 索引（加速歸檔與查詢）
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

-- 2. 歸檔函式：刪除 6 個月以前的 audit_logs
--    呼叫方式：SELECT public.archive_old_audit_logs();
--    建議由 pg_cron 每月執行：
--      SELECT cron.schedule('archive-audit-logs', '0 3 1 * *',
--        $$SELECT public.archive_old_audit_logs()$$);
CREATE OR REPLACE FUNCTION public.archive_old_audit_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.audit_logs
  WHERE created_at < NOW() - INTERVAL '6 months';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.archive_old_audit_logs IS
  'Delete audit_logs older than 6 months. Schedule monthly via pg_cron.';

-- 3. allowed_users 新增 role 欄位（預設 viewer，不影響現有邏輯）
ALTER TABLE public.allowed_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'editor', 'viewer'));

-- 現有所有使用者升為 admin，避免部署後突然無法操作
UPDATE public.allowed_users SET role = 'admin' WHERE role = 'viewer';

COMMENT ON COLUMN public.allowed_users.role IS
  'RBAC role: admin (full access), editor (write), viewer (read-only). '
  'Enforcement via worker requireRole() middleware (not yet enabled).';
