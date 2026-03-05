import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { isValidDocUrl, startImport } from '../../services/worker.js';
import { getNextWeekNumber } from '../../services/weekly.js';
import { authStore } from '../../stores/auth-store.js';
import { toastStore } from '../../stores/toast-store.js';
import '../ui/tc-dialog.js';
import '../ui/tc-input.js';
import '../ui/tc-button.js';

@customElement('tc-import-dialog')
export class TcImportDialog extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .info {
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-info-bg);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      color: var(--color-info);
    }

    .footer-buttons {
      display: flex;
      gap: var(--spacing-3);
    }

    .footer-buttons tc-button {
      flex: 1;
    }
  `;

  @property({ type: Boolean }) open = false;

  @state()
  private docUrl = '';

  @state()
  private driveFolderUrl = '';

  @state()
  private weekNumber = 0;

  @state()
  private loading = false;

  @state()
  private urlError = '';

  @query('tc-dialog')
  private dialog!: HTMLElement & { close: () => void };

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadNextWeekNumber();
  }

  private async loadNextWeekNumber(): Promise<void> {
    try {
      this.weekNumber = await getNextWeekNumber();
    } catch (error) {
      console.error('Error loading next week number:', error);
      this.weekNumber = 1;
    }
  }

  render() {
    return html`
      <tc-dialog
        ?open=${this.open}
        dialogTitle="新增週報"
        @tc-close=${this.handleClose}
      >
        <div class="form">
          <tc-input
            label="Google Doc URL"
            placeholder="https://docs.google.com/document/d/..."
            .value=${this.docUrl}
            .error=${this.urlError}
            required
            @tc-input=${this.handleUrlInput}
          ></tc-input>

          <tc-input
            label="圖片資料夾 URL（選填）"
            placeholder="https://drive.google.com/drive/folders/..."
            .value=${this.driveFolderUrl}
            @tc-input=${this.handleFolderInput}
          ></tc-input>

          <tc-input
            label="期數"
            type="number"
            .value=${String(this.weekNumber)}
            required
            @tc-input=${this.handleWeekInput}
          ></tc-input>

          <div class="info">
            系統將自動下載文件、解析內容、並進行 AI 改寫。整個過程需要數分鐘。
          </div>
        </div>

        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${this.handleClose}>
            取消
          </tc-button>
          <tc-button
            variant="primary"
            ?loading=${this.loading}
            ?disabled=${!this.isValid}
            @click=${this.handleSubmit}
          >
            開始匯入
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private get isValid(): boolean {
    return isValidDocUrl(this.docUrl) && this.weekNumber > 0;
  }

  private handleUrlInput(e: CustomEvent): void {
    this.docUrl = e.detail.value;
    if (this.docUrl && !isValidDocUrl(this.docUrl)) {
      this.urlError = '請輸入有效的 Google Doc URL';
    } else {
      this.urlError = '';
    }
  }

  private handleFolderInput(e: CustomEvent): void {
    this.driveFolderUrl = e.detail.value;
  }

  private handleWeekInput(e: CustomEvent): void {
    this.weekNumber = parseInt(e.detail.value, 10) || 0;
  }

  private handleClose(): void {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('tc-dialog-close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private async handleSubmit(): Promise<void> {
    if (!this.isValid || this.loading) return;

    this.loading = true;

    try {
      await startImport({
        doc_url: this.docUrl,
        weekly_id: this.weekNumber,
        user_email: authStore.userEmail || 'unknown',
        drive_folder_url: this.driveFolderUrl || undefined,
        provider_token: this.driveFolderUrl ? (authStore.providerToken || undefined) : undefined,
      });

      toastStore.success('匯入已開始');
      this.handleClose();
      Router.go(`/weekly/${this.weekNumber}/import`);
    } catch (error) {
      console.error('Import error:', error);
      toastStore.error('匯入失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    } finally {
      this.loading = false;
    }
  }

  show(): void {
    this.open = true;
    this.docUrl = '';
    this.driveFolderUrl = '';
    this.urlError = '';
    this.loadNextWeekNumber();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-import-dialog': TcImportDialog;
  }
}
