import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:8000';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false, // 手動控制 refresh，避免背景 tab timer 凍結導致 client 卡死
    persistSession: true,
    detectSessionInUrl: true,
    storage: sessionStorage, // 關閉 tab 即清除 session，重開需重新登入取得 Drive token
  },
});

// Supabase 官方建議：用 visibilitychange 控制 token auto-refresh
// 背景 tab 時停止 refresh timer，回到前景時重新啟動
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

// 初始啟動 auto-refresh（因為 autoRefreshToken: false）
supabase.auth.startAutoRefresh();

export default supabase;
