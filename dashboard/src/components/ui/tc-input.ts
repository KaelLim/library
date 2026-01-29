import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('tc-input')
export class TcInput extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .input-wrapper {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
    }

    .required::after {
      content: ' *';
      color: var(--color-error);
    }

    .input-container {
      position: relative;
      display: flex;
      align-items: center;
    }

    input,
    textarea {
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--font-size-sm);
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      transition: all var(--transition-fast);
    }

    input::placeholder,
    textarea::placeholder {
      color: var(--color-text-muted);
    }

    input:hover:not(:disabled),
    textarea:hover:not(:disabled) {
      border-color: var(--color-border-hover);
    }

    input:focus,
    textarea:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--color-accent-light);
    }

    input:disabled,
    textarea:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    input.error,
    textarea.error {
      border-color: var(--color-error);
    }

    input.error:focus,
    textarea.error:focus {
      box-shadow: 0 0 0 3px var(--color-error-bg);
    }

    textarea {
      min-height: 100px;
      resize: vertical;
      font-family: inherit;
    }

    .helper-text {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .error-text {
      font-size: var(--font-size-xs);
      color: var(--color-error);
    }

    .prefix,
    .suffix {
      position: absolute;
      display: flex;
      align-items: center;
      color: var(--color-text-muted);
    }

    .prefix {
      left: var(--spacing-3);
    }

    .suffix {
      right: var(--spacing-3);
    }

    input.has-prefix {
      padding-left: calc(var(--spacing-3) + 24px);
    }

    input.has-suffix {
      padding-right: calc(var(--spacing-3) + 24px);
    }
  `;

  @property({ type: String }) label = '';
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = '';
  @property({ type: String }) type: 'text' | 'email' | 'password' | 'number' | 'url' = 'text';
  @property({ type: String }) helper = '';
  @property({ type: String }) error = '';
  @property({ type: Boolean }) required = false;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) multiline = false;
  @property({ type: Number }) rows = 3;

  @query('input, textarea') inputElement!: HTMLInputElement | HTMLTextAreaElement;

  render() {
    const hasPrefix = this.querySelector('[slot="prefix"]') !== null;
    const hasSuffix = this.querySelector('[slot="suffix"]') !== null;

    const inputClasses = {
      error: !!this.error,
      'has-prefix': hasPrefix,
      'has-suffix': hasSuffix,
    };

    return html`
      <div class="input-wrapper">
        ${this.label
          ? html`
              <label class=${classMap({ required: this.required })}> ${this.label} </label>
            `
          : ''}

        <div class="input-container">
          ${hasPrefix ? html`<span class="prefix"><slot name="prefix"></slot></span>` : ''}

          ${this.multiline
            ? html`
                <textarea
                  class=${classMap(inputClasses)}
                  .value=${this.value}
                  placeholder=${this.placeholder}
                  ?disabled=${this.disabled}
                  ?required=${this.required}
                  rows=${this.rows}
                  @input=${this.handleInput}
                  @change=${this.handleChange}
                ></textarea>
              `
            : html`
                <input
                  class=${classMap(inputClasses)}
                  type=${this.type}
                  .value=${this.value}
                  placeholder=${this.placeholder}
                  ?disabled=${this.disabled}
                  ?required=${this.required}
                  @input=${this.handleInput}
                  @change=${this.handleChange}
                />
              `}

          ${hasSuffix ? html`<span class="suffix"><slot name="suffix"></slot></span>` : ''}
        </div>

        ${this.error
          ? html`<span class="error-text">${this.error}</span>`
          : this.helper
            ? html`<span class="helper-text">${this.helper}</span>`
            : ''}
      </div>
    `;
  }

  private handleInput(e: Event): void {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    this.value = target.value;
    this.dispatchEvent(
      new CustomEvent('tc-input', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleChange(e: Event): void {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    this.value = target.value;
    this.dispatchEvent(
      new CustomEvent('tc-change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  focus(): void {
    this.inputElement?.focus();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-input': TcInput;
  }
}
