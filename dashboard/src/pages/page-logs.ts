import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import type { AuditLog, AuditAction } from '../types/database.js';
import type { LogsStats } from '../services/logs.js';
import { getAuditLogs, getLogsStats, getActionCounts } from '../services/logs.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-tabs.js';
import '../components/ui/tc-badge.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-spinner.js';

type ActionFilter = AuditAction | 'all';

const ACTION_CONFIG: Record<string, { variant: string; label: string }> = {
  import: { variant: 'success', label: '匯入' },
  ai_transform: { variant: 'info', label: 'AI' },
  insert: { variant: 'info', label: '新增' },
  update: { variant: 'warning', label: '更新' },
  delete: { variant: 'error', label: '刪除' },
  create_book: { variant: 'success', label: '建書' },
  upload_pdf: { variant: 'info', label: 'PDF' },
  login: { variant: 'draft', label: '登入' },
  logout: { variant: 'draft', label: '登出' },
};

const TAB_ACTIONS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'import', label: '匯入' },
  { id: 'ai_transform', label: 'AI' },
  { id: 'insert', label: '新增' },
  { id: 'update', label: '更新' },
  { id: 'delete', label: '刪除' },
];

@customElement('page-logs')
export class PageLogs extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    /* Stats cards */
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
    }

    @media (max-width: 768px) {
      .stats {
        grid-template-columns: 1fr;
      }
    }

    .stat-card {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-5);
    }

    .stat-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
      margin-bottom: var(--spacing-2);
    }

    .stat-value {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
    }

    .stat-value.info { color: var(--color-info, #3B82F6); }
    .stat-value.success { color: var(--color-success, #22C55E); }
    .stat-value.error { color: var(--color-error, #EF4444); }

    .stat-sub {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--spacing-1);
    }

    /* Filters */
    .filters {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      flex-wrap: wrap;
    }

    .tabs-container {
      flex: 1;
      overflow-x: auto;
    }

    .days-group {
      display: flex;
      gap: var(--spacing-1);
      flex-shrink: 0;
    }

    /* Log table */
    .log-table {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .log-header {
      display: grid;
      grid-template-columns: 140px 100px 140px 1fr 2fr;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-bg-muted);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .log-row {
      display: grid;
      grid-template-columns: 140px 100px 140px 1fr 2fr;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-top: 1px solid var(--color-border);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: background var(--transition-fast);
      align-items: center;
    }

    .log-row:hover {
      background: var(--color-bg-hover);
    }

    .log-time {
      color: var(--color-text-muted);
      font-size: var(--font-size-xs);
      font-variant-numeric: tabular-nums;
    }

    .log-target {
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .log-user {
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .log-summary {
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Expanded detail */
    .log-detail {
      padding: var(--spacing-4);
      border-top: 1px solid var(--color-border);
      background: var(--color-bg-muted);
    }

    .detail-section {
      margin-bottom: var(--spacing-3);
    }

    .detail-section:last-child {
      margin-bottom: 0;
    }

    .detail-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: var(--spacing-1);
    }

    .detail-json {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      background: var(--color-bg-page);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--spacing-3);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
      overflow-y: auto;
    }

    /* Load more */
    .load-more {
      display: flex;
      justify-content: center;
      padding: var(--spacing-6);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
    }

    .empty {
      text-align: center;
      padding: var(--spacing-12);
      color: var(--color-text-muted);
    }

    .empty h3 {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    /* Responsive */
    @media (max-width: 900px) {
      .log-header, .log-row {
        grid-template-columns: 100px 80px 1fr;
      }
      .log-user, .log-summary {
        display: none;
      }
    }
  `;

  @state() private logs: AuditLog[] = [];
  @state() private loading = true;
  @state() private stats: LogsStats = { todayCount: 0, lastImport: null, lastError: null };
  @state() private activeAction: ActionFilter = 'all';
  @state() private activeDays = 7;
  @state() private actionCounts: Record<string, number> = {};
  @state() private hasMore = true;
  @state() private loadingMore = false;
  @state() private expandedId: number | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    this.loading = true;
    try {
      const [stats, counts, logs] = await Promise.all([
        getLogsStats(),
        getActionCounts(this.activeDays || undefined),
        getAuditLogs({
          action: this.activeAction === 'all' ? undefined : this.activeAction,
          days: this.activeDays || undefined,
          limit: 50,
          offset: 0,
        }),
      ]);
      this.stats = stats;
      this.actionCounts = counts;
      this.logs = logs;
      this.hasMore = logs.length === 50;
    } catch (error) {
      console.error('Error loading logs:', error);
      toastStore.error('載入日誌失敗');
    } finally {
      this.loading = false;
    }
  }

  private get actionTabs() {
    return TAB_ACTIONS.map((t) => ({
      id: t.id,
      label: t.label,
      count: this.actionCounts[t.id] ?? 0,
    }));
  }

  render() {
    return html`
      <tc-app-shell pageTitle="審計日誌">
        ${this.renderStats()}
        ${this.renderFilters()}
        ${this.loading
          ? html`<div class="loading"><tc-spinner size="lg"></tc-spinner></div>`
          : this.logs.length === 0
            ? this.renderEmpty()
            : this.renderLogList()}
      </tc-app-shell>
    `;
  }

  private renderStats() {
    return html`
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">今日操作</div>
          <div class="stat-value info">${this.stats.todayCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">最近匯入</div>
          ${this.stats.lastImport
            ? html`
                <div class="stat-value success">第 ${this.stats.lastImport.weeklyId} 期</div>
                <div class="stat-sub">${this.formatTime(this.stats.lastImport.time)}</div>
              `
            : html`<div class="stat-value" style="font-size:var(--font-size-base)">尚無匯入紀錄</div>`}
        </div>
        <div class="stat-card">
          <div class="stat-label">最近錯誤</div>
          ${this.stats.lastError
            ? html`
                <div class="stat-value error" style="font-size:var(--font-size-base)">${this.stats.lastError.message}</div>
                <div class="stat-sub">${this.formatTime(this.stats.lastError.time)}</div>
              `
            : html`
                <div class="stat-value success" style="font-size:var(--font-size-base)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  一切正常
                </div>
              `}
        </div>
      </div>
    `;
  }

  private renderFilters() {
    return html`
      <div class="filters">
        <div class="tabs-container">
          <tc-tabs
            .tabs=${this.actionTabs}
            activeTab=${this.activeAction}
            @tc-tab-change=${this.handleTabChange}
          ></tc-tabs>
        </div>
        <div class="days-group">
          ${this.renderDaysButton(7, '近 7 天')}
          ${this.renderDaysButton(30, '近 30 天')}
          ${this.renderDaysButton(0, '全部')}
        </div>
      </div>
    `;
  }

  private renderDaysButton(days: number, label: string) {
    return html`
      <tc-button
        variant=${this.activeDays === days ? 'secondary' : 'ghost'}
        size="sm"
        @click=${() => this.handleDaysChange(days)}
      >${label}</tc-button>
    `;
  }

  private renderEmpty() {
    return html`
      <div class="empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;color:var(--color-text-muted)">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <h3>暫無日誌</h3>
        <p>目前沒有符合條件的操作記錄</p>
      </div>
    `;
  }

  private renderLogList() {
    return html`
      <div class="log-table">
        <div class="log-header">
          <span>時間</span>
          <span>動作</span>
          <span>對象</span>
          <span>操作者</span>
          <span>摘要</span>
        </div>
        ${this.logs.map((log) => this.renderLogRow(log))}
      </div>
      ${this.hasMore
        ? html`
            <div class="load-more">
              <tc-button
                variant="secondary"
                ?loading=${this.loadingMore}
                @click=${this.handleLoadMore}
              >載入更多</tc-button>
            </div>
          `
        : nothing}
    `;
  }

  private renderLogRow(log: AuditLog) {
    const config = ACTION_CONFIG[log.action] || { variant: 'draft', label: log.action };
    const expanded = this.expandedId === log.id;
    return html`
      <div
        class="log-row"
        @click=${() => this.handleRowClick(log.id)}
      >
        <span class="log-time">${this.formatTime(log.created_at)}</span>
        <span>
          <tc-badge variant=${config.variant as any} show-dot>${config.label}</tc-badge>
        </span>
        <span class="log-target">${this.formatTarget(log)}</span>
        <span class="log-user">${log.user_email || 'system'}</span>
        <span class="log-summary">${this.formatSummary(log)}</span>
      </div>
      ${expanded ? this.renderDetail(log) : nothing}
    `;
  }

  private renderDetail(log: AuditLog) {
    return html`
      <div class="log-detail">
        ${log.metadata
          ? html`
              <div class="detail-section">
                <div class="detail-label">Metadata</div>
                <pre class="detail-json">${JSON.stringify(log.metadata, null, 2)}</pre>
              </div>
            `
          : nothing}
        ${log.old_data
          ? html`
              <div class="detail-section">
                <div class="detail-label">Old Data</div>
                <pre class="detail-json">${JSON.stringify(log.old_data, null, 2)}</pre>
              </div>
            `
          : nothing}
        ${log.new_data
          ? html`
              <div class="detail-section">
                <div class="detail-label">New Data</div>
                <pre class="detail-json">${JSON.stringify(log.new_data, null, 2)}</pre>
              </div>
            `
          : nothing}
        ${!log.metadata && !log.old_data && !log.new_data
          ? html`<div style="color:var(--color-text-muted);font-size:var(--font-size-sm)">無詳細資料</div>`
          : nothing}
      </div>
    `;
  }

  // --- Event handlers ---

  private handleTabChange(e: CustomEvent): void {
    this.activeAction = e.detail.tabId as ActionFilter;
    this.expandedId = null;
    this.loadData();
  }

  private handleDaysChange(days: number): void {
    this.activeDays = days;
    this.expandedId = null;
    this.loadData();
  }

  private handleRowClick(id: number): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  private async handleLoadMore(): Promise<void> {
    this.loadingMore = true;
    try {
      const more = await getAuditLogs({
        action: this.activeAction === 'all' ? undefined : this.activeAction,
        days: this.activeDays || undefined,
        limit: 50,
        offset: this.logs.length,
      });
      this.logs = [...this.logs, ...more];
      this.hasMore = more.length === 50;
    } catch (error) {
      console.error('Error loading more logs:', error);
      toastStore.error('載入更多日誌失敗');
    } finally {
      this.loadingMore = false;
    }
  }

  // --- Formatting helpers ---

  private formatTime(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return `${time} 今天`;
    if (isYesterday) return `${time} 昨天`;
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }

  private formatTarget(log: AuditLog): string {
    if (log.table_name && log.record_id) {
      return `${log.table_name} #${log.record_id}`;
    }
    if (log.table_name) {
      return log.table_name;
    }
    return '-';
  }

  private formatSummary(log: AuditLog): string {
    const meta = log.metadata as Record<string, unknown> | null;
    if (!meta) return '';

    if (log.action === 'import' && meta.step === 'completed') {
      const count = meta.article_count ?? meta.count;
      return count ? `完成！共匯入 ${count} 篇` : '匯入完成';
    }
    if (log.action === 'import' && meta.step === 'failed') {
      return (meta.error as string) || '匯入失敗';
    }
    if (log.action === 'import' && meta.step) {
      return String(meta.step);
    }
    if (log.action === 'ai_transform' && meta.model) {
      return String(meta.model);
    }
    if (log.action === 'update' && meta.fields) {
      return `${meta.fields} 已更新`;
    }
    if (meta.message) {
      return String(meta.message);
    }
    return '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-logs': PageLogs;
  }
}
