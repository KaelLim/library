import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('tc-card')
export class TcCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      transition: all var(--transition-fast);
    }

    .card.interactive:hover {
      border-color: var(--color-border-hover);
      box-shadow: var(--shadow-md);
    }

    .card.interactive {
      cursor: pointer;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-4) var(--spacing-5);
      border-bottom: 1px solid var(--color-border);
    }

    .header-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .body {
      padding: var(--spacing-5);
    }

    .body.no-padding {
      padding: 0;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--spacing-3);
      padding: var(--spacing-4) var(--spacing-5);
      border-top: 1px solid var(--color-border);
      background: var(--color-bg-surface);
    }

    /* Compact variant */
    .card.compact .header {
      padding: var(--spacing-3) var(--spacing-4);
    }

    .card.compact .body {
      padding: var(--spacing-4);
    }

    .card.compact .footer {
      padding: var(--spacing-3) var(--spacing-4);
    }
  `;

  @property({ type: String }) cardTitle = '';
  @property({ type: Boolean }) interactive = false;
  @property({ type: Boolean }) compact = false;
  @property({ type: Boolean, attribute: 'no-padding' }) noPadding = false;

  render() {
    const hasHeader = this.cardTitle || this.querySelector('[slot="header-actions"]');
    const hasFooter = this.querySelector('[slot="footer"]');

    return html`
      <div
        class="card ${classMap({
          interactive: this.interactive,
          compact: this.compact,
        })}"
      >
        ${hasHeader
          ? html`
              <div class="header">
                <h3 class="header-title">${this.cardTitle}</h3>
                <div class="header-actions">
                  <slot name="header-actions"></slot>
                </div>
              </div>
            `
          : ''}

        <div class="body ${classMap({ 'no-padding': this.noPadding })}">
          <slot></slot>
        </div>

        ${hasFooter
          ? html`
              <div class="footer">
                <slot name="footer"></slot>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-card': TcCard;
  }
}
