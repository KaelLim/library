import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import type { WeeklyStatus } from '../types/index.js';
import type { WeeklyWithCount } from '../services/weekly.js';
import { getWeeklyList, updateWeeklyStatus, deleteWeekly } from '../services/weekly.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-tabs.js';
import '../components/ui/tc-spinner.js';
import '../components/ui/tc-dialog.js';
import '../components/weekly/tc-weekly-card.js';
import '../components/weekly/tc-import-dialog.js';

interface StatusTab {
  id: string;
  label: string;
  count?: number;
}

@customElement('page-weekly-list')
export class PageWeeklyList extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-6);
    }

    .tabs-container {
      flex: 1;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: var(--spacing-4);
    }

    .empty {
      text-align: center;
      padding: var(--spacing-12);
      color: var(--color-text-muted);
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto var(--spacing-4);
      color: var(--color-text-muted);
    }

    .empty h3 {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
    }

    .confirm-content {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: var(--line-height-relaxed);
    }

    .confirm-content strong {
      color: var(--color-text-primary);
    }

    .footer-buttons {
      display: flex;
      gap: var(--spacing-3);
    }

    .footer-buttons tc-button {
      flex: 1;
    }
  `;

  @state()
  private weeklyList: WeeklyWithCount[] = [];

  @state()
  private loading = true;

  @state()
  private activeStatus: WeeklyStatus | 'all' = 'all';

  @state()
  private showImportDialog = false;

  @state()
  private confirmAction: { type: 'delete' | 'publish' | 'unpublish' | 'archive' | 'restore'; weekNumber: number } | null = null;

  @query('tc-import-dialog')
  private importDialog!: HTMLElement & { show: () => void };

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadWeeklyList();
  }

  private async loadWeeklyList(): Promise<void> {
    this.loading = true;
    try {
      const status = this.activeStatus === 'all' ? undefined : this.activeStatus;
      this.weeklyList = await getWeeklyList(status);
    } catch (error) {
      console.error('Error loading weekly list:', error);
      toastStore.error('載入週報列表失敗');
    } finally {
      this.loading = false;
    }
  }

  private get statusTabs(): StatusTab[] {
    const counts = this.getStatusCounts();
    return [
      { id: 'all', label: '全部', count: counts.all },
      { id: 'draft', label: '草稿', count: counts.draft },
      { id: 'published', label: '已發布', count: counts.published },
      { id: 'archived', label: '已封存', count: counts.archived },
    ];
  }

  private getStatusCounts(): Record<string, number> {
    const counts = { all: 0, draft: 0, published: 0, archived: 0 };
    for (const weekly of this.weeklyList) {
      counts.all++;
      counts[weekly.status]++;
    }
    return counts;
  }

  render() {
    return html`
      <tc-app-shell pageTitle="週報列表">
        <tc-button
          slot="header-right"
          variant="primary"
          @click=${this.handleImport}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          新增週報
        </tc-button>

        <div class="toolbar">
          <div class="tabs-container">
            <tc-tabs
              .tabs=${this.statusTabs}
              activeTab=${this.activeStatus}
              @tc-tab-change=${this.handleTabChange}
            ></tc-tabs>
          </div>
        </div>

        ${this.loading
          ? html`
              <div class="loading">
                <tc-spinner size="lg"></tc-spinner>
              </div>
            `
          : this.weeklyList.length === 0
            ? this.renderEmpty()
            : this.renderGrid()}
      </tc-app-shell>

      <tc-import-dialog
        ?open=${this.showImportDialog}
        @tc-dialog-close=${this.handleImportClose}
      ></tc-import-dialog>

      ${this.renderConfirmDialog()}
    `;
  }

  private renderEmpty() {
    return html`
      <div class="empty">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path>
          <path d="M18 14h-8"></path>
          <path d="M15 18h-5"></path>
          <path d="M10 6h8v4h-8V6Z"></path>
        </svg>
        <h3>尚無週報</h3>
        <p>點擊「新增週報」開始匯入</p>
      </div>
    `;
  }

  private renderGrid() {
    return html`
      <div class="grid">
        ${this.weeklyList.map(
          (weekly) => html`
            <tc-weekly-card
              .weekly=${weekly}
              @tc-weekly-publish=${this.handlePublish}
              @tc-weekly-unpublish=${this.handleUnpublish}
              @tc-weekly-archive=${this.handleArchive}
              @tc-weekly-restore=${this.handleRestore}
              @tc-weekly-delete=${this.handleDelete}
            ></tc-weekly-card>
          `
        )}
      </div>
    `;
  }

  private renderConfirmDialog() {
    if (!this.confirmAction) return '';

    const config = {
      delete: {
        title: '確認刪除',
        message: `確定要刪除第 ${this.confirmAction.weekNumber} 期週報嗎？此操作無法復原，所有相關文稿也將被刪除。`,
        confirmLabel: '刪除',
        confirmVariant: 'danger' as const,
      },
      publish: {
        title: '確認發布',
        message: `確定要發布第 ${this.confirmAction.weekNumber} 期週報嗎？`,
        confirmLabel: '發布',
        confirmVariant: 'primary' as const,
      },
      unpublish: {
        title: '確認取消發布',
        message: `確定要取消發布第 ${this.confirmAction.weekNumber} 期週報嗎？將會回到草稿狀態。`,
        confirmLabel: '取消發布',
        confirmVariant: 'secondary' as const,
      },
      archive: {
        title: '確認封存',
        message: `確定要封存第 ${this.confirmAction.weekNumber} 期週報嗎？`,
        confirmLabel: '封存',
        confirmVariant: 'primary' as const,
      },
      restore: {
        title: '確認恢復',
        message: `確定要恢復第 ${this.confirmAction.weekNumber} 期週報嗎？將會回到草稿狀態。`,
        confirmLabel: '恢復',
        confirmVariant: 'primary' as const,
      },
    }[this.confirmAction.type];

    return html`
      <tc-dialog
        open
        dialogTitle=${config.title}
        size="sm"
        @tc-close=${this.handleConfirmClose}
      >
        <div class="confirm-content">
          <p>${config.message}</p>
        </div>
        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${this.handleConfirmClose}>
            取消
          </tc-button>
          <tc-button
            variant=${config.confirmVariant}
            @click=${this.handleConfirmAction}
          >
            ${config.confirmLabel}
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private handleTabChange(e: CustomEvent): void {
    this.activeStatus = e.detail.tabId as WeeklyStatus | 'all';
    this.loadWeeklyList();
  }

  private handleImport(): void {
    this.showImportDialog = true;
  }

  private handleImportClose(): void {
    this.showImportDialog = false;
  }

  private handlePublish(e: CustomEvent): void {
    this.confirmAction = { type: 'publish', weekNumber: e.detail.weekNumber };
  }

  private handleUnpublish(e: CustomEvent): void {
    this.confirmAction = { type: 'unpublish', weekNumber: e.detail.weekNumber };
  }

  private handleArchive(e: CustomEvent): void {
    this.confirmAction = { type: 'archive', weekNumber: e.detail.weekNumber };
  }

  private handleRestore(e: CustomEvent): void {
    this.confirmAction = { type: 'restore', weekNumber: e.detail.weekNumber };
  }

  private handleDelete(e: CustomEvent): void {
    this.confirmAction = { type: 'delete', weekNumber: e.detail.weekNumber };
  }

  private handleConfirmClose(): void {
    this.confirmAction = null;
  }

  private async handleConfirmAction(): Promise<void> {
    if (!this.confirmAction) return;

    const { type, weekNumber } = this.confirmAction;

    try {
      switch (type) {
        case 'publish':
          await updateWeeklyStatus(weekNumber, 'published', new Date().toISOString().split('T')[0]);
          toastStore.success('週報已發布');
          break;
        case 'unpublish':
          await updateWeeklyStatus(weekNumber, 'draft');
          toastStore.success('已取消發布');
          break;
        case 'archive':
          await updateWeeklyStatus(weekNumber, 'archived');
          toastStore.success('週報已封存');
          break;
        case 'restore':
          await updateWeeklyStatus(weekNumber, 'draft');
          toastStore.success('週報已恢復');
          break;
        case 'delete':
          await deleteWeekly(weekNumber);
          toastStore.success('週報已刪除');
          break;
      }

      this.confirmAction = null;
      await this.loadWeeklyList();
    } catch (error) {
      console.error('Action error:', error);
      toastStore.error('操作失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-weekly-list': PageWeeklyList;
  }
}
