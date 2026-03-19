import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { audioStore, type AudioTask } from '../../stores/audio-store.js';

@customElement('tc-audio-banner')
export class TcAudioBanner extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 420px;
      width: calc(100vw - 32px);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.2s ease-out;
    }

    .banner.processing {
      background: var(--color-bg-info, #eff6ff);
      border: 1px solid var(--color-border-info, #bfdbfe);
      color: var(--color-text-info, #1e40af);
    }

    .banner.completed {
      background: var(--color-bg-success, #f0fdf4);
      border: 1px solid var(--color-border-success, #bbf7d0);
      color: var(--color-text-success, #166534);
    }

    .banner.failed {
      background: var(--color-bg-error, #fef2f2);
      border: 1px solid var(--color-border-error, #fecaca);
      color: var(--color-text-error, #991b1b);
    }

    .content {
      flex: 1;
      min-width: 0;
    }

    .title {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .message {
      opacity: 0.85;
      font-size: 13px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    .icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .close-btn {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 4px;
      opacity: 0.6;
      flex-shrink: 0;
    }

    .close-btn:hover {
      opacity: 1;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  @state()
  private tasks: AudioTask[] = [];

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.tasks = audioStore.tasks;
    this.unsubscribe = audioStore.subscribe((tasks) => {
      this.tasks = tasks;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  render() {
    if (this.tasks.length === 0) return nothing;

    return this.tasks.map(task => {
      const icon = task.status === 'processing'
        ? html`<div class="spinner"></div>`
        : task.status === 'completed'
          ? html`<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
          : html`<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;

      return html`
        <div class="banner ${task.status}">
          ${icon}
          <div class="content">
            <div class="title">${task.articleTitle}</div>
            <div class="message">${task.message}</div>
          </div>
          ${task.status !== 'processing'
            ? html`<button class="close-btn" @click=${() => audioStore.dismiss(task.articleId)}>✕</button>`
            : nothing}
        </div>
      `;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-audio-banner': TcAudioBanner;
  }
}
