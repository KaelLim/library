import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

@customElement('tc-nav-item')
export class TcNavItem extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-radius: 6px;
      text-decoration: none;
      transition: background var(--transition-fast);
    }

    a:hover {
      background: var(--color-bg-hover);
    }

    a.active {
      background: var(--color-bg-card);
    }

    .icon {
      width: 18px;
      height: 18px;
      color: var(--color-text-secondary);
      flex-shrink: 0;
    }

    a.active .icon {
      color: var(--color-accent);
    }

    .label {
      font-size: 14px;
      font-family: var(--font-primary);
      font-weight: normal;
      color: var(--color-text-secondary);
    }

    a.active .label {
      color: var(--color-text-primary);
      font-weight: 500;
    }
  `;

  @property({ type: String }) icon = 'newspaper';
  @property({ type: String }) label = '';
  @property({ type: String }) href = '';
  @property({ type: Boolean }) external = false;

  render() {
    const isActive = window.location.pathname === this.href ||
      (this.href !== '/' && window.location.pathname.startsWith(this.href));

    return html`
      <a href=${this.href} class=${classMap({ active: isActive })} target=${ifDefined(this.external ? '_blank' : undefined)} rel=${ifDefined(this.external ? 'noopener' : undefined)}>
        ${this.renderIcon()}
        <span class="label">${this.label}</span>
      </a>
    `;
  }

  private renderIcon() {
    const icons: Record<string, string> = {
      newspaper: `<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><path d="M18 14h-8"></path><path d="M15 18h-5"></path><path d="M10 6h8v4h-8V6Z"></path>`,
      'scroll-text': `<path d="M15 12h-5"></path><path d="M15 8h-5"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path>`,
      settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>`,
      'book-open': `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>`,
      history: `<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>`,
      'file-text': `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 13H8"></path><path d="M16 17H8"></path><path d="M16 13h-2"></path>`,
    };
    const iconPath = icons[this.icon] || icons.newspaper;

    return html`
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${unsafeSVG(iconPath)}
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-nav-item': TcNavItem;
  }
}
