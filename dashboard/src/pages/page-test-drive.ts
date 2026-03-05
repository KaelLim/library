import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { authStore } from '../stores/auth-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-input.js';

@customElement('page-test-drive')
export class PageTestDrive extends LitElement {
  static styles = css`
    .container {
      max-width: 640px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .result {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 16px;
      font-size: 13px;
      font-family: monospace;
      white-space: pre-wrap;
      max-height: 500px;
      overflow-y: auto;
    }

    .error {
      color: var(--color-danger);
    }

    .success {
      color: var(--color-success, #22c55e);
    }

    .file-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      background: var(--color-bg-card);
      border-radius: 6px;
      font-size: 13px;
    }

    .file-name {
      flex: 1;
      font-weight: 500;
    }

    .file-meta {
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .token-status {
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
    }

    .token-ok {
      background: #f0fdf4;
      color: #166534;
    }

    .token-missing {
      background: #fef2f2;
      color: #991b1b;
    }
  `;

  @state() private folderUrl = '';
  @state() private loading = false;
  @state() private result: any = null;
  @state() private error = '';

  render() {
    const hasToken = !!authStore.providerToken;

    return html`
      <tc-app-shell pageTitle="Drive API 測試">
        <div class="container">
          <div class="token-status ${hasToken ? 'token-ok' : 'token-missing'}">
            Provider Token: ${hasToken ? '✓ 已取得' : '✗ 未取得（請登出再重新登入）'}
          </div>

          <tc-input
            label="圖片資料夾 URL"
            placeholder="https://drive.google.com/drive/folders/..."
            .value=${this.folderUrl}
            @tc-input=${(e: CustomEvent) => { this.folderUrl = e.detail.value; }}
          ></tc-input>

          <tc-button
            variant="primary"
            ?loading=${this.loading}
            ?disabled=${!hasToken || !this.folderUrl}
            @click=${this.handleTest}
          >
            測試讀取
          </tc-button>

          ${this.error ? html`<div class="result error">${this.error}</div>` : ''}

          ${this.result ? html`
            <div class="result success">
              資料夾 ID: ${this.result.folder_id}
              找到 ${this.result.total} 張圖片
            </div>
            <div class="file-list">
              ${this.result.files.map((f: any) => html`
                <div class="file-item">
                  <span class="file-name">${f.name}</span>
                  <span class="file-meta">${f.mimeType}</span>
                  <span class="file-meta">${f.size ? `${Math.round(Number(f.size) / 1024)}KB` : ''}</span>
                </div>
              `)}
            </div>
          ` : ''}
        </div>
      </tc-app-shell>
    `;
  }

  private async handleTest() {
    this.loading = true;
    this.error = '';
    this.result = null;

    try {
      const resp = await fetch('/worker/test-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_url: this.folderUrl,
          provider_token: authStore.providerToken,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        this.error = `${data.error}: ${data.message}`;
      } else {
        this.result = data;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-test-drive': PageTestDrive;
  }
}
