import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { toastStore } from '../stores/toast-store.js';
import {
  sendPushNotification,
  fetchPushLogs,
  type PushLogEntry,
} from '../services/worker.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/index.js';

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  custom: { label: '自訂', color: 'var(--color-info)' },
  weekly_publish: { label: '週報', color: 'var(--color-success)' },
  article: { label: '文稿', color: '#9333ea' },
};

const PAGE_SIZE = 20;

@customElement('page-push')
export class PagePush extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    /* Send Form */
    .send-section {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-5);
      margin-bottom: var(--spacing-6);
    }

    .send-section h2 {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-4) 0;
    }

    .form-group {
      margin-bottom: var(--spacing-3);
    }

    .form-group label {
      display: block;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-1);
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      font-family: inherit;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-group .hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--spacing-1);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-4);
    }

    /* History Section - matches page-logs pattern */
    .filters {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-4);
    }

    .section-label {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .filter-select {
      padding: var(--spacing-1) var(--spacing-3);
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    /* Log table - grid rows like page-logs */
    .log-table {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .log-header {
      display: grid;
      grid-template-columns: 100px 64px 1fr 1.5fr 56px 48px 48px 80px;
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
      grid-template-columns: 100px 64px 1fr 1.5fr 56px 48px 48px 80px;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-top: 1px solid var(--color-border);
      font-size: var(--font-size-sm);
      align-items: center;
      transition: background var(--transition-fast);
    }

    .log-row:hover {
      background: var(--color-bg-hover);
    }

    .log-time {
      color: var(--color-text-muted);
      font-size: var(--font-size-xs);
      font-variant-numeric: tabular-nums;
    }

    .source-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: #fff;
      white-space: nowrap;
    }

    .log-title,
    .log-body {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--color-text-primary);
    }

    .log-body {
      color: var(--color-text-secondary);
    }

    .log-url a {
      color: var(--color-primary);
      text-decoration: none;
      font-size: var(--font-size-xs);
    }

    .log-url a:hover {
      text-decoration: underline;
    }

    .log-number {
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .log-number.success {
      color: var(--color-success);
    }

    .log-number.error {
      color: var(--color-error);
    }

    .log-user {
      color: var(--color-text-muted);
      font-size: var(--font-size-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Pagination */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-4);
    }

    .pagination button {
      padding: var(--spacing-1) var(--spacing-3);
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .pagination button:hover:not(:disabled) {
      background: var(--color-bg-hover);
    }

    .pagination button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .pagination .page-info {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }

    .empty-state {
      text-align: center;
      padding: var(--spacing-8);
      color: var(--color-text-muted);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
    }

    @media (max-width: 768px) {
      .log-header,
      .log-row {
        grid-template-columns: 80px 56px 1fr 48px 48px;
      }

      .log-header > :nth-child(4),
      .log-row > :nth-child(4),
      .log-header > :nth-child(5),
      .log-row > :nth-child(5),
      .log-header > :nth-child(8),
      .log-row > :nth-child(8) {
        display: none;
      }
    }
  `;

  // Form state
  @state() private pushTitle = '';
  @state() private pushBody = '';
  @state() private pushUrl = '';
  @state() private sending = false;
  @state() private showConfirmDialog = false;

  // History state
  @state() private logs: PushLogEntry[] = [];
  @state() private totalLogs = 0;
  @state() private currentPage = 1;
  @state() private pageCount = 1;
  @state() private sourceFilter = '';
  @state() private loadingLogs = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.loadLogs();
  }

  private async loadLogs(): Promise<void> {
    this.loadingLogs = true;
    try {
      const offset = (this.currentPage - 1) * PAGE_SIZE;
      const result = await fetchPushLogs(
        PAGE_SIZE,
        offset,
        this.sourceFilter || undefined
      );
      this.logs = result.data;
      this.totalLogs = result.total;
      this.pageCount = result.page_count;
    } catch (error) {
      console.error('Failed to load push logs:', error);
      toastStore.error('載入推播歷史失敗');
    } finally {
      this.loadingLogs = false;
    }
  }

  private get isFormValid(): boolean {
    if (!this.pushTitle.trim() || !this.pushBody.trim()) return false;
    if (this.pushUrl.trim() && !this.pushUrl.match(/^(https:\/\/|\/)/)) return false;
    return true;
  }

  private handleSendClick(): void {
    if (!this.isFormValid) return;
    this.showConfirmDialog = true;
  }

  private async handleConfirmSend(): Promise<void> {
    this.showConfirmDialog = false;
    this.sending = true;
    try {
      const result = await sendPushNotification({
        title: this.pushTitle.trim(),
        body: this.pushBody.trim(),
        url: this.pushUrl.trim() || undefined,
        source: 'custom',
      });
      toastStore.success(`推播已發送：成功 ${result.sent} 筆、失敗 ${result.failed} 筆`);
      // Reset form
      this.pushTitle = '';
      this.pushBody = '';
      this.pushUrl = '';
      // Refresh history
      this.currentPage = 1;
      await this.loadLogs();
    } catch (error) {
      console.error('Push send error:', error);
      toastStore.error(error instanceof Error ? error.message : '推播發送失敗');
    } finally {
      this.sending = false;
    }
  }

  private handleFilterChange(e: Event): void {
    this.sourceFilter = (e.target as HTMLSelectElement).value;
    this.currentPage = 1;
    this.loadLogs();
  }

  private handlePageChange(page: number): void {
    this.currentPage = page;
    this.loadLogs();
  }

  private formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  render() {
    return html`
      <tc-app-shell pageTitle="推播管理">
        ${this.renderSendForm()}
        ${this.renderHistory()}
      </tc-app-shell>

      <tc-dialog
        ?open=${this.showConfirmDialog}
        dialogTitle="確認發送"
        @tc-close=${() => (this.showConfirmDialog = false)}
      >
        <p>確定要發送推播嗎？</p>
        <p><strong>${this.pushTitle}</strong></p>
        <p>${this.pushBody}</p>
        ${this.pushUrl ? html`<p>連結：${this.pushUrl}</p>` : nothing}
        <div slot="footer">
          <tc-button variant="secondary" @click=${() => (this.showConfirmDialog = false)}>取消</tc-button>
          <tc-button variant="primary" @click=${this.handleConfirmSend}>發送</tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private renderSendForm() {
    return html`
      <div class="send-section">
        <h2>發送推播</h2>
        <div class="form-group">
          <label>標題</label>
          <input
            type="text"
            maxlength="100"
            placeholder="推播標題"
            .value=${this.pushTitle}
            @input=${(e: Event) => (this.pushTitle = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-group">
          <label>內文</label>
          <textarea
            maxlength="500"
            rows="3"
            placeholder="推播內文"
            .value=${this.pushBody}
            @input=${(e: Event) => (this.pushBody = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
        <div class="form-group">
          <label>連結（選填）</label>
          <input
            type="text"
            maxlength="500"
            placeholder="https:// 或 / 開頭"
            .value=${this.pushUrl}
            @input=${(e: Event) => (this.pushUrl = (e.target as HTMLInputElement).value)}
          />
          <div class="hint">支援外部連結（https://）或內部路徑（/weekly/123）</div>
        </div>
        <div class="form-actions">
          <tc-button
            variant="primary"
            ?disabled=${!this.isFormValid || this.sending}
            ?loading=${this.sending}
            @click=${this.handleSendClick}
          >發送推播</tc-button>
        </div>
      </div>
    `;
  }

  private renderHistory() {
    return html`
      <div class="filters">
        <span class="section-label">推播歷史</span>
        <select class="filter-select" @change=${this.handleFilterChange}>
          <option value="">全部來源</option>
          <option value="custom">自訂</option>
          <option value="weekly_publish">週報發佈</option>
          <option value="article">文稿推播</option>
        </select>
      </div>

      ${this.loadingLogs
        ? html`<div class="loading"><tc-spinner></tc-spinner></div>`
        : this.logs.length === 0
          ? html`<div class="empty-state">尚無推播紀錄</div>`
          : html`
              <div class="log-table">
                <div class="log-header">
                  <span>時間</span>
                  <span>來源</span>
                  <span>標題</span>
                  <span>內文</span>
                  <span>連結</span>
                  <span>成功</span>
                  <span>失敗</span>
                  <span>操作者</span>
                </div>
                ${this.logs.map(
                  (log) => html`
                    <div class="log-row">
                      <span class="log-time">${this.formatDate(log.created_at)}</span>
                      <span>${this.renderSourceBadge(log.metadata?.source)}</span>
                      <span class="log-title">${log.metadata?.title || '-'}</span>
                      <span class="log-body">${this.truncate(log.metadata?.body || '-', 50)}</span>
                      <span class="log-url">
                        ${log.metadata?.url
                          ? html`<a href="${log.metadata.url}" target="_blank" rel="noopener">連結</a>`
                          : '-'}
                      </span>
                      <span class="log-number success">${log.metadata?.sent ?? '-'}</span>
                      <span class="log-number error">${log.metadata?.failed ?? '-'}</span>
                      <span class="log-user">${log.user_email?.split('@')[0] || '-'}</span>
                    </div>
                  `
                )}
              </div>

              ${this.pageCount > 1 ? this.renderPagination() : nothing}
            `}
    `;
  }

  private renderSourceBadge(source?: string) {
    const config = SOURCE_CONFIG[source || ''] || { label: source || '未知', color: 'var(--color-text-muted)' };
    return html`
      <span class="source-badge" style="background:${config.color}">${config.label}</span>
    `;
  }

  private renderPagination() {
    return html`
      <div class="pagination">
        <button
          ?disabled=${this.currentPage <= 1}
          @click=${() => this.handlePageChange(this.currentPage - 1)}
        >&lt;</button>
        <span class="page-info">${this.currentPage} / ${this.pageCount}</span>
        <button
          ?disabled=${this.currentPage >= this.pageCount}
          @click=${() => this.handlePageChange(this.currentPage + 1)}
        >&gt;</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-push': PagePush;
  }
}
