import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { Weekly, WeeklyStatus } from '../../types/index.js';
import { getStepInfo, type ImportStep } from '../../types/index.js';
import '../ui/tc-badge.js';

@customElement('tc-weekly-card')
export class TcWeeklyCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-5);
      transition: all var(--transition-fast);
    }

    .card:hover {
      border-color: var(--color-border-hover);
      box-shadow: var(--shadow-md);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-3);
    }

    .title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      cursor: pointer;
    }

    .title:hover {
      color: var(--color-accent);
    }

    .status-badge {
      cursor: pointer;
      transition: opacity var(--transition-fast);
    }

    .status-badge:hover {
      opacity: 0.8;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-4);
      margin-top: var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
    }

    .meta-item svg {
      width: 14px;
      height: 14px;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      margin-top: var(--spacing-4);
      padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-border);
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .action-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .action-btn.edit:hover {
      color: var(--color-accent);
    }

    .action-btn.publish:hover {
      color: var(--color-success);
    }

    .action-btn.unpublish:hover {
      color: var(--color-warning);
    }

    .action-btn.archive:hover {
      color: var(--color-text-muted);
    }

    .action-btn.restore:hover {
      color: var(--color-success);
    }

    .action-btn.delete:hover {
      color: var(--color-error);
    }

    .action-btn svg {
      width: 20px;
      height: 20px;
    }

    .spacer {
      flex: 1;
    }
  `;

  @property({ type: Object }) weekly!: Weekly & { article_count?: number };

  private getStatusLabel(status: WeeklyStatus): string {
    const labels: Record<WeeklyStatus, string> = {
      draft: '草稿',
      published: '已發布',
      archived: '已封存',
    };
    return labels[status];
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private get isImporting(): boolean {
    const step = this.weekly.import_step;
    return !!step && step !== 'completed' && step !== 'failed';
  }

  private get badgeInfo(): { variant: string; label: string } {
    const { status, import_step } = this.weekly;

    if (this.isImporting && import_step) {
      const stepInfo = getStepInfo(import_step as ImportStep);
      return {
        variant: 'info',
        label: stepInfo?.label || import_step,
      };
    }

    if (import_step === 'failed') {
      return { variant: 'error', label: '匯入失敗' };
    }

    return {
      variant: status,
      label: this.getStatusLabel(status),
    };
  }

  render() {
    const { week_number, status, created_at, publish_date, article_count } = this.weekly;
    const { variant, label } = this.badgeInfo;

    return html`
      <div class="card">
        <div class="header">
          <span class="title" @click=${this.handleTitleClick}>
            第 ${week_number} 期
          </span>
          <tc-badge
            class="status-badge"
            variant=${variant}
            ?show-dot=${this.isImporting}
            ?pulse=${this.isImporting}
            @click=${this.handleBadgeClick}
          >
            ${label}
          </tc-badge>
        </div>

        <div class="meta">
          <span class="meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            ${this.formatDate(created_at)}
          </span>

          ${publish_date
            ? html`
                <span class="meta-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  發布於 ${this.formatDate(publish_date)}
                </span>
              `
            : ''}

          <span class="meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            ${article_count ?? 0} 篇文稿
          </span>
        </div>

        <div class="actions">
          <!-- Edit -->
          <button class="action-btn edit" @click=${this.handleEdit} title="編輯">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>

          <!-- Publish / Unpublish / Archive -->
          ${status === 'draft'
            ? html`
                <button class="action-btn publish" @click=${this.handlePublish} title="發布">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                  </svg>
                </button>
              `
            : status === 'published'
              ? html`
                  <button class="action-btn unpublish" @click=${this.handleUnpublish} title="取消發布">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                    </svg>
                  </button>
                  <button class="action-btn archive" @click=${this.handleArchive} title="封存">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/>
                    </svg>
                  </button>
                `
              : status === 'archived'
                ? html`
                    <button class="action-btn restore" @click=${this.handleRestore} title="恢復">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z"/>
                      </svg>
                    </button>
                  `
                : ''}

          <span class="spacer"></span>

          <!-- Delete -->
          <button class="action-btn delete" @click=${this.handleDelete} title="刪除">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  private handleTitleClick(): void {
    Router.go(`/weekly/${this.weekly.week_number}`);
  }

  private handleBadgeClick(): void {
    // 點擊 badge 跳轉到 import 進度頁
    if (this.isImporting || this.weekly.import_step === 'failed') {
      Router.go(`/weekly/${this.weekly.week_number}/import`);
    }
  }

  private handleEdit(): void {
    Router.go(`/weekly/${this.weekly.week_number}`);
  }

  private handlePublish(): void {
    this.dispatchEvent(
      new CustomEvent('tc-weekly-publish', {
        detail: { weekNumber: this.weekly.week_number },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleUnpublish(): void {
    this.dispatchEvent(
      new CustomEvent('tc-weekly-unpublish', {
        detail: { weekNumber: this.weekly.week_number },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleArchive(): void {
    this.dispatchEvent(
      new CustomEvent('tc-weekly-archive', {
        detail: { weekNumber: this.weekly.week_number },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleRestore(): void {
    this.dispatchEvent(
      new CustomEvent('tc-weekly-restore', {
        detail: { weekNumber: this.weekly.week_number },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleDelete(): void {
    this.dispatchEvent(
      new CustomEvent('tc-weekly-delete', {
        detail: { weekNumber: this.weekly.week_number },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-weekly-card': TcWeeklyCard;
  }
}
