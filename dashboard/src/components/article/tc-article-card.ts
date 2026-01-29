import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { Article, Category } from '../../types/index.js';

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
  @property({ type: Boolean }) showRewrite = false;

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
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
      // Remove links, keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
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
    const date = this.formatDate(created_at);

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
            ${this.showRewrite
              ? html`
                  <button class="action-btn" @click=${this.handleRewrite}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41l-2.33-2.35zm-1.03 5.49l-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z"/>
                    </svg>
                    重新改寫
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
    Router.go(`/weekly/${weekly_id}/article/${id}`);
  }

  private handleRewrite(e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('tc-article-rewrite', {
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
