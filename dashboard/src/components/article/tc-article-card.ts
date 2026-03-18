import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { Article, Category } from '../../types/index.js';
import { formatDate } from '../../utils/formatting.js';

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
  `;

  @property({ type: Object }) article!: ArticleWithCategory;
  @property({ type: Boolean }) showPush = false;
  @property({ type: Boolean }) showAudio = false;

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
