import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'google' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

@customElement('tc-button')
export class TcButton extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      border-radius: var(--radius-md);
      font-weight: var(--font-weight-medium);
      transition: all var(--transition-fast);
      cursor: pointer;
      white-space: nowrap;
      border: 1px solid transparent;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Sizes */
    .sm {
      padding: var(--spacing-1) var(--spacing-3);
      font-size: var(--font-size-sm);
      height: 32px;
    }

    .md {
      padding: var(--spacing-2) var(--spacing-4);
      font-size: var(--font-size-sm);
      height: 40px;
    }

    .lg {
      padding: var(--spacing-3) var(--spacing-6);
      font-size: var(--font-size-base);
      height: 48px;
    }

    /* Variants */
    .primary {
      background: var(--color-accent);
      color: var(--color-text-primary);
    }

    .primary:hover:not(:disabled) {
      background: var(--color-accent-hover);
    }

    .secondary {
      background: var(--color-bg-card);
      color: var(--color-text-primary);
      border-color: var(--color-border);
    }

    .secondary:hover:not(:disabled) {
      background: var(--color-bg-hover);
      border-color: var(--color-border-hover);
    }

    .outline {
      background: transparent;
      color: var(--color-text-primary);
      border-color: var(--color-border);
    }

    .outline:hover:not(:disabled) {
      background: var(--color-bg-hover);
      border-color: var(--color-border-hover);
    }

    .danger {
      background: var(--color-error);
      color: var(--color-text-primary);
    }

    .danger:hover:not(:disabled) {
      background: #dc2626;
    }

    .ghost {
      background: transparent;
      color: var(--color-text-secondary);
    }

    .ghost:hover:not(:disabled) {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .google {
      background: white;
      color: #1f1f1f;
      border-color: #dadce0;
      font-weight: var(--font-weight-medium);
    }

    .google:hover:not(:disabled) {
      background: #f8f9fa;
      border-color: #dadce0;
    }

    .google svg {
      width: 18px;
      height: 18px;
    }

    /* Full width */
    .full-width {
      width: 100%;
    }

    /* Loading state */
    .loading {
      position: relative;
      color: transparent;
    }

    .loading::after {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    .loading.primary::after,
    .loading.danger::after {
      border-color: white;
      border-right-color: transparent;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    ::slotted(svg) {
      width: 1em;
      height: 1em;
    }
  `;

  @property({ type: String }) variant: ButtonVariant = 'primary';
  @property({ type: String }) size: ButtonSize = 'md';
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean, attribute: 'full-width' }) fullWidth = false;
  @property({ type: String }) type: 'button' | 'submit' | 'reset' = 'button';

  render() {
    const classes = {
      [this.variant]: true,
      [this.size]: true,
      'full-width': this.fullWidth,
      loading: this.loading,
    };

    return html`
      <button
        class=${classMap(classes)}
        ?disabled=${this.disabled || this.loading}
        type=${this.type}
      >
        ${this.variant === 'google' ? this.renderGoogleIcon() : ''}
        <slot></slot>
      </button>
    `;
  }

  private renderGoogleIcon() {
    return html`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-button': TcButton;
  }
}
