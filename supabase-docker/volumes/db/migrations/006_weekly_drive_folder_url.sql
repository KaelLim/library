-- ============================================================
-- weekly.drive_folder_url：記住每期週報的 Drive 圖片資料夾
-- ============================================================
-- 用途：
--   1. import 時自動寫入，補圖功能可預填上次的資料夾
--   2. 已上架週報「從 Drive 補圖」按鈕的預設值
-- ============================================================

ALTER TABLE public.weekly
  ADD COLUMN IF NOT EXISTS drive_folder_url TEXT;

COMMENT ON COLUMN public.weekly.drive_folder_url IS
  'Google Drive 高解析度圖片資料夾 URL，import 時寫入，補圖功能可重用。';
