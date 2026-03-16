import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

    .calendar {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--spacing-3);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-3);
    }

    .month-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .nav-buttons {
      display: flex;
      gap: var(--spacing-1);
    }

    .nav-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
      padding: 0;
    }

    .nav-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .nav-btn svg {
      width: 14px;
      height: 14px;
    }

    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: var(--spacing-1);
    }

    .weekday {
      text-align: center;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-muted);
      padding: var(--spacing-1) 0;
    }

    .days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }

    .day {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      font-size: var(--font-size-sm);
      font-family: inherit;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
      background: transparent;
      color: var(--color-text-primary);
      padding: 0;
      margin: 0 auto;
    }

    .day:hover:not(.selected) {
      background: var(--color-bg-hover);
    }

    .day.other-month {
      color: var(--color-text-muted);
    }

    .day.today:not(.selected) {
      border: 1px solid var(--color-accent);
      color: var(--color-accent);
    }

    .day.selected {
      background: var(--color-accent);
      color: #fff;
      font-weight: var(--font-weight-semibold);
    }

    .footer {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-2);
      padding-top: var(--spacing-2);
      border-top: 1px solid var(--color-border);
    }

    .today-btn {
      font-size: var(--font-size-xs);
      font-family: inherit;
      color: var(--color-accent);
      background: transparent;
      border: none;
      cursor: pointer;
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }

    .today-btn:hover {
      background: var(--color-accent-light);
    }
  `;

  @property({ type: String }) label = '';
  @property({ type: String }) value = '';

  @state() private viewYear = 0;
  @state() private viewMonth = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this.syncView();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('value') && this.value) {
      this.syncView();
    }
  }

  private syncView(): void {
    const d = this.value ? new Date(this.value + 'T00:00:00') : new Date();
    this.viewYear = d.getFullYear();
    this.viewMonth = d.getMonth();
  }

  private prevMonth(): void {
    if (this.viewMonth === 0) {
      this.viewMonth = 11;
      this.viewYear--;
    } else {
      this.viewMonth--;
    }
  }

  private nextMonth(): void {
    if (this.viewMonth === 11) {
      this.viewMonth = 0;
      this.viewYear++;
    } else {
      this.viewMonth++;
    }
  }

  private selectDate(year: number, month: number, day: number): void {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    this.value = `${year}-${m}-${d}`;
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

  render() {
    return html`
      ${this.label ? html`<span class="label">${this.label}</span>` : ''}
      <div class="calendar">
        <div class="header">
          <span class="month-label">${this.viewYear} 年 ${this.monthNames[this.viewMonth]}</span>
          <div class="nav-buttons">
            <button class="nav-btn" @click=${this.prevMonth}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button class="nav-btn" @click=${this.nextMonth}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <div class="weekdays">
          ${['日', '一', '二', '三', '四', '五', '六'].map(d => html`<span class="weekday">${d}</span>`)}
        </div>

        <div class="days">
          ${this.getDays().map(d => html`
            <button
              class="day ${d.isCurrentMonth ? '' : 'other-month'} ${d.isToday ? 'today' : ''} ${d.isSelected ? 'selected' : ''}"
              @click=${() => this.selectDate(d.year, d.month, d.day)}
            >${d.day}</button>
          `)}
        </div>

        <div class="footer">
          <button class="today-btn" @click=${this.goToday}>今天</button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-datepicker': TcDatepicker;
  }
}
