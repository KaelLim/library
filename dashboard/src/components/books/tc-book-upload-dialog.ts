import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import type { BookCategory } from '../../services/books.js';
import { getBookCategories } from '../../services/books.js';
import { toastStore } from '../../stores/toast-store.js';
import { authStore } from '../../stores/auth-store.js';
import '../ui/tc-dialog.js';
import '../ui/tc-button.js';
import '../ui/tc-spinner.js';

@customElement('tc-book-upload-dialog')
export class TcBookUploadDialog extends LitElement {
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

    .file-upload {
      border: 2px dashed var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-6);
      text-align: center;
      cursor: pointer;
      transition: all var(--transition-base);
    }

    .file-upload:hover {
      border-color: var(--color-accent);
      background: var(--color-bg-muted);
    }

    .file-upload.has-file {
      border-color: var(--color-success);
      background: rgba(16, 185, 129, 0.1);
    }

    .file-upload input {
      display: none;
    }

    .file-upload-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto var(--spacing-3);
      color: var(--color-text-muted);
    }

    .file-upload.has-file .file-upload-icon {
      color: var(--color-success);
    }

    .file-upload-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .file-upload-text strong {
      color: var(--color-accent);
    }

    .file-name {
      font-size: var(--font-size-sm);
      color: var(--color-success);
      font-weight: var(--font-weight-medium);
      margin-top: var(--spacing-2);
    }

    .file-size {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
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

    .progress-container {
      text-align: center;
      padding: var(--spacing-6);
    }

    .progress-text {
      margin-top: var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .progress-step {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }
  `;

  @property({ type: Boolean }) open = false;

  @state() private categories: BookCategory[] = [];
  @state() private selectedFile: File | null = null;
  @state() private uploading = false;
  @state() private uploadStep = '';
  @state() private showAdvanced = false;

  // 基本欄位
  @state() private bookTitle = '';
  @state() private categoryId = '';
  @state() private introtext = '';
  @state() private author = '';

  // 進階欄位
  @state() private authorIntrotext = '';
  @state() private publisher = '';
  @state() private bookDate = '';
  @state() private publishDate = '';
  @state() private isbn = '';
  @state() private catalogue = '';
  @state() private copyright = '';
  @state() private onlinePurchase = '';
  @state() private language = 'zh-TW';
  @state() private turnPage = 'left';
  @state() private download = true;
  @state() private weeklyNumber = '';

  @query('#file-input') private fileInput!: HTMLInputElement;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadCategories();
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories = await getBookCategories();
      if (this.categories.length > 0 && !this.categoryId) {
        this.categoryId = String(this.categories[0].id);
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }

  private get isWeeklyCategory(): boolean {
    const cat = this.categories.find((c) => String(c.id) === this.categoryId);
    return cat?.slug === 'weekly';
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private handleCategoryChange(value: string): void {
    this.categoryId = value;
    const cat = this.categories.find((c) => String(c.id) === value);
    if (cat?.slug === 'weekly') {
      // 自動填入週報預設值
      if (!this.author) this.author = '慈濟文史處數位平台組 文編';
      if (!this.publisher) this.publisher = '慈濟文史處數位平台組';
      if (!this.bookDate) this.bookDate = this.getTodayString();
      if (!this.publishDate) this.publishDate = this.getTodayString();
    }
  }

  render() {
    return html`
      <tc-dialog
        ?open=${this.open}
        dialogTitle="上傳電子書"
        size="lg"
        @tc-close=${this.handleClose}
      >
        ${this.uploading ? this.renderProgress() : this.renderForm()}
      </tc-dialog>
    `;
  }

  private renderProgress() {
    return html`
      <div class="progress-container">
        <tc-spinner size="lg"></tc-spinner>
        <div class="progress-text">
          <div class="progress-step">${this.uploadStep}</div>
          <div>請稍候...</div>
        </div>
      </div>
    `;
  }

  private renderForm() {
    return html`
      <div class="form">
        <!-- PDF 檔案 -->
        <div class="form-group full-width">
          <label>PDF 檔案 <span class="required">*</span></label>
          <div
            class="file-upload ${this.selectedFile ? 'has-file' : ''}"
            @click=${this.handleFileClick}
            @dragover=${this.handleDragOver}
            @drop=${this.handleDrop}
          >
            <input
              id="file-input"
              type="file"
              accept=".pdf"
              @change=${this.handleFileChange}
            />
            <svg class="file-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              ${this.selectedFile
                ? html`<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>`
                : html`<path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>`}
            </svg>
            ${this.selectedFile
              ? html`
                  <div class="file-name">${this.selectedFile.name}</div>
                  <div class="file-size">${this.formatFileSize(this.selectedFile.size)}</div>
                `
              : html`
                  <div class="file-upload-text">
                    <strong>點擊上傳</strong> 或拖曳 PDF 檔案
                  </div>
                `}
          </div>
        </div>

        <!-- 基本資訊 -->
        <div class="section-title">基本資訊</div>

        <div class="form-row">
          <div class="form-group">
            <label>分類 <span class="required">*</span></label>
            <select
              .value=${this.categoryId}
              @change=${(e: Event) => this.handleCategoryChange((e.target as HTMLSelectElement).value)}
            >
              ${this.categories.map(
                (cat) => html`<option value=${cat.id}>${cat.name}</option>`
              )}
            </select>
          </div>

          ${this.isWeeklyCategory
            ? html`
                <div class="form-group">
                  <label>期數 <span class="required">*</span></label>
                  <input
                    type="number"
                    .value=${this.weeklyNumber}
                    placeholder="例：127"
                    min="1"
                    @input=${(e: Event) => {
                      this.weeklyNumber = (e.target as HTMLInputElement).value;
                      if (this.weeklyNumber) {
                        this.bookTitle = `慈濟週報第${this.weeklyNumber}期`;
                      }
                    }}
                  />
                </div>
              `
            : html`
                <div class="form-group">
                  <label>書名 <span class="required">*</span></label>
                  <input
                    type="text"
                    .value=${this.bookTitle}
                    placeholder="輸入書籍名稱"
                    @input=${(e: Event) => (this.bookTitle = (e.target as HTMLInputElement).value)}
                  />
                </div>
              `}
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
                @change=${(e: Event) => (this.turnPage = (e.target as HTMLSelectElement).value)}
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
        <tc-button variant="secondary" @click=${this.handleClose}>
          取消
        </tc-button>
        <tc-button
          variant="primary"
          ?disabled=${!this.canSubmit}
          @click=${this.handleSubmit}
        >
          上傳
        </tc-button>
      </div>
    `;
  }

  private get canSubmit(): boolean {
    if (!this.selectedFile || !this.categoryId) return false;
    if (this.isWeeklyCategory) return !!this.weeklyNumber;
    return !!this.bookTitle.trim();
  }

  private handleFileClick(): void {
    this.fileInput?.click();
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file && file.type === 'application/pdf') {
      this.selectedFile = file;
      if (!this.bookTitle) {
        this.bookTitle = file.name.replace(/\.pdf$/i, '');
      }
    }
  }

  private handleFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.selectedFile = file;
      if (!this.bookTitle) {
        this.bookTitle = file.name.replace(/\.pdf$/i, '');
      }
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private handleClose(): void {
    if (!this.uploading) {
      this.resetForm();
      this.dispatchEvent(new CustomEvent('tc-dialog-close'));
    }
  }

  private resetForm(): void {
    this.selectedFile = null;
    this.bookTitle = '';
    this.weeklyNumber = '';
    this.introtext = '';
    this.author = '';
    this.authorIntrotext = '';
    this.publisher = '';
    this.bookDate = '';
    this.publishDate = '';
    this.isbn = '';
    this.catalogue = '';
    this.copyright = '';
    this.onlinePurchase = '';
    this.language = 'zh-TW';
    this.turnPage = 'left';
    this.download = true;
    this.showAdvanced = false;
    if (this.categories.length > 0) {
      this.categoryId = String(this.categories[0].id);
    }
  }

  private async handleSubmit(): Promise<void> {
    if (!this.canSubmit || !this.selectedFile) return;

    this.uploading = true;

    try {
      const formData = new FormData();

      // IMPORTANT: All text fields must come BEFORE the file
      // @fastify/multipart's request.file() only captures fields before the file
      formData.append('title', this.bookTitle.trim());
      formData.append('category_id', this.categoryId);

      // 基本欄位
      if (this.introtext.trim()) formData.append('introtext', this.introtext.trim());
      if (this.author.trim()) formData.append('author', this.author.trim());
      if (this.publisher.trim()) formData.append('publisher', this.publisher.trim());

      // 進階欄位
      if (this.authorIntrotext.trim()) formData.append('author_introtext', this.authorIntrotext.trim());
      if (this.bookDate) formData.append('book_date', this.bookDate);
      if (this.publishDate) formData.append('publish_date', this.publishDate);
      if (this.isbn.trim()) formData.append('isbn', this.isbn.trim());
      if (this.catalogue.trim()) formData.append('catalogue', this.catalogue.trim());
      if (this.copyright.trim()) formData.append('copyright', this.copyright.trim());
      if (this.onlinePurchase.trim()) formData.append('online_purchase', this.onlinePurchase.trim());
      formData.append('language', this.language);
      formData.append('turn_page', this.turnPage);
      formData.append('download', String(this.download));

      // File must be LAST
      formData.append('pdf_file', this.selectedFile);

      this.uploadStep = '壓縮 PDF 中...';

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
      const token = authStore.session?.access_token || '';
      const response = await fetch('/worker/books/create', {
        method: 'POST',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '上傳失敗');
      }

      const result = await response.json();

      toastStore.success(`電子書「${result.book.title}」建立成功！`);
      this.resetForm();
      this.dispatchEvent(new CustomEvent('tc-book-created', { detail: result.book }));
      this.dispatchEvent(new CustomEvent('tc-dialog-close'));
    } catch (error) {
      console.error('Upload error:', error);
      toastStore.error(error instanceof Error ? error.message : '上傳失敗');
    } finally {
      this.uploading = false;
      this.uploadStep = '';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-book-upload-dialog': TcBookUploadDialog;
  }
}
