import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Article } from '../../types/index.js';
import { updateArticle } from '../../services/articles.js';
import { toastStore } from '../../stores/toast-store.js';
import '../ui/tc-dialog.js';
import '../ui/tc-input.js';
import '../ui/tc-button.js';

@customElement('tc-article-editor')
export class TcArticleEditor extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .content-editor {
      min-height: 300px;
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
  @property({ type: Object }) article?: Article;

  @state()
  private articleTitle = '';

  @state()
  private articleContent = '';

  @state()
  private loading = false;

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('article') && this.article) {
      this.articleTitle = this.article.title;
      this.articleContent = this.article.content;
    }
  }

  render() {
    return html`
      <tc-dialog
        ?open=${this.open}
        dialogTitle="編輯文稿"
        size="lg"
        @tc-close=${this.handleClose}
      >
        <div class="form">
          <tc-input
            label="標題"
            .value=${this.articleTitle}
            @tc-input=${this.handleTitleInput}
          ></tc-input>

          <tc-input
            label="內容"
            multiline
            rows="12"
            .value=${this.articleContent}
            @tc-input=${this.handleContentInput}
          ></tc-input>
        </div>

        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${this.handleClose}>
            取消
          </tc-button>
          <tc-button
            variant="primary"
            ?loading=${this.loading}
            @click=${this.handleSave}
          >
            儲存
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private handleTitleInput(e: CustomEvent): void {
    this.articleTitle = e.detail.value;
  }

  private handleContentInput(e: CustomEvent): void {
    this.articleContent = e.detail.value;
  }

  private handleClose(): void {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('tc-editor-close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private async handleSave(): Promise<void> {
    if (!this.article || this.loading) return;

    this.loading = true;

    try {
      await updateArticle(this.article.id, {
        title: this.articleTitle,
        content: this.articleContent,
      });

      toastStore.success('文稿已儲存');
      this.dispatchEvent(
        new CustomEvent('tc-article-saved', {
          detail: {
            id: this.article.id,
            title: this.articleTitle,
            content: this.articleContent,
          },
          bubbles: true,
          composed: true,
        })
      );
      this.handleClose();
    } catch (error) {
      console.error('Save error:', error);
      toastStore.error('儲存失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    } finally {
      this.loading = false;
    }
  }

  show(article: Article): void {
    this.article = article;
    this.articleTitle = article.title;
    this.articleContent = article.content;
    this.open = true;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-article-editor': TcArticleEditor;
  }
}
