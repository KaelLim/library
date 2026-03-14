import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('tc-toggle')
export class TcToggle extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .label {
      font-size: 13px;
      color: var(--color-text-secondary);
      cursor: pointer;
      user-select: none;
    }

    .switch {
      position: relative;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--color-border);
      transition: 0.3s;
      border-radius: 24px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }

    .switch input:checked + .slider {
      background-color: var(--color-accent);
    }

    .switch input:checked + .slider:before {
      transform: translateX(20px);
    }
  `;

  @property({ type: Boolean }) checked = false;
  @property({ type: String }) label = '';

  render() {
    return html`
      ${this.label ? html`<span class="label">${this.label}</span>` : ''}
      <label class="switch">
        <input
          type="checkbox"
          .checked=${this.checked}
          @change=${this.handleChange}
          aria-label=${this.label || '切換'}
        />
        <span class="slider"></span>
      </label>
    `;
  }

  private handleChange(e: Event): void {
    this.checked = (e.target as HTMLInputElement).checked;
    this.dispatchEvent(
      new CustomEvent('tc-toggle-change', {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-toggle': TcToggle;
  }
}
