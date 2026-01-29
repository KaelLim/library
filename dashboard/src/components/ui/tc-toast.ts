import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { toastStore, type Toast, type ToastType } from '../../stores/toast-store.js';

@customElement('tc-toast')
export class TcToast extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      min-width: 300px;
      max-width: 400px;
      animation: slideIn var(--transition-base) ease-out;
    }

    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .toast.exiting {
      animation: slideOut var(--transition-fast) ease-in forwards;
    }

    @keyframes slideOut {
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }

    .icon {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
    }

    .success .icon {
      color: var(--color-success);
    }

    .error .icon {
      color: var(--color-error);
    }

    .warning .icon {
      color: var(--color-warning);
    }

    .info .icon {
      color: var(--color-info);
    }

    .content {
      flex: 1;
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: var(--line-height-normal);
    }

    .close-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      color: var(--color-text-muted);
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }

    .close-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }
  `;

  @property({ type: String }) toastId = '';
  @property({ type: String }) type: ToastType = 'info';
  @property({ type: String }) message = '';

  private renderIcon() {
    switch (this.type) {
      case 'success':
        return html`
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        `;
      case 'error':
        return html`
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        `;
      case 'warning':
        return html`
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        `;
      default:
        return html`
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        `;
    }
  }

  render() {
    return html`
      <div class="toast ${this.type}">
        ${this.renderIcon()}
        <span class="content">${this.message}</span>
        <button class="close-btn" @click=${this.handleClose} aria-label="關閉">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
  }

  private handleClose(): void {
    toastStore.remove(this.toastId);
  }
}

@customElement('tc-toast-container')
export class TcToastContainer extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      top: var(--spacing-4);
      right: var(--spacing-4);
      z-index: var(--z-toast);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      pointer-events: none;
    }

    tc-toast {
      pointer-events: auto;
    }
  `;

  @state()
  private toasts: Toast[] = [];

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = toastStore.subscribe((toasts) => {
      this.toasts = toasts;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  render() {
    return html`
      ${this.toasts.map(
        (toast) => html`
          <tc-toast toastId=${toast.id} type=${toast.type} message=${toast.message}></tc-toast>
        `
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-toast': TcToast;
    'tc-toast-container': TcToastContainer;
  }
}
