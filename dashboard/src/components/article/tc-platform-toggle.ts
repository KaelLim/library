import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import type { Platform } from '../../types/index.js';

@customElement('tc-platform-toggle')
export class TcPlatformToggle extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
    }

    .toggle {
      display: inline-flex;
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--spacing-1);
    }

    button {
      padding: var(--spacing-2) var(--spacing-4);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-muted);
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }

    button:hover:not(.active) {
      color: var(--color-text-secondary);
    }

    button.active {
      background: var(--color-accent);
      color: white;
    }
  `;

  @property({ type: String }) value: Platform = 'docs';

  render() {
    return html`
      <div class="toggle">
        <button
          class=${classMap({ active: this.value === 'docs' })}
          @click=${() => this.handleChange('docs')}
        >
          原稿
        </button>
        <button
          class=${classMap({ active: this.value === 'digital' })}
          @click=${() => this.handleChange('digital')}
        >
          數位版
        </button>
      </div>
    `;
  }

  private handleChange(platform: Platform): void {
    if (platform === this.value) return;
    this.value = platform;
    this.dispatchEvent(
      new CustomEvent('tc-platform-change', {
        detail: { platform },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-platform-toggle': TcPlatformToggle;
  }
}
