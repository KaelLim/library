// Main entry point
import './app.js';

// bfcache recovery: 瀏覽器從 back-forward cache 還原頁面時，
// JS 狀態（WebSocket、Supabase 連線）已經過期，必須重新載入
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

// Log startup
console.log('Dashboard starting...');
