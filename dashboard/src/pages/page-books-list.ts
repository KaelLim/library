import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { BookWithCategory, BookCategory } from '../services/books.js';
import { getBookList, getBookCategories, deleteBook } from '../services/books.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-tabs.js';
import '../components/ui/tc-spinner.js';
import '../components/ui/tc-dialog.js';
import '../components/books/tc-book-upload-dialog.js';
import '../components/books/tc-book-edit-dialog.js';

interface CategoryTab {
  id: string;
  label: string;
  count?: number;
}

@customElement('page-books-list')
export class PageBooksList extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-6);
    }

    .tabs-container {
      flex: 1;
      overflow-x: auto;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--spacing-4);
    }

    .book-card {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      transition: box-shadow var(--transition-base);
    }

    .book-card:hover {
      box-shadow: var(--shadow-md);
    }

    .book-thumbnail {
      aspect-ratio: 3/4;
      background: var(--color-bg-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .book-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .book-thumbnail .placeholder {
      color: var(--color-text-muted);
      font-size: 48px;
    }

    .book-info {
      padding: var(--spacing-4);
    }

    .book-category {
      font-size: var(--font-size-xs);
      color: var(--color-accent);
      font-weight: var(--font-weight-medium);
      margin-bottom: var(--spacing-1);
    }

    .book-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .book-author {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-3);
    }

    .book-actions {
      display: flex;
      gap: var(--spacing-2);
    }

    .book-actions tc-button {
      flex: 1;
    }

    .empty {
      text-align: center;
      padding: var(--spacing-12);
      color: var(--color-text-muted);
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto var(--spacing-4);
      color: var(--color-text-muted);
    }

    .empty h3 {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
    }

    .confirm-content {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: var(--line-height-relaxed);
    }

    .footer-buttons {
      display: flex;
      gap: var(--spacing-3);
    }

    .footer-buttons tc-button {
      flex: 1;
    }
  `;

  @state()
  private books: BookWithCategory[] = [];

  @state()
  private categories: BookCategory[] = [];

  @state()
  private loading = true;

  @state()
  private activeCategory: string = 'all';

  @state()
  private deleteTarget: BookWithCategory | null = null;

  @state()
  private showUploadDialog = false;

  @state()
  private editTarget: BookWithCategory | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    this.loading = true;
    try {
      const [books, categories] = await Promise.all([
        getBookList(),
        getBookCategories(),
      ]);
      this.books = books;
      this.categories = categories;
    } catch (error) {
      console.error('Error loading books:', error);
      toastStore.error('載入書籍列表失敗');
    } finally {
      this.loading = false;
    }
  }

  private get categoryTabs(): CategoryTab[] {
    const counts = this.getCategoryCounts();
    return [
      { id: 'all', label: '全部', count: counts.all },
      ...this.categories.map((cat) => ({
        id: String(cat.id),
        label: cat.name,
        count: counts[cat.id] || 0,
      })),
    ];
  }

  private getCategoryCounts(): Record<string, number> {
    const counts: Record<string, number> = { all: this.books.length };
    for (const book of this.books) {
      if (book.category_id != null) {
        counts[book.category_id] = (counts[book.category_id] || 0) + 1;
      }
    }
    return counts;
  }

  private get filteredBooks(): BookWithCategory[] {
    if (this.activeCategory === 'all') {
      return this.books;
    }
    return this.books.filter(
      (book) => String(book.category_id) === this.activeCategory
    );
  }

  render() {
    return html`
      <tc-app-shell pageTitle="電子書管理">
        <tc-button
          slot="header-right"
          variant="primary"
          @click=${this.handleUpload}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          上傳電子書
        </tc-button>

        <div class="toolbar">
          <div class="tabs-container">
            <tc-tabs
              .tabs=${this.categoryTabs}
              activeTab=${this.activeCategory}
              @tc-tab-change=${this.handleTabChange}
            ></tc-tabs>
          </div>
        </div>

        ${this.loading
          ? html`
              <div class="loading">
                <tc-spinner size="lg"></tc-spinner>
              </div>
            `
          : this.filteredBooks.length === 0
            ? this.renderEmpty()
            : this.renderGrid()}
      </tc-app-shell>

      ${this.renderDeleteDialog()}

      <tc-book-upload-dialog
        ?open=${this.showUploadDialog}
        @tc-dialog-close=${this.handleUploadClose}
        @tc-book-created=${this.handleBookCreated}
      ></tc-book-upload-dialog>

      <tc-book-edit-dialog
        ?open=${!!this.editTarget}
        .book=${this.editTarget}
        @tc-dialog-close=${this.handleEditClose}
        @tc-book-updated=${this.handleBookUpdated}
      ></tc-book-edit-dialog>
    `;
  }

  private renderEmpty() {
    return html`
      <div class="empty">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
        </svg>
        <h3>尚無電子書</h3>
        <p>透過 API 上傳 PDF 建立電子書</p>
      </div>
    `;
  }

  private renderGrid() {
    return html`
      <div class="grid">
        ${this.filteredBooks.map((book) => this.renderBookCard(book))}
      </div>
    `;
  }

  private renderBookCard(book: BookWithCategory) {
    return html`
      <div class="book-card">
        <div class="book-thumbnail">
          ${book.thumbnail_url
            ? html`<img src=${book.thumbnail_url} alt=${book.title} />`
            : html`<span class="placeholder">📖</span>`}
        </div>
        <div class="book-info">
          <div class="book-category">${book.category?.name || '未分類'}</div>
          <div class="book-title">${book.title}</div>
          ${book.author ? html`<div class="book-author">${book.author}</div>` : ''}
          <div class="book-actions">
            ${book.pdf_path
              ? html`
                  <tc-button
                    variant="primary"
                    size="sm"
                    @click=${() => this.handleView(book)}
                  >
                    閱讀
                  </tc-button>
                `
              : ''}
            <tc-button
              variant="secondary"
              size="sm"
              @click=${() => this.handleEdit(book)}
            >
              編輯
            </tc-button>
            <tc-button
              variant="ghost"
              size="sm"
              @click=${() => this.handleDelete(book)}
            >
              刪除
            </tc-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderDeleteDialog() {
    if (!this.deleteTarget) return '';

    return html`
      <tc-dialog
        open
        dialogTitle="確認刪除"
        size="sm"
        @tc-close=${this.handleDeleteClose}
      >
        <div class="confirm-content">
          <p>確定要刪除「${this.deleteTarget.title}」嗎？此操作無法復原。</p>
        </div>
        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${this.handleDeleteClose}>
            取消
          </tc-button>
          <tc-button variant="danger" @click=${this.handleDeleteConfirm}>
            刪除
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private handleTabChange(e: CustomEvent): void {
    this.activeCategory = e.detail.tabId;
  }

  private handleUpload(): void {
    this.showUploadDialog = true;
  }

  private handleUploadClose(): void {
    this.showUploadDialog = false;
  }

  private async handleBookCreated(): Promise<void> {
    this.showUploadDialog = false;
    await this.loadData();
  }

  private handleView(book: BookWithCategory): void {
    if (book.pdf_path) {
      const uuid = book.pdf_path.replace(/^books\//, '').replace(/\.pdf$/, '');
      window.open(`/books/r/${uuid}`, '_blank');
    }
  }

  private handleEdit(book: BookWithCategory): void {
    this.editTarget = book;
  }

  private handleEditClose(): void {
    this.editTarget = null;
  }

  private async handleBookUpdated(): Promise<void> {
    this.editTarget = null;
    await this.loadData();
  }

  private handleDelete(book: BookWithCategory): void {
    this.deleteTarget = book;
  }

  private handleDeleteClose(): void {
    this.deleteTarget = null;
  }

  private async handleDeleteConfirm(): Promise<void> {
    if (!this.deleteTarget) return;

    try {
      await deleteBook(this.deleteTarget.id);
      toastStore.success('書籍已刪除');
      this.deleteTarget = null;
      await this.loadData();
    } catch (error) {
      console.error('Delete error:', error);
      toastStore.error('刪除失敗');
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-books-list': PageBooksList;
  }
}
