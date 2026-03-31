import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { Article, Category } from '../../types/index.js';
import { formatDate } from '../../utils/formatting.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:8000';

interface ArticleWithCategory extends Article {
  category?: Category;
}

@customElement('tc-article-card')
export class TcArticleCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 20px;
      transition: border-color var(--transition-fast);
    }

    .card:hover {
      border-color: var(--color-border-hover);
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }

    .title-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0;
    }

    .meta {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .action-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .action-btn svg {
      width: 14px;
      height: 14px;
    }

    .content {
      margin-top: 16px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--color-text-secondary);
    }

    .audio-row {
      margin-top: var(--spacing-3);
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .audio-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      padding: var(--spacing-1) var(--spacing-3);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-accent);
      background: var(--color-accent-light);
      border: none;
      border-radius: var(--radius-full);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .audio-chip:hover {
      background: var(--color-accent);
      color: #fff;
    }

    .audio-chip svg {
      width: 14px;
      height: 14px;
    }

    .player {
      margin-top: var(--spacing-3);
      padding: var(--spacing-3);
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .player-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-accent);
      border: none;
      border-radius: var(--radius-full);
      color: #fff;
      cursor: pointer;
      flex-shrink: 0;
      transition: background var(--transition-fast);
    }

    .player-btn:hover {
      background: var(--color-accent-hover);
    }

    .player-btn svg {
      width: 16px;
      height: 16px;
    }

    .player-track {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .player-bar {
      width: 100%;
      height: 4px;
      background: var(--color-bg-active);
      border-radius: 2px;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .player-bar:hover {
      height: 6px;
    }

    .player-progress {
      height: 100%;
      background: var(--color-accent);
      border-radius: 2px;
      transition: width 0.1s linear;
    }

    .player-time {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .player-close {
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      padding: var(--spacing-1);
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      transition: color var(--transition-fast);
    }

    .player-close:hover {
      color: var(--color-text-primary);
    }

  `;

  @property({ type: Object }) article!: ArticleWithCategory;
  @property({ type: Boolean }) showPush = false;
  @property({ type: Boolean }) showAudio = false;

  @state() private showPlayer = false;
  @state() private hasAudio = false;
  @state() private isPlaying = false;
  @state() private currentTime = 0;
  @state() private duration = 0;
  private _checkedAudioFor = 0;
  private _audio: HTMLAudioElement | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.checkAudio();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('article') && this.article?.id !== this._checkedAudioFor) {
      this.hasAudio = false;
      this.showPlayer = false;
      this.checkAudio();
    }
  }

  private async checkAudio(): Promise<void> {
    if (!this.showAudio || !this.article) return;
    const id = this.article.id;
    this._checkedAudioFor = id;
    try {
      const res = await fetch(this.getMp3Url(), { method: 'HEAD' });
      if (this.article.id === id) {
        this.hasAudio = res.ok;
      }
    } catch {
      // 網路錯誤，不顯示
    }
  }

  private stripMarkdown(content: string): string {
    return content
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // Images → (圖片) alt text（必須在 links 之前處理）
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt) => alt ? `(圖片) ${alt}` : '(圖片)')
      // Remove links, keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      // Remove blockquotes
      .replace(/^>\s+/gm, '')
      // Remove list markers
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Collapse multiple newlines
      .replace(/\n{2,}/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getPreview(content: string, maxLength = 200): string {
    const plainText = this.stripMarkdown(content);
    if (plainText.length <= maxLength) return plainText;
    return plainText.slice(0, maxLength) + '...';
  }

  render() {
    const { title, content, category, created_at } = this.article;
    const categoryName = category?.name || '';
    const date = formatDate(created_at);

    return html`
      <div class="card">
        <div class="header">
          <div class="title-group">
            <h3 class="title">${title}</h3>
            <span class="meta">${categoryName} · ${date}</span>
          </div>
          <div class="actions">
            <button class="action-btn" @click=${this.handleEdit}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              編輯
            </button>
            ${this.showAudio
              ? html`
                  <button class="action-btn" @click=${this.handleAudio}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                    語音
                  </button>
                `
              : ''}
            ${this.showPush
              ? html`
                  <button class="action-btn" @click=${this.handlePush}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                    </svg>
                    推播
                  </button>
                `
              : ''}
          </div>
        </div>
        <p class="content">${this.getPreview(content)}</p>
        ${this.hasAudio ? this.renderPlayer() : nothing}
      </div>
    `;
  }

  private handleEdit(e: Event): void {
    e.stopPropagation();
    const { weekly_id, id } = this.article;
    const query = window.location.search;
    Router.go(`/weekly/${weekly_id}/article/${id}${query}`);
  }

  private handleAudio(e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('tc-article-audio', {
        detail: { article: this.article },
        bubbles: true,
        composed: true,
      })
    );
  }

  private getMp3Url(): string {
    const { weekly_id, id } = this.article;
    return `${SUPABASE_URL}/storage/v1/object/public/weekly/articles/${weekly_id}/mp3/${id}.mp3`;
  }

  private renderPlayer() {
    if (!this.showPlayer) {
      return html`
        <div class="audio-row">
          <button class="audio-chip" @click=${this.handlePlay}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            試聽語音
          </button>
        </div>
      `;
    }

    const pct = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;

    return html`
      <div class="player">
        <button class="player-btn" @click=${this.togglePlay}>
          ${this.isPlaying
            ? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
            : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}
        </button>
        <div class="player-track">
          <div class="player-bar" @click=${this.handleSeek}>
            <div class="player-progress" style="width:${pct}%"></div>
          </div>
          <div class="player-time">
            <span>${this.formatTime(this.currentTime)}</span>
            <span>${this.formatTime(this.duration)}</span>
          </div>
        </div>
        <button class="player-close" @click=${this.handleClosePlayer} title="關閉">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    `;
  }

  private formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private handlePlay(e: Event): void {
    e.stopPropagation();
    this.showPlayer = true;
    this.initAudio();
  }

  private togglePlay(e: Event): void {
    e.stopPropagation();
    if (!this._audio) return;
    if (this.isPlaying) {
      this._audio.pause();
    } else {
      this._audio.play();
    }
  }

  private handleSeek(e: MouseEvent): void {
    e.stopPropagation();
    if (!this._audio || !this.duration) return;
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    this._audio.currentTime = pct * this.duration;
  }

  private initAudio(): void {
    this.destroyAudio();
    const audio = new Audio(this.getMp3Url());
    this._audio = audio;

    audio.addEventListener('loadedmetadata', () => {
      this.duration = audio.duration;
    });
    audio.addEventListener('timeupdate', () => {
      this.currentTime = audio.currentTime;
    });
    audio.addEventListener('play', () => { this.isPlaying = true; });
    audio.addEventListener('pause', () => { this.isPlaying = false; });
    audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.currentTime = 0;
    });
    audio.play().catch(() => {});
  }

  private destroyAudio(): void {
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
  }

  private handleClosePlayer(e: Event): void {
    e.stopPropagation();
    this.destroyAudio();
    this.showPlayer = false;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.destroyAudio();
  }

  private handlePush(e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('tc-article-push', {
        detail: { article: this.article },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-article-card': TcArticleCard;
  }
}
