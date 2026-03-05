import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase.js';
import { authStore } from '../stores/auth-store.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-spinner.js';

interface WeeklyItem {
  weekly_id: number;
  name: string;
  imgurl: string;
}

interface ItemStatus {
  status: 'pending' | 'running' | 'success' | 'skipped' | 'error';
  replaced?: number;
  message?: string;
}

const WEEKLY_LIST: WeeklyItem[] = [
  { weekly_id: 75, name: '第75期', imgurl: 'https://drive.google.com/drive/folders/1h66WOAgMJvvtU7fzMZx7fMdnzYmTCl7j' },
  { weekly_id: 76, name: '第76期', imgurl: 'https://drive.google.com/drive/folders/1q49rB7qpTIzB4iPJEHX_mYLt9lDZeYKt' },
  { weekly_id: 77, name: '第77期', imgurl: 'https://drive.google.com/drive/folders/17Lseb9fNnt6hTfoF-mij6W8lFhAbALGi' },
  { weekly_id: 78, name: '第78期', imgurl: 'https://drive.google.com/drive/folders/1MTQKhVbmBPkjs2-z2FrnNuUoCQ_SU3mp' },
  { weekly_id: 79, name: '第79期', imgurl: 'https://drive.google.com/drive/folders/1W8eYKTrLmNXiWc3TlPjbFJciNazkWyyD' },
  { weekly_id: 80, name: '第80期', imgurl: 'https://drive.google.com/drive/folders/1FoZuxs4pIkXHrvywlcu41_lMAw1t04Jf' },
  { weekly_id: 81, name: '第81期', imgurl: 'https://drive.google.com/drive/folders/1AuDSgYPP3DJiqeipdzE7HDeBWIj9Z5O0' },
  { weekly_id: 82, name: '第82期', imgurl: 'https://drive.google.com/drive/folders/1TQGcUeDaq02mkuYGfReHaBeWULxAuuWs' },
  { weekly_id: 83, name: '第83期', imgurl: 'https://drive.google.com/drive/folders/10KRF-uhVi_IL90aVb1zDPNmo2URK77Ny' },
  { weekly_id: 84, name: '第84期', imgurl: 'https://drive.google.com/drive/folders/1tRBsQuaEHq6zfReCidHb-65fYL60-nQD' },
  { weekly_id: 85, name: '第85期', imgurl: 'https://drive.google.com/drive/folders/1914--Jl0KA8UTRy3GSHztmr7cwZLu251' },
  { weekly_id: 87, name: '第87期', imgurl: 'https://drive.google.com/drive/folders/15ICjytoxPcJnxmDOtRr_0LAqSdLpfaIt' },
  { weekly_id: 88, name: '第88期', imgurl: 'https://drive.google.com/drive/folders/1OLbOE_tkRj7WePxUPwyOpS-yfCwz1pps' },
  { weekly_id: 89, name: '第89期', imgurl: 'https://drive.google.com/drive/folders/1gav8LO4phj8iSdjeZSRgYO3pFN5B0Cp4' },
  { weekly_id: 90, name: '第90期', imgurl: 'https://drive.google.com/drive/folders/1FGdWE55az5YZu03nS0r47jFPDAJxmrvR' },
  { weekly_id: 91, name: '第91期', imgurl: '' },
  { weekly_id: 92, name: '第92期', imgurl: 'https://drive.google.com/drive/folders/1bgMiD_sc3phWE8Hn9kh9apC9bLUSLqAR' },
  { weekly_id: 93, name: '第93期', imgurl: 'https://drive.google.com/drive/folders/1ozhNt3ptr6B-JP2zPlFMBAfxYMiKHaeT' },
  { weekly_id: 94, name: '第94期', imgurl: 'https://drive.google.com/drive/folders/14-SMxcOrXcG-6wtM6YLUtFXazOjuy1hc' },
  { weekly_id: 95, name: '第95期', imgurl: 'https://drive.google.com/drive/folders/1lCkK9QIr99dj6pMH4xwA3Oo38nliYqSG' },
  { weekly_id: 96, name: '第96期', imgurl: 'https://drive.google.com/drive/folders/1rU2x29fpRG4LUW_HJBB10nUkTlE3ELKL' },
  { weekly_id: 97, name: '第97期', imgurl: 'https://drive.google.com/drive/folders/1dyLdxB8KB_44jCq_HdcRJr5xhLOPj5p9' },
  { weekly_id: 98, name: '第98期', imgurl: 'https://drive.google.com/drive/folders/1vleh54kT_tC4Y_i4rqhsn08BoVDSsl-Y' },
  { weekly_id: 99, name: '第99期', imgurl: 'https://drive.google.com/drive/folders/1uuPVZGr8PZOAPYnj2arwOp_Ha9tWU44b' },
  { weekly_id: 100, name: '第100期', imgurl: 'https://drive.google.com/drive/folders/1DExwG36W0Gu-y8N0U-dUKskQKZ-tGQ4F' },
  { weekly_id: 101, name: '第101期', imgurl: 'https://drive.google.com/drive/folders/1sf_ieivWNXUsZRtjRQwkYePRy3Jc6kab' },
  { weekly_id: 102, name: '第102期', imgurl: 'https://drive.google.com/drive/folders/1jvkXoq9T2FdY0f_pJ-aF0Ogb0OJEaBv9' },
  { weekly_id: 103, name: '第103期', imgurl: 'https://drive.google.com/drive/folders/10jOjdUg_ETqLdHgcN53aQv1XL7V1Ewnw' },
  { weekly_id: 104, name: '第104期', imgurl: 'https://drive.google.com/drive/folders/1JERLL38tzm2MjTC8BZMPJ47FECrIFr1p' },
  { weekly_id: 105, name: '第105期', imgurl: 'https://drive.google.com/drive/folders/1zPkH6SkVGBAvPz4nbDdYQPMGTczj6kZ9' },
  { weekly_id: 106, name: '第106期', imgurl: 'https://drive.google.com/drive/folders/1IoP1A-XxMZMcKoDGIAqPhDwNwjkRzjF2' },
  { weekly_id: 107, name: '第107期', imgurl: 'https://drive.google.com/drive/folders/1RHNMkWQR4HUE5FbozF3TyPRru12zQsFo' },
  { weekly_id: 108, name: '第108期', imgurl: 'https://drive.google.com/drive/folders/1yTE_GLVDPyzLs_iKO5aiJNLaCkkq9Fod' },
  { weekly_id: 109, name: '第109期', imgurl: 'https://drive.google.com/drive/folders/1_ENEn01aUIgeKk9wBB4z09LpjB61gZbt' },
  { weekly_id: 110, name: '第110期', imgurl: 'https://drive.google.com/drive/folders/1PtLnaG1t0npc-kP_Znq5ZRZ9B89y3_Vd' },
  { weekly_id: 111, name: '第111期', imgurl: 'https://drive.google.com/drive/folders/1Ir99L5wDEgumqFCm6tRlG_-gYi26uIAa' },
  { weekly_id: 112, name: '第112期', imgurl: 'https://drive.google.com/drive/folders/1LNW7WJQH8u2-mTJ3yZWmCHwx8yxJue0r' },
  { weekly_id: 113, name: '第113期', imgurl: 'https://drive.google.com/drive/folders/1NEyO7ilSiAnjAX9MrNe8EUt4jOO8iY_R' },
  { weekly_id: 114, name: '第114期', imgurl: 'https://drive.google.com/drive/folders/1ThD_2y3LvaSeSqzEdUK6GXPspzIy-Ppm' },
  { weekly_id: 115, name: '第115期', imgurl: 'https://drive.google.com/drive/folders/17r1LUDMV1fWVqWspSli52-uz7DTaofZh' },
  { weekly_id: 116, name: '第116期', imgurl: 'https://drive.google.com/drive/folders/1VEgFBn9CrObCcD9NyBoI4ee5hohJhC06' },
  { weekly_id: 117, name: '第117期', imgurl: 'https://drive.google.com/drive/folders/1zgbwmg6LMa86NVfUegN9eVy7Z6Mo4vAx' },
  { weekly_id: 118, name: '第118期', imgurl: 'https://drive.google.com/drive/folders/1pSvk0aDy6Cs5zO8ZsPmpXoIOvixix2s-' },
  { weekly_id: 119, name: '第119期', imgurl: 'https://drive.google.com/drive/folders/1k3LV5w5zHgnX5mVFDl4NvlU9JeWankRi' },
  { weekly_id: 120, name: '第120期', imgurl: 'https://drive.google.com/drive/folders/1sguZ7rSygC6aTyMdR_khqa7IgF7sCO_5' },
  { weekly_id: 121, name: '第121期', imgurl: 'https://drive.google.com/drive/folders/1P1gdd-MxIp4OQlkt0HZJEhXVovBkFX9C' },
  { weekly_id: 122, name: '第122期', imgurl: 'https://drive.google.com/drive/folders/1JpoOwoo6lDH2Xw_xJnuesviwD_x5j9qf' },
  { weekly_id: 123, name: '第123期', imgurl: 'https://drive.google.com/drive/folders/1dHMrjXLqA41WfjIGAol1KYq7yMTwwUjs' },
  { weekly_id: 124, name: '第124期', imgurl: 'https://drive.google.com/drive/folders/1B6gN6DF6oEksgAe511DPOhS2yyDXMnXW' },
  { weekly_id: 125, name: '第125期', imgurl: 'https://drive.google.com/drive/folders/18UjbAheu_POo3IhacmF4ezZgjUuA7Wfb' },
  { weekly_id: 126, name: '第126期', imgurl: 'https://drive.google.com/drive/folders/1ifw-9Cai2nz4Mndjd4WhzhUpf06LN0V4' },
];

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '/worker';

@customElement('page-batch-replace')
export class PageBatchReplace extends LitElement {
  static styles = css`
    :host { display: block; }

    .controls {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      padding: var(--spacing-4);
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border);
    }

    .controls .info {
      flex: 1;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .summary {
      display: flex;
      gap: var(--spacing-6);
      margin-bottom: var(--spacing-4);
      font-size: var(--font-size-sm);
    }

    .summary span { color: var(--color-text-secondary); }
    .summary .count { font-weight: 600; color: var(--color-text-primary); }

    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      background: var(--color-surface);
    }

    .item.running { background: #eff6ff; }
    .item.success { background: #f0fdf4; }
    .item.error { background: #fef2f2; }
    .item.skipped { background: var(--color-surface); opacity: 0.6; }

    .item-name { width: 80px; font-weight: 500; }
    .item-status { width: 24px; text-align: center; }
    .item-message {
      flex: 1;
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item.error .item-message { color: #dc2626; }
    .item.success .item-message { color: #16a34a; }
  `;

  @state() private statuses = new Map<number, ItemStatus>();
  @state() private running = false;
  @state() private processed = 0;
  @state() private total = 0;
  @state() private totalReplaced = 0;

  private channel: RealtimeChannel | null = null;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  private get successCount(): number {
    return [...this.statuses.values()].filter(s => s.status === 'success').length;
  }

  private get errorCount(): number {
    return [...this.statuses.values()].filter(s => s.status === 'error').length;
  }

  render() {
    const token = authStore.providerToken;

    return html`
      <tc-app-shell pageTitle="批次替換高解析度圖片">
        <div class="controls">
          <div class="info">
            ${!token
              ? html`<strong style="color: #dc2626">未偵測到 Google Token，請重新登入</strong>`
              : this.running
                ? html`處理中 ${this.processed}/${this.total}...`
                : html`共 ${WEEKLY_LIST.filter(i => i.imgurl).length} 期需要處理`}
          </div>
          ${this.running
            ? html`<tc-spinner size="sm"></tc-spinner>`
            : html`
                <tc-button variant="primary" ?disabled=${!token} @click=${this.handleStart}>
                  開始批次替換
                </tc-button>
              `}
        </div>

        <div class="summary">
          <span>進度: <span class="count">${this.processed}/${this.total || '-'}</span></span>
          <span>成功: <span class="count" style="color:#16a34a">${this.successCount}</span></span>
          <span>失敗: <span class="count" style="color:#dc2626">${this.errorCount}</span></span>
          <span>替換: <span class="count">${this.totalReplaced} 張</span></span>
        </div>

        <div class="list">
          ${WEEKLY_LIST.map((item) => {
            const s = this.statuses.get(item.weekly_id);
            const statusClass = s?.status || (item.imgurl ? 'pending' : 'skipped');
            const statusIcon = this.getStatusIcon(statusClass);
            const message = !item.imgurl
              ? '無圖片資料夾'
              : s?.message || '';

            return html`
              <div class="item ${statusClass}">
                <span class="item-status">${statusIcon}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-message">${message}</span>
              </div>
            `;
          })}
        </div>
      </tc-app-shell>
    `;
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'success': return '\u2714';
      case 'error': return '\u2718';
      case 'skipped': return '-';
      case 'running': return '...';
      default: return '\u00B7';
    }
  }

  private async handleStart(): Promise<void> {
    const token = authStore.providerToken;
    if (!token) {
      toastStore.error('請重新登入以取得 Google Token');
      return;
    }

    // 訂閱 Realtime channel
    this.channel = supabase
      .channel('batch-replace')
      .on('broadcast', { event: 'progress' }, (payload) => {
        this.handleProgress(payload.payload as Record<string, unknown>);
      })
      .subscribe();

    this.running = true;
    this.statuses = new Map();
    this.processed = 0;
    this.totalReplaced = 0;

    try {
      const resp = await fetch(`${WORKER_URL}/batch-replace-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_token: token,
          items: WEEKLY_LIST,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ message: 'Unknown error' }));
        toastStore.error(data.message || '啟動失敗');
        this.running = false;
        return;
      }

      const data = await resp.json();
      this.total = data.total;
    } catch (err) {
      toastStore.error('連接失敗: ' + (err instanceof Error ? err.message : String(err)));
      this.running = false;
    }
  }

  private handleProgress(data: Record<string, unknown>): void {
    const type = data.type as string;

    if (type === 'item') {
      const weeklyId = data.weekly_id as number;
      const status = data.status as ItemStatus['status'];
      const replaced = (data.replaced as number) || 0;
      const message = data.message as string;

      this.statuses = new Map(this.statuses).set(weeklyId, { status, replaced, message });
      this.processed = data.processed as number;

      if (status === 'success') {
        this.totalReplaced += replaced;
      }
    } else if (type === 'completed') {
      this.running = false;
      this.processed = data.processed as number;
      const successCount = data.successCount as number;
      const totalReplaced = data.totalReplaced as number;
      this.totalReplaced = totalReplaced;

      toastStore.success(`完成！${successCount} 期成功，共替換 ${totalReplaced} 張圖片`);

      // 清理 channel
      if (this.channel) {
        supabase.removeChannel(this.channel);
        this.channel = null;
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-batch-replace': PageBatchReplace;
  }
}
