import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { Article, Category } from '../types/index.js';
import { getArticle, updateArticle, getCategories } from '../services/articles.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-spinner.js';

interface RouteLocation {
  params: { id: string; articleId: string };
}

@customElement('page-article-edit')
export class PageArticleEdit extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 24px;
    }

    .breadcrumb a {
      font-size: 13px;
      color: var(--color-text-muted);
      text-decoration: none;
    }

    .breadcrumb a:hover {
      color: var(--color-text-secondary);
    }

    .breadcrumb svg {
      width: 14px;
      height: 14px;
      color: var(--color-text-muted);
    }

    .breadcrumb span {
      font-size: 13px;
      color: var(--color-text-secondary);
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .back-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .back-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .back-btn svg {
      width: 18px;
      height: 18px;
    }

    .page-title {
      font-size: 24px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 64px;
    }

    .editor-container {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    .title-input {
      padding: 12px 16px;
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text-primary);
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      outline: none;
      transition: border-color var(--transition-fast);
    }

    .title-input:focus {
      border-color: var(--color-accent);
    }

    .editor-wrapper {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      min-height: 500px;
    }

    .editor-pane,
    .preview-pane {
      display: flex;
      flex-direction: column;
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--color-bg-surface);
      border-bottom: 1px solid var(--color-border);
    }

    .pane-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 12px;
      background: var(--color-bg-surface);
      border-bottom: 1px solid var(--color-border);
      flex-wrap: wrap;
    }

    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .toolbar-divider {
      width: 1px;
      height: 20px;
      background: var(--color-border);
      margin: 0 8px;
    }

    .toolbar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .toolbar-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .toolbar-btn:active {
      background: var(--color-accent);
      color: white;
    }

    .toolbar-btn svg {
      width: 18px;
      height: 18px;
    }

    .toolbar-btn.text-btn {
      width: auto;
      padding: 0 8px;
      font-size: 13px;
      font-weight: 600;
    }

    .content-textarea {
      flex: 1;
      padding: 16px;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 14px;
      line-height: 1.6;
      color: var(--color-text-primary);
      background: transparent;
      border: none;
      resize: none;
      outline: none;
    }

    .preview-content {
      flex: 1;
      padding: 16px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--color-text-secondary);
      overflow-y: auto;
    }

    .preview-content h1,
    .preview-content h2,
    .preview-content h3,
    .preview-content h4,
    .preview-content h5,
    .preview-content h6 {
      color: var(--color-text-primary);
      margin: 1em 0 0.5em;
    }

    .preview-content h1 { font-size: 1.5em; }
    .preview-content h2 { font-size: 1.3em; }
    .preview-content h3 { font-size: 1.1em; }

    .preview-content p {
      margin: 0 0 1em;
    }

    .preview-content ul,
    .preview-content ol {
      margin: 0 0 1em;
      padding-left: 1.5em;
    }

    .preview-content li {
      margin: 0.25em 0;
    }

    .preview-content blockquote {
      margin: 1em 0;
      padding-left: 1em;
      border-left: 3px solid var(--color-border);
      color: var(--color-text-muted);
    }

    .preview-content code {
      font-family: var(--font-mono, monospace);
      background: var(--color-bg-surface);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .preview-content pre {
      background: var(--color-bg-surface);
      padding: 1em;
      border-radius: 8px;
      overflow-x: auto;
    }

    .preview-content pre code {
      background: transparent;
      padding: 0;
    }

    .preview-content img {
      max-width: 100%;
      border-radius: 8px;
    }

    .preview-content .image-block {
      margin: 16px 0;
    }

    .preview-content .image-block figcaption {
      font-size: 13px;
      color: var(--color-text-muted);
      margin-top: 6px;
      line-height: 1.5;
    }

    .preview-content a {
      color: var(--color-accent);
    }

    .meta-info {
      display: flex;
      gap: 24px;
      padding: 16px;
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .meta-label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .meta-value {
      font-size: 14px;
      color: var(--color-text-primary);
    }

    @media (max-width: 900px) {
      .editor-wrapper {
        grid-template-columns: 1fr;
      }
    }
  `;

  @property({ type: Object })
  location?: RouteLocation;

  @state()
  private weekNumber = 0;

  @state()
  private articleId = 0;

  @state()
  private article?: Article & { category?: Category };

  @state()
  private loading = true;

  @state()
  private saving = false;

  @state()
  private articleTitle = '';

  @state()
  private content = '';

  @query('.content-textarea')
  private textarea!: HTMLTextAreaElement;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    this.weekNumber = parseInt(this.location?.params?.id || '0', 10);
    this.articleId = parseInt(this.location?.params?.articleId || '0', 10);

    if (this.weekNumber > 0 && this.articleId > 0) {
      await this.loadData();
    }
  }

  private async loadData(): Promise<void> {
    this.loading = true;

    try {
      const article = await getArticle(this.articleId);

      if (!article) {
        toastStore.error('文稿不存在');
        Router.go(`/weekly/${this.weekNumber}`);
        return;
      }

      this.article = article;
      this.articleTitle = article.title;
      this.content = article.content;
    } catch (error) {
      console.error('Error loading article:', error);
      toastStore.error('載入失敗');
    } finally {
      this.loading = false;
    }
  }

  private renderMarkdown(markdown: string): string {
    // Simple markdown to HTML conversion
    let html = markdown
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold and italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Images（必須在 Links 之前處理）
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure class="image-block"><img src="$2" alt="$1"><figcaption>$1</figcaption></figure>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match: string, text: string, url: string) => {
        const safeUrl = url.replace(/^javascript:/i, '');
        return `<a href="${safeUrl}" target="_blank">${text}</a>`;
      })
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Blockquotes
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // Unordered lists
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      // Paragraphs (double newlines)
      .replace(/\n\n/g, '</p><p>')
      // Single newlines within paragraphs
      .replace(/\n/g, '<br>');

    // Wrap loose li elements in ul
    html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');

    // Wrap in paragraph if not already wrapped
    if (!html.startsWith('<')) {
      html = '<p>' + html + '</p>';
    }

    return html;
  }

  render() {
    if (this.loading) {
      return html`
        <tc-app-shell>
          <div class="loading">
            <tc-spinner size="lg"></tc-spinner>
          </div>
        </tc-app-shell>
      `;
    }

    const platformLabel = this.article?.platform === 'docs' ? '原稿' : '數位版';
    const categoryName = this.article?.category?.name || '';

    return html`
      <tc-app-shell>
        <!-- Breadcrumb -->
        <nav class="breadcrumb">
          <a href="/" @click=${this.handleBreadcrumbHome}>週報列表</a>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <a href="/weekly/${this.weekNumber}" @click=${this.handleBreadcrumbWeekly}>第 ${this.weekNumber} 期</a>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span>編輯文稿</span>
        </nav>

        <!-- Page Header -->
        <div class="page-header">
          <div class="header-left">
            <button class="back-btn" @click=${this.handleBack} title="返回">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <h1 class="page-title">編輯文稿</h1>
          </div>
          <div class="header-actions">
            <tc-button variant="secondary" @click=${this.handleCancel}>
              取消
            </tc-button>
            <tc-button variant="primary" ?loading=${this.saving} @click=${this.handleSave}>
              儲存
            </tc-button>
          </div>
        </div>

        <div class="editor-container">
          <!-- Meta Info -->
          <div class="meta-info">
            <div class="meta-item">
              <span class="meta-label">分類</span>
              <span class="meta-value">${categoryName}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">版本</span>
              <span class="meta-value">${platformLabel}</span>
            </div>
          </div>

          <!-- Title -->
          <div class="form-group">
            <label class="form-label">標題</label>
            <input
              type="text"
              class="title-input"
              .value=${this.articleTitle}
              @input=${this.handleTitleChange}
              placeholder="請輸入標題"
            />
          </div>

          <!-- Editor -->
          <div class="editor-wrapper">
            <div class="editor-pane">
              <div class="pane-header">
                <span class="pane-title">Markdown</span>
              </div>
              <div class="toolbar">
                <!-- Text formatting -->
                <div class="toolbar-group">
                  <button class="toolbar-btn" @click=${() => this.insertFormat('**', '**')} title="粗體 (Ctrl+B)">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${() => this.insertFormat('*', '*')} title="斜體 (Ctrl+I)">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${() => this.insertFormat('~~', '~~')} title="刪除線">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/>
                    </svg>
                  </button>
                </div>

                <div class="toolbar-divider"></div>

                <!-- Headings -->
                <div class="toolbar-group">
                  <button class="toolbar-btn text-btn" @click=${() => this.insertLine('# ')} title="標題 1">H1</button>
                  <button class="toolbar-btn text-btn" @click=${() => this.insertLine('## ')} title="標題 2">H2</button>
                  <button class="toolbar-btn text-btn" @click=${() => this.insertLine('### ')} title="標題 3">H3</button>
                </div>

                <div class="toolbar-divider"></div>

                <!-- Lists -->
                <div class="toolbar-group">
                  <button class="toolbar-btn" @click=${() => this.insertLine('- ')} title="無序列表">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${() => this.insertLine('1. ')} title="有序列表">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${() => this.insertLine('> ')} title="引用">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
                    </svg>
                  </button>
                </div>

                <div class="toolbar-divider"></div>

                <!-- Code & Links -->
                <div class="toolbar-group">
                  <button class="toolbar-btn" @click=${() => this.insertFormat('`', '`')} title="行內程式碼">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${this.insertCodeBlock} title="程式碼區塊">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                      <rect x="10" y="11" width="4" height="2"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${this.insertLink} title="連結">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click=${this.insertImage} title="圖片">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                    </svg>
                  </button>
                </div>

                <div class="toolbar-divider"></div>

                <!-- Horizontal rule -->
                <div class="toolbar-group">
                  <button class="toolbar-btn" @click=${() => this.insertLine('---\n')} title="分隔線">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4 11h16v2H4z"/>
                    </svg>
                  </button>
                </div>
              </div>
              <textarea
                class="content-textarea"
                .value=${this.content}
                @input=${this.handleContentChange}
                @keydown=${this.handleKeyDown}
                placeholder="請輸入內容（支援 Markdown 格式）"
              ></textarea>
            </div>
            <div class="preview-pane">
              <div class="pane-header">
                <span class="pane-title">預覽</span>
              </div>
              <div class="preview-content" .innerHTML=${this.renderMarkdown(this.content)}></div>
            </div>
          </div>
        </div>
      </tc-app-shell>
    `;
  }

  private handleBreadcrumbHome(e: Event): void {
    e.preventDefault();
    Router.go('/');
  }

  private handleBreadcrumbWeekly(e: Event): void {
    e.preventDefault();
    Router.go(`/weekly/${this.weekNumber}`);
  }

  private handleBack(): void {
    Router.go(`/weekly/${this.weekNumber}`);
  }

  private handleCancel(): void {
    Router.go(`/weekly/${this.weekNumber}`);
  }

  private handleTitleChange(e: Event): void {
    this.articleTitle = (e.target as HTMLInputElement).value;
  }

  private handleContentChange(e: Event): void {
    this.content = (e.target as HTMLTextAreaElement).value;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (modKey && e.key === 'b') {
      e.preventDefault();
      this.insertFormat('**', '**');
    } else if (modKey && e.key === 'i') {
      e.preventDefault();
      this.insertFormat('*', '*');
    } else if (modKey && e.key === 'k') {
      e.preventDefault();
      this.insertLink();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.insertAtCursor('  ');
    }
  }

  private insertFormat(prefix: string, suffix: string): void {
    if (!this.textarea) return;

    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const selectedText = this.content.substring(start, end);

    const before = this.content.substring(0, start);
    const after = this.content.substring(end);

    if (selectedText) {
      this.content = before + prefix + selectedText + suffix + after;
      this.textarea.focus();
      requestAnimationFrame(() => {
        this.textarea.setSelectionRange(start + prefix.length, end + prefix.length);
      });
    } else {
      const placeholder = '文字';
      this.content = before + prefix + placeholder + suffix + after;
      this.textarea.focus();
      requestAnimationFrame(() => {
        this.textarea.setSelectionRange(start + prefix.length, start + prefix.length + placeholder.length);
      });
    }
  }

  private insertLine(prefix: string): void {
    if (!this.textarea) return;

    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;

    // Find the start of the current line
    const lineStart = this.content.lastIndexOf('\n', start - 1) + 1;
    const before = this.content.substring(0, lineStart);
    const lineContent = this.content.substring(lineStart, end);
    const after = this.content.substring(end);

    // Check if we need a newline before
    const needsNewline = lineStart > 0 && !before.endsWith('\n\n') && prefix === '---\n';

    this.content = before + (needsNewline ? '\n' : '') + prefix + lineContent + after;
    this.textarea.focus();

    const newCursorPos = lineStart + (needsNewline ? 1 : 0) + prefix.length + lineContent.length;
    requestAnimationFrame(() => {
      this.textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }

  private insertAtCursor(text: string): void {
    if (!this.textarea) return;

    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;

    const before = this.content.substring(0, start);
    const after = this.content.substring(end);

    this.content = before + text + after;
    this.textarea.focus();

    const newPos = start + text.length;
    requestAnimationFrame(() => {
      this.textarea.setSelectionRange(newPos, newPos);
    });
  }

  private insertLink(): void {
    if (!this.textarea) return;

    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const selectedText = this.content.substring(start, end);

    const before = this.content.substring(0, start);
    const after = this.content.substring(end);

    const linkText = selectedText || '連結文字';
    const linkUrl = 'https://';

    this.content = before + `[${linkText}](${linkUrl})` + after;
    this.textarea.focus();

    requestAnimationFrame(() => {
      // Select the URL part
      const urlStart = start + linkText.length + 3;
      const urlEnd = urlStart + linkUrl.length;
      this.textarea.setSelectionRange(urlStart, urlEnd);
    });
  }

  private insertImage(): void {
    if (!this.textarea) return;

    const start = this.textarea.selectionStart;
    const before = this.content.substring(0, start);
    const after = this.content.substring(start);

    const altText = '圖片說明';
    const imageUrl = 'https://';

    this.content = before + `![${altText}](${imageUrl})` + after;
    this.textarea.focus();

    requestAnimationFrame(() => {
      // Select the URL part
      const urlStart = start + altText.length + 4;
      const urlEnd = urlStart + imageUrl.length;
      this.textarea.setSelectionRange(urlStart, urlEnd);
    });
  }

  private insertCodeBlock(): void {
    if (!this.textarea) return;

    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const selectedText = this.content.substring(start, end);

    const before = this.content.substring(0, start);
    const after = this.content.substring(end);

    const code = selectedText || '程式碼';
    const codeBlock = '```\n' + code + '\n```';

    this.content = before + codeBlock + after;
    this.textarea.focus();

    requestAnimationFrame(() => {
      const codeStart = start + 4;
      const codeEnd = codeStart + code.length;
      this.textarea.setSelectionRange(codeStart, codeEnd);
    });
  }

  private async handleSave(): Promise<void> {
    if (!this.article) return;

    if (!this.articleTitle.trim()) {
      toastStore.error('請輸入標題');
      return;
    }

    this.saving = true;

    try {
      await updateArticle(this.articleId, {
        title: this.articleTitle.trim(),
        content: this.content,
      });

      toastStore.success('文稿已儲存');
      Router.go(`/weekly/${this.weekNumber}`);
    } catch (error) {
      console.error('Save error:', error);
      toastStore.error('儲存失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    } finally {
      this.saving = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-article-edit': PageArticleEdit;
  }
}
