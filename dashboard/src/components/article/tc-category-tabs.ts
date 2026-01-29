import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import type { Category } from '../../types/index.js';

@customElement('tc-category-tabs')
export class TcCategoryTabs extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .tabs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
      display: none;
    }

    .tab {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }

    .tab:hover:not(.active) {
      color: var(--color-text-primary);
    }

    .tab.active {
      color: var(--color-text-primary);
      border-bottom-color: var(--color-accent);
    }
  `;

  @property({ type: Array }) categories: Category[] = [];
  @property({ type: Object }) counts: Map<number, number> = new Map();
  @property({ type: Number }) activeCategory = 0;

  @state()
  private _activeCategory = 0;

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('activeCategory')) {
      this._activeCategory = this.activeCategory;
    }
    if (changedProperties.has('categories') && this.categories.length && !this._activeCategory) {
      this._activeCategory = this.categories[0]?.id || 0;
    }
  }

  render() {
    return html`
      <div class="tabs">
        ${this.categories.map((category) => {
          const count = this.counts.get(category.id) || 0;
          const isActive = category.id === this._activeCategory;
          const label = count > 0 ? `${category.name} (${count})` : category.name;

          return html`
            <button
              class=${classMap({ tab: true, active: isActive })}
              @click=${() => this.handleSelect(category)}
            >
              ${label}
            </button>
          `;
        })}
      </div>
    `;
  }

  private handleSelect(category: Category): void {
    this._activeCategory = category.id;
    this.dispatchEvent(
      new CustomEvent('tc-category-change', {
        detail: { categoryId: category.id, category },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-category-tabs': TcCategoryTabs;
  }
}
