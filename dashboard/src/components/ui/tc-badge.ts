import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

export type BadgeVariant = 'draft' | 'published' | 'archived' | 'info' | 'success' | 'error' | 'warning';

@customElement('tc-badge')
export class TcBadge extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-1) var(--spacing-3);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      border-radius: var(--radius-full);
      white-space: nowrap;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .pulse .dot {
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(0.8);
      }
    }

    /* Status variants */
    .draft {
      background: var(--color-badge-draft-bg, rgba(156, 163, 175, 0.15));
      color: var(--color-badge-draft, #9CA3AF);
    }

    .draft .dot {
      background: var(--color-badge-draft, #9CA3AF);
    }

    .published {
      background: var(--color-badge-published-bg, rgba(34, 197, 94, 0.15));
      color: var(--color-badge-published, #22C55E);
    }

    .published .dot {
      background: var(--color-badge-published, #22C55E);
    }

    .archived {
      background: var(--color-badge-archived-bg, rgba(107, 114, 128, 0.15));
      color: var(--color-badge-archived, #6B7280);
    }

    .archived .dot {
      background: var(--color-badge-archived, #6B7280);
    }

    /* General variants */
    .info {
      background: var(--color-info-bg, rgba(59, 130, 246, 0.15));
      color: var(--color-info, #3B82F6);
    }

    .info .dot {
      background: var(--color-info, #3B82F6);
    }

    .success {
      background: var(--color-success-bg, rgba(34, 197, 94, 0.15));
      color: var(--color-success, #22C55E);
    }

    .success .dot {
      background: var(--color-success, #22C55E);
    }

    .error {
      background: var(--color-error-bg, rgba(239, 68, 68, 0.15));
      color: var(--color-error, #EF4444);
    }

    .error .dot {
      background: var(--color-error, #EF4444);
    }

    .warning {
      background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
      color: var(--color-warning, #F59E0B);
    }

    .warning .dot {
      background: var(--color-warning, #F59E0B);
    }
  `;

  @property({ type: String }) variant: BadgeVariant = 'info';
  @property({ type: Boolean, attribute: 'show-dot' }) showDot = false;
  @property({ type: Boolean }) pulse = false;

  render() {
    const classes = {
      badge: true,
      [this.variant]: true,
      pulse: this.pulse,
    };

    return html`
      <span class=${classMap(classes)}>
        ${this.showDot ? html`<span class="dot"></span>` : ''}
        <slot></slot>
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-badge': TcBadge;
  }
}
