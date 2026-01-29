import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { authStore } from '../stores/auth-store.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/ui/tc-button.js';

@customElement('page-login')
export class PageLogin extends LitElement {
  static styles = css`
    :host {
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      background: var(--color-bg-page);
      padding: var(--spacing-4);
    }

    .login-card {
      width: 100%;
      max-width: 400px;
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      padding: var(--spacing-8);
      text-align: center;
    }

    .logo {
      width: 64px;
      height: 64px;
      background: var(--color-accent);
      border-radius: var(--radius-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto var(--spacing-6);
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: white;
    }

    h1 {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    .subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
      margin-bottom: var(--spacing-8);
    }

    .error {
      background: var(--color-error-bg);
      color: var(--color-error);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      margin-bottom: var(--spacing-4);
    }

    tc-button {
      width: 100%;
    }

    .footer {
      margin-top: var(--spacing-6);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }
  `;

  @state()
  private loading = false;

  @state()
  private error = '';

  connectedCallback(): void {
    super.connectedCallback();
    // Check if already logged in
    if (authStore.isAuthenticated) {
      Router.go('/');
    }
  }

  render() {
    return html`
      <div class="login-card">
        <div class="logo">慈</div>
        <h1>慈濟週報管理系統</h1>
        <p class="subtitle">請使用 Google 帳號登入</p>

        ${this.error ? html`<div class="error">${this.error}</div>` : ''}

        <tc-button
          variant="google"
          ?loading=${this.loading}
          @click=${this.handleGoogleLogin}
        >
          使用 Google 登入
        </tc-button>

        <p class="footer">僅限授權使用者登入</p>
      </div>
    `;
  }

  private async handleGoogleLogin(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await authStore.signInWithGoogle();

    if (result.error) {
      this.error = result.error;
      this.loading = false;
      toastStore.error('登入失敗：' + result.error);
    }
    // Note: OAuth will redirect, so we don't need to handle success here
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-login': PageLogin;
  }
}
