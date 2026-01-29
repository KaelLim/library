import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('tc-nav-group')
export class TcNavGroup extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-radius: 6px;
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .header:hover {
      background: var(--color-bg-hover);
    }

    .icon {
      width: 18px;
      height: 18px;
      color: var(--color-text-secondary);
      flex-shrink: 0;
    }

    .label {
      flex: 1;
      font-size: 14px;
      font-family: var(--font-primary);
      font-weight: normal;
      color: var(--color-text-secondary);
    }

    .chevron {
      width: 16px;
      height: 16px;
      color: var(--color-text-muted);
      transition: transform var(--transition-fast);
    }

    .chevron.expanded {
      transform: rotate(180deg);
    }

    .content {
      padding-left: 30px;
      display: none;
    }

    .content.expanded {
      display: block;
    }

    ::slotted(tc-nav-sub-item) {
      display: block;
    }
  `;

  @property({ type: String }) icon = 'newspaper';
  @property({ type: String }) label = '';
  @property({ type: Boolean }) expanded = true;

  render() {
    return html`
      <div class="header" @click=${this.toggleExpanded}>
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${this.renderIconPath()}
        </svg>
        <span class="label">${this.label}</span>
        <svg class="chevron ${classMap({ expanded: this.expanded })}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="content ${classMap({ expanded: this.expanded })}">
        <slot></slot>
      </div>
    `;
  }

  private renderIconPath() {
    const icons: Record<string, string> = {
      newspaper: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2M18 14h-8M15 18h-5M10 6h8v4h-8V6Z',
    };
    const path = icons[this.icon] || icons.newspaper;
    return html`<path d="${path}"></path>`;
  }

  private toggleExpanded() {
    this.expanded = !this.expanded;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-nav-group': TcNavGroup;
  }
}
