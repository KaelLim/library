import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import './tc-sidebar.js';

@customElement('tc-app-shell')
export class TcAppShell extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--color-bg-page);
    }

    .shell {
      display: flex;
      min-height: 100vh;
    }

    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      margin-left: var(--sidebar-width);
      transition: margin-left var(--transition-base);
    }

    .main.collapsed {
      margin-left: var(--sidebar-collapsed-width);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: var(--header-height);
      padding: 0 var(--spacing-6);
      background: var(--color-bg-surface);
      border-bottom: 1px solid var(--color-border);
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
    }

    .header-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
    }

    .content {
      flex: 1;
      padding: var(--spacing-6);
    }

    /* Mobile */
    @media (max-width: 768px) {
      .main {
        margin-left: 0;
      }

      .main.collapsed {
        margin-left: 0;
      }
    }
  `;

  @property({ type: String }) pageTitle = '';
  @property({ type: Boolean }) sidebarCollapsed = false;

  @state()
  private _sidebarCollapsed = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._sidebarCollapsed = this.sidebarCollapsed;
  }

  render() {
    return html`
      <div class="shell">
        <tc-sidebar
          ?collapsed=${this._sidebarCollapsed}
          @tc-sidebar-toggle=${this.handleSidebarToggle}
        ></tc-sidebar>

        <main class="main ${classMap({ collapsed: this._sidebarCollapsed })}">
          <header class="header">
            <div class="header-left">
              <h1 class="header-title">${this.pageTitle}</h1>
              <slot name="header-left"></slot>
            </div>
            <div class="header-right">
              <slot name="header-right"></slot>
            </div>
          </header>

          <div class="content">
            <slot></slot>
          </div>
        </main>
      </div>
    `;
  }

  private handleSidebarToggle(e: CustomEvent): void {
    this._sidebarCollapsed = e.detail.collapsed;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-app-shell': TcAppShell;
  }
}
