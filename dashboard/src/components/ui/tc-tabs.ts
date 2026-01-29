import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

@customElement('tc-tabs')
export class TcTabs extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .tabs-list {
      display: flex;
      gap: var(--spacing-1);
      overflow-x: auto;
      scrollbar-width: none;
    }

    .tabs-list::-webkit-scrollbar {
      display: none;
    }

    .tab {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
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

    .tab:hover:not(.disabled) {
      color: var(--color-text-primary);
    }

    .tab.active {
      color: var(--color-text-primary);
      border-bottom-color: var(--color-accent);
    }

    .tab.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      font-size: 11px;
      font-weight: 500;
      background: var(--color-bg-hover);
      border-radius: var(--radius-full);
    }

    .tab.active .count {
      background: var(--color-accent);
      color: white;
    }

    .panels {
      margin-top: var(--spacing-4);
    }

    ::slotted([slot^='panel-']) {
      display: none;
    }

    ::slotted([slot^='panel-'].active) {
      display: block;
    }
  `;

  @property({ type: Array }) tabs: TabItem[] = [];
  @property({ type: String }) activeTab = '';

  @state()
  private _activeTab = '';

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('activeTab') && this.activeTab) {
      this._activeTab = this.activeTab;
    }
    if (changedProperties.has('tabs') && this.tabs.length && !this._activeTab) {
      this._activeTab = this.tabs[0].id;
    }
    this.updatePanelVisibility();
  }

  private updatePanelVisibility(): void {
    const slots = this.querySelectorAll('[slot^="panel-"]');
    slots.forEach((slot) => {
      const slotName = slot.getAttribute('slot');
      const panelId = slotName?.replace('panel-', '');
      if (panelId === this._activeTab) {
        slot.classList.add('active');
      } else {
        slot.classList.remove('active');
      }
    });
  }

  render() {
    return html`
      <div class="tabs-list" role="tablist">
        ${this.tabs.map((tab) => {
          const classes = {
            tab: true,
            active: tab.id === this._activeTab,
            disabled: !!tab.disabled,
          };
          return html`
            <button
              class=${classMap(classes)}
              role="tab"
              aria-selected=${tab.id === this._activeTab}
              ?disabled=${tab.disabled}
              @click=${() => this.selectTab(tab)}
            >
              ${tab.label}
              ${tab.count !== undefined ? html`<span class="count">${tab.count}</span>` : ''}
            </button>
          `;
        })}
      </div>
      <div class="panels">
        <slot></slot>
      </div>
    `;
  }

  private selectTab(tab: TabItem): void {
    if (tab.disabled) return;
    this._activeTab = tab.id;
    this.updatePanelVisibility();
    this.dispatchEvent(
      new CustomEvent('tc-tab-change', {
        detail: { tabId: tab.id },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-tabs': TcTabs;
  }
}
