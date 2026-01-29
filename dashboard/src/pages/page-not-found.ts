import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import '../components/ui/tc-button.js';

@customElement('page-not-found')
export class PageNotFound extends LitElement {
  static styles = css`
    :host {
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      background: var(--color-bg-page);
      padding: var(--spacing-4);
    }

    .container {
      text-align: center;
    }

    .code {
      font-size: 120px;
      font-weight: var(--font-weight-bold);
      color: var(--color-accent);
      line-height: 1;
      margin-bottom: var(--spacing-4);
    }

    h1 {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    p {
      font-size: var(--font-size-base);
      color: var(--color-text-muted);
      margin-bottom: var(--spacing-6);
    }
  `;

  render() {
    return html`
      <div class="container">
        <div class="code">404</div>
        <h1>找不到頁面</h1>
        <p>您要找的頁面不存在或已被移除</p>
        <tc-button variant="primary" @click=${() => (window.location.href = '/')}>
          返回首頁
        </tc-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-not-found': PageNotFound;
  }
}
