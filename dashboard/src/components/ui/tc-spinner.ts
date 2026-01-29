import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('tc-spinner')
export class TcSpinner extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .spinner {
      border-radius: 50%;
      border-style: solid;
      border-color: var(--color-accent);
      border-right-color: transparent;
      animation: spin 0.75s linear infinite;
    }

    .sm {
      width: 16px;
      height: 16px;
      border-width: 2px;
    }

    .md {
      width: 24px;
      height: 24px;
      border-width: 2px;
    }

    .lg {
      width: 40px;
      height: 40px;
      border-width: 3px;
    }

    .xl {
      width: 56px;
      height: 56px;
      border-width: 4px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Centered overlay mode */
    :host([overlay]) {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: var(--z-modal);
    }
  `;

  @property({ type: String }) size: 'sm' | 'md' | 'lg' | 'xl' = 'md';

  render() {
    return html`<div class="spinner ${this.size}"></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-spinner': TcSpinner;
  }
}
