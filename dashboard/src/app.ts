import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';

// Import components
import './components/layout/tc-app-shell.js';
import './components/ui/tc-toast.js';

// Import pages (lazy loaded via router)
import './pages/page-login.js';
import './pages/page-weekly-list.js';
import './pages/page-weekly-detail.js';
import './pages/page-import-progress.js';
import './pages/page-article-edit.js';
import './pages/page-books-list.js';
import './pages/page-push.js';
import './pages/page-logs.js';
import './pages/page-test-drive.js';
import './pages/page-not-found.js';

// Import stores
import { authStore } from './stores/auth-store.js';

@customElement('tc-app')
export class TcApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    #outlet {
      height: 100%;
    }
  `;

  private static readonly WATCHDOG_INTERVAL = 3000;
  private static readonly WATCHDOG_TIMEOUT = 15000;
  private static readonly WATCHDOG_SESSION_KEY = '_tc_watchdog';

  @state()
  private isAuthenticated = false;

  private router?: Router;
  private _authReady: Promise<void> = Promise.resolve();
  private _loadingSince = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this._authReady = this.initAuth();
  }

  private async initAuth(): Promise<void> {
    await authStore.initialize();
    this.isAuthenticated = authStore.isAuthenticated;

    // Subscribe to auth changes — only re-render when auth state actually changes
    // (skip TOKEN_REFRESHED events that don't change auth status)
    authStore.subscribe((authenticated) => {
      const wasAuthenticated = this.isAuthenticated;
      this.isAuthenticated = authenticated;

      if (wasAuthenticated !== authenticated && this.router) {
        if (!authenticated) {
          Router.go('/login');
        } else {
          this.router.render(window.location.pathname);
        }
      }
    });
  }

  async firstUpdated(): Promise<void> {
    // 等待 auth 初始化完成後才啟動 Router
    await this._authReady;

    const outlet = this.shadowRoot?.getElementById('outlet');
    if (outlet) {
      this.router = new Router(outlet);
      this.router.setRoutes([
        {
          path: '/login',
          component: 'page-login',
        },
        {
          path: '/',
          component: 'page-weekly-list',
          action: () => this.authGuard(),
        },
        {
          path: '/weekly/:id',
          component: 'page-weekly-detail',
          action: () => this.authGuard(),
        },
        {
          path: '/weekly/:id/import',
          component: 'page-import-progress',
          action: () => this.authGuard(),
        },
        {
          path: '/weekly/:id/article/:articleId',
          component: 'page-article-edit',
          action: () => this.authGuard(),
        },
        {
          path: '/books',
          component: 'page-books-list',
          action: () => this.authGuard(),
        },
        {
          path: '/push',
          component: 'page-push',
          action: () => this.authGuard(),
        },
        {
          path: '/logs',
          component: 'page-logs',
          action: () => this.authGuard(),
        },
        {
          path: '/test-drive',
          component: 'page-test-drive',
          action: () => this.authGuard(),
        },
        {
          path: '(.*)',
          component: 'page-not-found',
        },
      ]);

      // 啟動 watchdog：偵測頁面卡在 loading 狀態
      this.startWatchdog();
    }
  }

  /**
   * Watchdog: 每 3 秒檢查頁面是否卡在 loading
   * 超過 15 秒 → 重新載入頁面
   * 如果 1 分鐘內已重載過 → 清除 auth 並跳轉登入（避免無限重載）
   */
  private startWatchdog(): void {
    setInterval(() => {
      const outlet = this.shadowRoot?.getElementById('outlet');
      const page = outlet?.firstElementChild as Record<string, unknown> | null;

      if (page && page['loading'] === true) {
        if (this._loadingSince === 0) {
          this._loadingSince = Date.now();
        } else if (Date.now() - this._loadingSince > TcApp.WATCHDOG_TIMEOUT) {
          console.warn('[Watchdog] Page loading timeout, recovering...');
          this._loadingSince = 0;

          const lastReload = sessionStorage.getItem(TcApp.WATCHDOG_SESSION_KEY);
          if (lastReload && Date.now() - parseInt(lastReload) < 60000) {
            // 1 分鐘內已重載過 → 清除 auth 跳轉登入
            console.warn('[Watchdog] Recent reload failed, clearing auth');
            Object.keys(localStorage)
              .filter((k) => k.startsWith('sb-'))
              .forEach((k) => localStorage.removeItem(k));
            sessionStorage.removeItem(TcApp.WATCHDOG_SESSION_KEY);
            window.location.href = '/login';
            return;
          }

          sessionStorage.setItem(TcApp.WATCHDOG_SESSION_KEY, String(Date.now()));
          window.location.reload();
        }
      } else {
        this._loadingSince = 0;
        sessionStorage.removeItem(TcApp.WATCHDOG_SESSION_KEY);
      }
    }, TcApp.WATCHDOG_INTERVAL);
  }

  private authGuard(): void {
    if (!authStore.isAuthenticated) {
      Router.go('/login');
    }
  }

  render() {
    return html`
      <div id="outlet"></div>
      <tc-toast-container></tc-toast-container>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-app': TcApp;
  }
}
