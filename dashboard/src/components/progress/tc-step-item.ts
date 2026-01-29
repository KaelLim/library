import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

export type StepStatus = 'pending' | 'active' | 'completed' | 'error';

@customElement('tc-step-item')
export class TcStepItem extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .step {
      display: flex;
      gap: var(--spacing-4);
      padding: var(--spacing-3) 0;
    }

    .indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all var(--transition-base);
    }

    .dot.pending {
      background: var(--color-bg-hover);
      border: 2px solid var(--color-border);
    }

    .dot.active {
      background: var(--color-accent);
      border: 2px solid var(--color-accent);
    }

    .dot.completed {
      background: var(--color-success);
      border: 2px solid var(--color-success);
    }

    .dot.error {
      background: var(--color-error);
      border: 2px solid var(--color-error);
    }

    .dot svg {
      width: 14px;
      height: 14px;
      color: white;
    }

    .dot.active .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .line {
      width: 2px;
      flex: 1;
      min-height: 20px;
      background: var(--color-border);
      transition: background var(--transition-base);
    }

    .line.completed {
      background: var(--color-success);
    }

    .content {
      flex: 1;
      padding-bottom: var(--spacing-4);
    }

    .label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-muted);
      transition: color var(--transition-fast);
    }

    .step.active .label,
    .step.completed .label {
      color: var(--color-text-primary);
    }

    .step.error .label {
      color: var(--color-error);
    }

    .description {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--spacing-1);
    }

    .progress {
      font-size: var(--font-size-xs);
      color: var(--color-accent);
      margin-top: var(--spacing-1);
    }

    .error-message {
      font-size: var(--font-size-xs);
      color: var(--color-error);
      margin-top: var(--spacing-1);
    }
  `;

  @property({ type: String }) status: StepStatus = 'pending';
  @property({ type: String }) label = '';
  @property({ type: String }) description = '';
  @property({ type: String }) progress = '';
  @property({ type: String }) error = '';
  @property({ type: Boolean }) isLast = false;

  render() {
    return html`
      <div class="step ${this.status}">
        <div class="indicator">
          <div class="dot ${this.status}">
            ${this.renderDotContent()}
          </div>
          ${!this.isLast
            ? html`
                <div
                  class="line ${classMap({
                    completed: this.status === 'completed',
                  })}"
                ></div>
              `
            : ''}
        </div>
        <div class="content">
          <div class="label">${this.label}</div>
          ${this.description
            ? html`<div class="description">${this.description}</div>`
            : ''}
          ${this.progress
            ? html`<div class="progress">${this.progress}</div>`
            : ''}
          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : ''}
        </div>
      </div>
    `;
  }

  private renderDotContent() {
    switch (this.status) {
      case 'completed':
        return html`
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
      case 'active':
        return html`<div class="spinner"></div>`;
      case 'error':
        return html`
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
      default:
        return '';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-step-item': TcStepItem;
  }
}
