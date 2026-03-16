import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

const DROPDOWN_STYLES = `
  .tc-datepicker-dropdown {
    position: fixed;
    background: #1A1A1A;
    border: 1px solid #2A2A2A;
    border-radius: 12px;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.4);
    padding: 12px;
    min-width: 280px;
    z-index: 9999;
    font-family: 'Noto Sans TC', 'Inter', -apple-system, sans-serif;
  }
  .tc-datepicker-dropdown .dp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .tc-datepicker-dropdown .dp-month-label {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }
  .tc-datepicker-dropdown .dp-nav-buttons {
    display: flex;
    gap: 4px;
  }
  .tc-datepicker-dropdown .dp-nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid #2A2A2A;
    border-radius: 4px;
    color: #A0A0A0;
    cursor: pointer;
    transition: all 150ms ease;
    padding: 0;
  }
  .tc-datepicker-dropdown .dp-nav-btn:hover {
    background: #242424;
    color: #fff;
  }
  .tc-datepicker-dropdown .dp-nav-btn svg {
    width: 14px;
    height: 14px;
  }
  .tc-datepicker-dropdown .dp-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 4px;
  }
  .tc-datepicker-dropdown .dp-weekday {
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    color: #666;
    padding: 4px 0;
  }
  .tc-datepicker-dropdown .dp-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .tc-datepicker-dropdown .dp-day {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    font-size: 14px;
    font-family: inherit;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 150ms ease;
    background: transparent;
    color: #fff;
    padding: 0;
    margin: 0 auto;
  }
  .tc-datepicker-dropdown .dp-day:hover:not(.dp-selected) {
    background: #242424;
  }
  .tc-datepicker-dropdown .dp-day.dp-other-month {
    color: #666;
  }
  .tc-datepicker-dropdown .dp-day.dp-today:not(.dp-selected) {
    border: 1px solid #3B82F6;
    color: #3B82F6;
  }
  .tc-datepicker-dropdown .dp-day.dp-selected {
    background: #3B82F6;
    color: #fff;
    font-weight: 600;
  }
  .tc-datepicker-dropdown .dp-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #2A2A2A;
  }
  .tc-datepicker-dropdown .dp-today-btn {
    font-size: 12px;
    font-family: inherit;
    color: #3B82F6;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 150ms ease;
  }
  .tc-datepicker-dropdown .dp-today-btn:hover {
    background: rgba(59, 130, 246, 0.1);
  }
`;

@customElement('tc-datepicker')
export class TcDatepicker extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .label {
      display: block;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .trigger {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      cursor: pointer;
      transition: all var(--transition-fast);
      box-sizing: border-box;
    }

    .trigger:hover {
      border-color: var(--color-border-hover);
    }

    .trigger.open {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--color-accent-light);
    }

    .trigger svg {
      width: 16px;
      height: 16px;
      color: var(--color-text-muted);
      flex-shrink: 0;
    }

    .trigger-text {
      flex: 1;
      text-align: left;
    }
  `;

  @property({ type: String }) label = '';
  @property({ type: String }) value = '';

  @state() private open = false;
  private viewYear = 0;
  private viewMonth = 0;

  private dropdownEl: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private boundClose = this.handleOutsideClick.bind(this);

  @query('.trigger') private triggerEl!: HTMLButtonElement;

  connectedCallback(): void {
    super.connectedCallback();
    this.syncView();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeDropdown();
  }

  private syncView(): void {
    const d = this.value ? new Date(this.value + 'T00:00:00') : new Date();
    this.viewYear = d.getFullYear();
    this.viewMonth = d.getMonth();
  }

  private toggle(e: Event): void {
    e.stopPropagation();
    if (this.open) {
      this.removeDropdown();
    } else {
      this.syncView();
      this.showDropdown();
    }
  }

  private handleOutsideClick(e: Event): void {
    if (this.dropdownEl?.contains(e.target as Node)) return;
    if (e.composedPath().includes(this)) return;
    this.removeDropdown();
  }

  private showDropdown(): void {
    this.open = true;

    // Inject global styles once
    if (!document.getElementById('tc-datepicker-styles')) {
      this.styleEl = document.createElement('style');
      this.styleEl.id = 'tc-datepicker-styles';
      this.styleEl.textContent = DROPDOWN_STYLES;
      document.head.appendChild(this.styleEl);
    }

    this.dropdownEl = document.createElement('div');
    this.dropdownEl.className = 'tc-datepicker-dropdown';
    this.dropdownEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(this.dropdownEl);

    this.positionDropdown();
    this.renderDropdown();

    setTimeout(() => document.addEventListener('click', this.boundClose), 0);
  }

  private removeDropdown(): void {
    this.open = false;
    document.removeEventListener('click', this.boundClose);
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  private positionDropdown(): void {
    if (!this.dropdownEl || !this.triggerEl) return;
    const rect = this.triggerEl.getBoundingClientRect();
    this.dropdownEl.style.top = `${rect.bottom + 4}px`;
    this.dropdownEl.style.left = `${rect.left}px`;
  }

  private prevMonth(): void {
    if (this.viewMonth === 0) {
      this.viewMonth = 11;
      this.viewYear--;
    } else {
      this.viewMonth--;
    }
    this.renderDropdown();
  }

  private nextMonth(): void {
    if (this.viewMonth === 11) {
      this.viewMonth = 0;
      this.viewYear++;
    } else {
      this.viewMonth++;
    }
    this.renderDropdown();
  }

  private selectDate(year: number, month: number, day: number): void {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    this.value = `${year}-${m}-${d}`;
    this.removeDropdown();
    this.dispatchEvent(
      new CustomEvent('tc-change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private goToday(): void {
    const now = new Date();
    this.selectDate(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private formatDisplay(value: string): string {
    if (!value) return '選擇日期';
    const d = new Date(value + 'T00:00:00');
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  private getDays(): Array<{ day: number; month: number; year: number; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean }> {
    const year = this.viewYear;
    const month = this.viewMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const days: Array<{ day: number; month: number; year: number; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean }> = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, month: m, year: y, isCurrentMonth: false, isToday: dateStr === todayStr, isSelected: dateStr === this.value });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, month, year, isCurrentMonth: true, isToday: dateStr === todayStr, isSelected: dateStr === this.value });
    }

    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = month === 11 ? 0 : month + 1;
      const y = month === 11 ? year + 1 : year;
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, month: m, year: y, isCurrentMonth: false, isToday: dateStr === todayStr, isSelected: dateStr === this.value });
    }

    return days;
  }

  private monthNames = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
  private weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  private renderDropdown(): void {
    if (!this.dropdownEl) return;

    const days = this.getDays();

    this.dropdownEl.innerHTML = `
      <div class="dp-header">
        <span class="dp-month-label">${this.viewYear} 年 ${this.monthNames[this.viewMonth]}</span>
        <div class="dp-nav-buttons">
          <button class="dp-nav-btn" data-action="prev">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <button class="dp-nav-btn" data-action="next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
      <div class="dp-weekdays">
        ${this.weekdayNames.map(d => `<span class="dp-weekday">${d}</span>`).join('')}
      </div>
      <div class="dp-days">
        ${days.map(d => {
          const cls = ['dp-day'];
          if (!d.isCurrentMonth) cls.push('dp-other-month');
          if (d.isToday) cls.push('dp-today');
          if (d.isSelected) cls.push('dp-selected');
          return `<button class="${cls.join(' ')}" data-year="${d.year}" data-month="${d.month}" data-day="${d.day}">${d.day}</button>`;
        }).join('')}
      </div>
      <div class="dp-footer">
        <button class="dp-today-btn" data-action="today">今天</button>
      </div>
    `;

    // Event delegation
    this.dropdownEl.onclick = (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const btn = target.closest('button') as HTMLElement | null;
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'prev') { this.prevMonth(); return; }
      if (action === 'next') { this.nextMonth(); return; }
      if (action === 'today') { this.goToday(); return; }

      const { year, month, day } = btn.dataset;
      if (year && month && day) {
        this.selectDate(Number(year), Number(month), Number(day));
      }
    };
  }

  render() {
    return html`
      ${this.label ? html`<span class="label">${this.label}</span>` : ''}
      <button
        class="trigger ${this.open ? 'open' : ''}"
        @click=${this.toggle}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span class="trigger-text">${this.formatDisplay(this.value)}</span>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-datepicker': TcDatepicker;
  }
}
