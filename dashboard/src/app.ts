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

  @state()
  private isAuthenticated = false;

  private router?: Router;

  connectedCallback(): void {
    super.connectedCallback();
    this.initAuth();
  }

  private async initAuth(): Promise<void> {
    await authStore.initialize();
    this.isAuthenticated = authStore.isAuthenticated;

    // Subscribe to auth changes
    authStore.subscribe((authenticated) => {
      this.isAuthenticated = authenticated;
      if (this.router) {
        // Re-navigate on auth change
        const currentPath = window.location.pathname;
        this.router.render(currentPath);
      }
    });
  }

  firstUpdated(): void {
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
          path: '(.*)',
          component: 'page-not-found',
        },
      ]);
    }
  }

  private authGuard(): void {
    // Auth disabled for development - enable when Supabase is running
    // if (!authStore.isAuthenticated) {
    //   Router.go('/login');
    // }
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
