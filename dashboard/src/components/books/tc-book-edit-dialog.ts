import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { BookWithCategory, BookCategory } from '../../services/books.js';
import { getBookCategories, updateBook } from '../../services/books.js';
import { toastStore } from '../../stores/toast-store.js';
import '../ui/tc-dialog.js';
import '../ui/tc-button.js';
import '../ui/tc-spinner.js';

@customElement('tc-book-edit-dialog')
export class TcBookEditDialog extends LitElement {
  static styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      max-height: 60vh;
      overflow-y: auto;
      padding-right: var(--spacing-2);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .form-group.full-width {
      grid-column: 1 / -1;
    }

    .form-group label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .form-group label .required {
      color: var(--color-danger);
    }

    .form-group input,
    .form-group select,
    .form-group textarea {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      background: var(--color-bg-surface);
      color: var(--color-text-primary);
    }

    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--color-accent-light);
    }

    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }

    .form-group input:disabled,
    .form-group textarea:disabled {
      background: var(--color-bg-muted);
      cursor: not-allowed;
    }

    .section-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      margin-top: var(--spacing-4);
      padding-bottom: var(--spacing-2);
      border-bottom: 1px solid var(--color-border);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-2) 0;
    }

    .toggle-row label {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
    }

    .toggle-switch {
      position: relative;
      width: 44px;
      height: 24px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--color-border);
      transition: 0.3s;
      border-radius: 24px;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }

    .toggle-switch input:checked + .toggle-slider {
      background-color: var(--color-accent);
    }

    .toggle-switch input:checked + .toggle-slider:before {
      transform: translateX(20px);
    }

    .advanced-toggle {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      margin-top: var(--spacing-2);
    }

    .advanced-toggle:hover {
      color: var(--color-accent);
    }

    .advanced-toggle svg {
      transition: transform 0.2s;
    }

    .advanced-toggle.expanded svg {
      transform: rotate(90deg);
    }

    .advanced-fields {
      display: none;
    }

    .advanced-fields.show {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .footer-buttons {
      display: flex;
      gap: var(--spacing-3);
    }

    .footer-buttons tc-button {
      flex: 1;
    }

    .book-info {
      display: flex;
      gap: var(--spacing-4);
      padding: var(--spacing-3);
      background: var(--color-bg-muted);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-2);
    }

    .book-thumbnail {
      width: 80px;
      height: 107px;
      border-radius: var(--radius-sm);
      object-fit: cover;
      background: var(--color-bg-surface);
    }

    .book-meta {
      flex: 1;
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .book-meta a {
      color: var(--color-accent);
      text-decoration: none;
    }

    .book-meta a:hover {
      text-decoration: underline;
    }
  `;

  @property({ type: Boolean }) open = false;
  @property({ type: Object }) book: BookWithCategory | null = null;

  @state() private categories: BookCategory[] = [];
  @state() private saving = false;
  @state() private showAdvanced = false;

  // 表單欄位
  @state() private bookTitle = '';
  @state() private categoryId = '';
  @state() private introtext = '';
  @state() private author = '';
  @state() private authorIntrotext = '';
  @state() private publisher = '';
  @state() private bookDate = '';
  @state() private publishDate = '';
  @state() private isbn = '';
  @state() private catalogue = '';
  @state() private copyright = '';
  @state() private onlinePurchase = '';
  @state() private language = 'zh-TW';
  @state() private turnPage: 'left' | 'right' = 'left';
  @state() private download = true;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadCategories();
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('book') && this.book) {
      this.loadBookData();
    }
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories = await getBookCategories();
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }

  private loadBookData(): void {
    if (!this.book) return;

    this.bookTitle = this.book.title || '';
    this.categoryId = this.book.category_id ? String(this.book.category_id) : '';
    this.introtext = this.book.introtext || '';
    this.author = this.book.author || '';
    this.authorIntrotext = this.book.author_introtext || '';
    this.publisher = this.book.publisher || '';
    this.bookDate = this.book.book_date || '';
    this.publishDate = this.book.publish_date || '';
    this.isbn = this.book.isbn || '';
    this.catalogue = this.book.catalogue || '';
    this.copyright = this.book.copyright || '';
    this.onlinePurchase = this.book.online_purchase || '';
    this.language = this.book.language || 'zh-TW';
    this.turnPage = this.book.turn_page || 'left';
    this.download = this.book.download !== false;
  }

  render() {
    if (!this.book) return '';

    return html`
      <tc-dialog
        ?open=${this.open}
        dialogTitle="編輯電子書"
        size="lg"
        @tc-close=${this.handleClose}
      >
        <div class="form">
          <!-- 書籍資訊 -->
          <div class="book-info">
            ${this.book.thumbnail_url
              ? html`<img class="book-thumbnail" src=${this.book.thumbnail_url} alt=${this.book.title} />`
              : ''}
            <div class="book-meta">
              <div>ID: ${this.book.id}</div>
              ${this.book.pdf_path
                ? html`<div><a href="/books/r/${this.book.pdf_path.replace(/^books\//, '').replace(/\.pdf$/, '')}" target="_blank">閱讀電子書 ↗</a></div>`
                : ''}
              <div>建立時間: ${this.book.created_at ? new Date(this.book.created_at).toLocaleString('zh-TW') : '-'}</div>
            </div>
          </div>

          <!-- 基本資訊 -->
          <div class="section-title">基本資訊</div>

          <div class="form-row">
            <div class="form-group">
              <label>書名 <span class="required">*</span></label>
              <input
                type="text"
                .value=${this.bookTitle}
                placeholder="輸入書籍名稱"
                @input=${(e: Event) => (this.bookTitle = (e.target as HTMLInputElement).value)}
              />
            </div>

            <div class="form-group">
              <label>分類</label>
              <select
                .value=${this.categoryId}
                @change=${(e: Event) => (this.categoryId = (e.target as HTMLSelectElement).value)}
              >
                <option value="">未分類</option>
                ${this.categories.map(
                  (cat) => html`<option value=${cat.id}>${cat.name}</option>`
                )}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>作者</label>
              <input
                type="text"
                .value=${this.author}
                placeholder="輸入作者名稱"
                @input=${(e: Event) => (this.author = (e.target as HTMLInputElement).value)}
              />
            </div>

            <div class="form-group">
              <label>出版社</label>
              <input
                type="text"
                .value=${this.publisher}
                placeholder="輸入出版社"
                @input=${(e: Event) => (this.publisher = (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>

          <div class="form-group full-width">
            <label>書籍簡介</label>
            <textarea
              .value=${this.introtext}
              placeholder="輸入書籍簡介"
              @input=${(e: Event) => (this.introtext = (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </div>

          <!-- 進階選項 -->
          <div
            class="advanced-toggle ${this.showAdvanced ? 'expanded' : ''}"
            @click=${() => (this.showAdvanced = !this.showAdvanced)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"></path>
            </svg>
            進階選項
          </div>

          <div class="advanced-fields ${this.showAdvanced ? 'show' : ''}">
            <div class="form-row">
              <div class="form-group">
                <label>出版日期</label>
                <input
                  type="date"
                  .value=${this.bookDate}
                  @change=${(e: Event) => (this.bookDate = (e.target as HTMLInputElement).value)}
                />
              </div>

              <div class="form-group">
                <label>上架日期</label>
                <input
                  type="date"
                  .value=${this.publishDate}
                  @change=${(e: Event) => (this.publishDate = (e.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>ISBN</label>
                <input
                  type="text"
                  .value=${this.isbn}
                  placeholder="輸入 ISBN"
                  @input=${(e: Event) => (this.isbn = (e.target as HTMLInputElement).value)}
                />
              </div>

              <div class="form-group"></div>
            </div>

            <div class="form-group full-width">
              <label>作者簡介</label>
              <textarea
                .value=${this.authorIntrotext}
                placeholder="輸入作者簡介"
                @input=${(e: Event) => (this.authorIntrotext = (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </div>

            <div class="form-group full-width">
              <label>目錄</label>
              <textarea
                .value=${this.catalogue}
                placeholder="輸入書籍目錄"
                @input=${(e: Event) => (this.catalogue = (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>版權聲明</label>
                <select
                  .value=${this.copyright}
                  @change=${(e: Event) => (this.copyright = (e.target as HTMLSelectElement).value)}
                >
                  <option value="">請選擇</option>
                  <option value="慈濟基金會所有">慈濟基金會所有</option>
                  <option value="移轉授權使用">移轉授權使用</option>
                </select>
              </div>

              <div class="form-group">
                <label>線上購買連結</label>
                <input
                  type="text"
                  .value=${this.onlinePurchase}
                  placeholder="https://..."
                  @input=${(e: Event) => (this.onlinePurchase = (e.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>語言</label>
                <select
                  .value=${this.language}
                  @change=${(e: Event) => (this.language = (e.target as HTMLSelectElement).value)}
                >
                  <option value="zh-TW">繁體中文</option>
                  <option value="zh-CN">簡體中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </div>

              <div class="form-group">
                <label>翻頁方向</label>
                <select
                  .value=${this.turnPage}
                  @change=${(e: Event) => (this.turnPage = (e.target as HTMLSelectElement).value as 'left' | 'right')}
                >
                  <option value="left">由右向左（中文/日文）</option>
                  <option value="right">由左向右（英文）</option>
                </select>
              </div>
            </div>

            <div class="toggle-row">
              <label>允許下載</label>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  ?checked=${this.download}
                  @change=${(e: Event) => (this.download = (e.target as HTMLInputElement).checked)}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${this.handleClose} ?disabled=${this.saving}>
            取消
          </tc-button>
          <tc-button
            variant="primary"
            ?disabled=${!this.canSave || this.saving}
            @click=${this.handleSave}
          >
            ${this.saving ? '儲存中...' : '儲存'}
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private get canSave(): boolean {
    return !!this.bookTitle.trim();
  }

  private handleClose(): void {
    if (!this.saving) {
      this.dispatchEvent(new CustomEvent('tc-dialog-close'));
    }
  }

  private async handleSave(): Promise<void> {
    if (!this.canSave || !this.book) return;

    this.saving = true;

    try {
      const updates = {
        title: this.bookTitle.trim(),
        category_id: this.categoryId ? parseInt(this.categoryId, 10) : null,
        introtext: this.introtext.trim() || null,
        author: this.author.trim() || null,
        author_introtext: this.authorIntrotext.trim() || null,
        publisher: this.publisher.trim() || null,
        book_date: this.bookDate || null,
        publish_date: this.publishDate || null,
        isbn: this.isbn.trim() || null,
        catalogue: this.catalogue.trim() || null,
        copyright: this.copyright.trim() || null,
        online_purchase: this.onlinePurchase.trim() || null,
        language: this.language,
        turn_page: this.turnPage,
        download: this.download,
      };

      await updateBook(this.book.id, updates);

      toastStore.success('電子書已更新');
      this.dispatchEvent(new CustomEvent('tc-book-updated', { detail: { id: this.book.id, ...updates } }));
      this.dispatchEvent(new CustomEvent('tc-dialog-close'));
    } catch (error) {
      console.error('Save error:', error);
      toastStore.error(error instanceof Error ? error.message : '儲存失敗');
    } finally {
      this.saving = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-book-edit-dialog': TcBookEditDialog;
  }
}
