import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('tc-dialog')
export class TcDialog extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-4);
      opacity: 0;
      visibility: hidden;
      transition: all var(--transition-base);
    }

    .overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .dialog {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      width: 100%;
      max-width: 480px;
      max-height: calc(100vh - var(--spacing-8));
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: scale(0.95) translateY(-20px);
      transition: transform var(--transition-base);
    }

    .overlay.open .dialog {
      transform: scale(1) translateY(0);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-4) var(--spacing-6);
      border-bottom: 1px solid var(--color-border);
    }

    .title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }

    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md);
      color: var(--color-text-muted);
      transition: all var(--transition-fast);
    }

    .close-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .body {
      padding: var(--spacing-6);
      overflow-y: auto;
      flex: 1;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--spacing-3);
      padding: var(--spacing-4) var(--spacing-6);
      border-top: 1px solid var(--color-border);
    }

    /* Size variants */
    :host([size='sm']) .dialog {
      max-width: 360px;
    }

    :host([size='lg']) .dialog {
      max-width: 640px;
    }

    :host([size='xl']) .dialog {
      max-width: 800px;
    }

    :host([size='full']) .dialog {
      max-width: calc(100vw - var(--spacing-8));
      max-height: calc(100vh - var(--spacing-8));
    }
  `;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) dialogTitle = '';
  @property({ type: String }) size: 'sm' | 'md' | 'lg' | 'xl' | 'full' = 'md';
  @property({ type: Boolean, attribute: 'hide-close' }) hideClose = false;
  @property({ type: Boolean, attribute: 'close-on-overlay' }) closeOnOverlay = true;

  render() {
    return html`
      <div class="overlay ${this.open ? 'open' : ''}" @click=${this.handleOverlayClick}>
        <div class="dialog" role="dialog" aria-modal="true" @click=${(e: Event) => e.stopPropagation()}>
          ${this.dialogTitle || !this.hideClose
            ? html`
                <div class="header">
                  <h2 class="title">${this.dialogTitle}</h2>
                  ${!this.hideClose
                    ? html`
                        <button class="close-btn" @click=${this.close} aria-label="關閉">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      `
                    : ''}
                </div>
              `
            : ''}

          <div class="body">
            <slot></slot>
          </div>

          <div class="footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    `;
  }

  private handleOverlayClick(): void {
    if (this.closeOnOverlay) {
      this.close();
    }
  }

  close(): void {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('tc-close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  show(): void {
    this.open = true;
  }

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.open) {
      this.close();
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-dialog': TcDialog;
  }
}
