import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { authStore } from '../../stores/auth-store.js';
import './tc-nav-item.js';

@customElement('tc-sidebar')
export class TcSidebar extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 240px;
      background: var(--color-bg-surface);
      border-right: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      z-index: var(--z-sticky);
    }

    .main {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 16px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
    }

    .logo {
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      background: var(--color-accent);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 12px;
      flex-shrink: 0;
    }

    .title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary);
      white-space: nowrap;
    }

    .nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .footer {
      padding: 16px;
      border-top: 1px solid var(--color-border);
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      background: #4B5563;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 14px;
      font-weight: 500;
      flex-shrink: 0;
    }

    .user-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    .user-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-email {
      font-size: 12px;
      color: var(--color-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Mobile */
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform var(--transition-base);
      }

      .sidebar.open {
        transform: translateX(0);
      }
    }
  `;

  @property({ type: Boolean }) open = false;

  render() {
    const user = authStore.user;
    const initials = this.getInitials(user?.user_metadata?.full_name || user?.email || 'U');

    return html`
      <aside class="sidebar">
        <div class="main">
          <div class="header">
            <div class="logo">TZ</div>
            <span class="title">週報管理系統</span>
          </div>

          <nav class="nav">
            <tc-nav-item icon="newspaper" label="週報列表" href="/"></tc-nav-item>
            <tc-nav-item icon="scroll-text" label="審計日誌" href="/logs"></tc-nav-item>
          </nav>
        </div>

        <div class="footer">
          <div class="user-info">
            <div class="avatar">${initials}</div>
            <div class="user-details">
              <div class="user-name">${user?.user_metadata?.full_name || 'User Name'}</div>
              <div class="user-email">${user?.email || 'user@example.com'}</div>
            </div>
          </div>
        </div>
      </aside>
    `;
  }

  private getInitials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-sidebar': TcSidebar;
  }
}
