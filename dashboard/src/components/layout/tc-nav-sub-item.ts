import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('tc-nav-sub-item')
export class TcNavSubItem extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    a {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      text-decoration: none;
      transition: background var(--transition-fast);
      border-radius: 6px;
    }

    a:hover {
      background: var(--color-bg-hover);
    }

    .dot {
      width: 4px;
      height: 4px;
      border-radius: 2px;
      background: var(--color-text-muted);
      flex-shrink: 0;
    }

    a.active .dot {
      background: var(--color-accent);
    }

    .label {
      font-size: 13px;
      font-family: var(--font-primary);
      font-weight: normal;
      color: var(--color-text-secondary);
    }

    a.active .label {
      color: var(--color-text-primary);
      font-weight: 500;
    }
  `;

  @property({ type: String }) label = '';
  @property({ type: String }) href = '';

  render() {
    const isActive = window.location.pathname === this.href ||
      (this.href !== '/' && window.location.pathname.startsWith(this.href));

    return html`
      <a href=${this.href} class=${classMap({ active: isActive })}>
        <span class="dot"></span>
        <span class="label">${this.label}</span>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-nav-sub-item': TcNavSubItem;
  }
}
