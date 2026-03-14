import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { Weekly, Article, Category, Platform } from '../types/index.js';
import { getWeekly, updateWeeklyStatus } from '../services/weekly.js';
import {
  getArticles,
  getCategories,
  getArticleCountsByCategory,
  type ArticleWithCategory,
} from '../services/articles.js';
import { sendPushNotification } from '../services/worker.js';
import { authStore } from '../stores/auth-store.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-badge.js';
import '../components/ui/tc-spinner.js';
import '../components/ui/tc-dialog.js';
import '../components/article/tc-category-tabs.js';
import '../components/article/tc-article-card.js';

interface RouteLocation {
  params: { id: string };
}

@customElement('page-weekly-detail')
export class PageWeeklyDetail extends LitElement {
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

    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .page-title {
      font-size: 24px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .toggle-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--color-text-secondary);
      cursor: pointer;
      user-select: none;
    }

    .toggle-switch {
      position: relative;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
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

    .publish-confirm-content p {
      margin: 0 0 16px;
      color: var(--color-text-primary);
    }

    .push-section {
      border-top: 1px solid var(--color-border);
      padding-top: 16px;
    }

    .push-toggle-row {
      margin-bottom: 12px;
    }

    .push-fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    .field-input {
      padding: 8px 12px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
      color: var(--color-text-primary);
      background: var(--color-bg-primary);
      outline: none;
      transition: border-color var(--transition-fast);
    }

    .field-input:focus {
      border-color: var(--color-accent);
    }

    .field-textarea {
      resize: vertical;
      min-height: 48px;
    }

    .tabs-container {
      display: flex;
      flex-direction: column;
      margin-bottom: 24px;
    }

    .version-toggle {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 0;
    }

    .tabs-row {
      overflow-x: auto;
      border-bottom: 1px solid var(--color-border);
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }

    .tabs-row::-webkit-scrollbar {
      display: none;
    }

    .toggle-label {
      font-size: 13px;
      color: var(--color-text-secondary);
    }

    .toggle-btn {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .toggle-btn.active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: white;
    }

    .toggle-btn:not(.active):hover {
      background: var(--color-bg-hover);
    }

    .articles-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
    }

    .empty {
      text-align: center;
      padding: var(--spacing-12);
      color: var(--color-text-muted);
    }

    .empty h3 {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .confirm-content {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .footer-buttons {
      display: flex;
      gap: var(--spacing-3);
    }

    .footer-buttons tc-button {
      flex: 1;
    }
  `;

  @property({ type: Object })
  location?: RouteLocation;

  @state()
  private weekNumber = 0;

  @state()
  private weekly?: Weekly;

  @state()
  private categories: Category[] = [];

  @state()
  private articles: ArticleWithCategory[] = [];

  @state()
  private articleCounts: Map<number, number> = new Map();

  @state()
  private loading = true;

  @state()
  private platform: Platform = 'docs';

  @state()
  private activeCategory = 0;

  @state()
  private pushingArticle?: Article;

  @state()
  private articlePushTitle = '';

  @state()
  private articlePushBody = '';

  @state()
  private showPublishDialog = false;

  @state()
  private sendPushOnPublish = true;

  @state()
  private pushTitle = '';

  @state()
  private pushBody = '';

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    this.weekNumber = parseInt(this.location?.params?.id || '0', 10);

    // 從 URL query params 還原狀態
    const params = new URLSearchParams(window.location.search);
    const qPlatform = params.get('platform');
    const qCategory = params.get('category');
    if (qPlatform === 'docs' || qPlatform === 'digital') {
      this.platform = qPlatform;
    }
    if (qCategory) {
      this.activeCategory = parseInt(qCategory, 10) || 0;
    }

    if (this.weekNumber > 0) {
      await this.loadData();
    }
  }

  private async loadData(): Promise<void> {
    this.loading = true;

    try {
      const [weekly, categories] = await Promise.all([
        getWeekly(this.weekNumber),
        getCategories(),
      ]);

      if (!weekly) {
        toastStore.error('週報不存在');
        Router.go('/');
        return;
      }

      this.weekly = weekly;
      this.categories = categories;

      // 如果沒有從 query params 帶入 category，使用第一個分類
      if (this.activeCategory === 0 && categories.length > 0) {
        this.activeCategory = categories[0].id;
      }

      await this.loadArticles();
    } catch (error) {
      console.error('Error loading data:', error);
      toastStore.error('載入失敗');
    } finally {
      this.loading = false;
    }
  }

  private async loadArticles(): Promise<void> {
    try {
      const [articles, counts] = await Promise.all([
        getArticles(this.weekNumber, this.platform, this.activeCategory),
        getArticleCountsByCategory(this.weekNumber, this.platform),
      ]);

      this.articles = articles;
      this.articleCounts = counts;
    } catch (error) {
      console.error('Error loading articles:', error);
      toastStore.error('載入文稿失敗');
    }
  }

  private getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: '草稿',
      published: '已發布',
      archived: '已封存',
    };
    return labels[status] || status;
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

    return html`
      <tc-app-shell>
        <!-- Breadcrumb -->
        <nav class="breadcrumb">
          <a href="/" @click=${this.handleBreadcrumbClick}>週報列表</a>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span>第 ${this.weekNumber} 期</span>
        </nav>

        <!-- Page Header -->
        <div class="page-header">
          <div class="header-left">
            <button class="back-btn" @click=${this.handleBack} title="返回" aria-label="返回">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <div class="title-group">
              <h1 class="page-title">第 ${this.weekNumber} 期</h1>
              ${this.weekly
                ? html`
                    <tc-badge variant=${this.weekly.status} show-dot>
                      ${this.getStatusLabel(this.weekly.status)}
                    </tc-badge>
                  `
                : ''}
            </div>
          </div>
          <div class="header-actions">
            ${this.weekly?.status === 'draft'
              ? html`
                  <tc-button variant="primary" @click=${this.handlePublish}>
                    <svg slot="icon" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                    發布
                  </tc-button>
                `
              : ''}
            ${this.weekly?.status === 'published'
              ? html`
                  <tc-button variant="outline" @click=${this.handleUnpublish}>
                    <svg slot="icon" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px">
                      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                    </svg>
                    取消發布
                  </tc-button>
                  <tc-button variant="outline" @click=${this.handleArchive}>
                    <svg slot="icon" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px">
                      <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/>
                    </svg>
                    封存
                  </tc-button>
                `
              : ''}
            ${this.weekly?.status === 'archived'
              ? html`
                  <tc-button variant="primary" @click=${this.handleRestore}>
                    <svg slot="icon" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px">
                      <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z"/>
                    </svg>
                    恢復
                  </tc-button>
                `
              : ''}
          </div>
        </div>

        <!-- Tabs Container -->
        <div class="tabs-container">
          <div class="version-toggle">
            <span class="toggle-label">版本：</span>
            <button
              class="toggle-btn ${this.platform === 'docs' ? 'active' : ''}"
              @click=${() => this.handlePlatformSelect('docs')}
            >
              原稿
            </button>
            <button
              class="toggle-btn ${this.platform === 'digital' ? 'active' : ''}"
              @click=${() => this.handlePlatformSelect('digital')}
            >
              數位版
            </button>
          </div>
          <div class="tabs-row">
            <tc-category-tabs
              .categories=${this.categories}
              .counts=${this.articleCounts}
              activeCategory=${this.activeCategory}
              @tc-category-change=${this.handleCategoryChange}
            ></tc-category-tabs>
          </div>
        </div>

        <!-- Articles List -->
        ${this.articles.length === 0
          ? html`
              <div class="empty">
                <h3>此分類沒有文稿</h3>
                <p>選擇其他分類查看</p>
              </div>
            `
          : html`
              <div class="articles-list">
                ${this.articles.map(
                  (article) => html`
                    <tc-article-card
                      .article=${article}
                      ?showPush=${this.platform === 'digital'}
                      @tc-article-push=${this.handleArticlePush}
                    ></tc-article-card>
                  `
                )}
              </div>
            `}
      </tc-app-shell>

      ${this.renderArticlePushDialog()}
      ${this.renderPublishConfirm()}
    `;
  }

  private renderArticlePushDialog() {
    if (!this.pushingArticle) return '';

    return html`
      <tc-dialog
        open
        dialogTitle="推播文稿通知"
        size="sm"
        @tc-close=${() => (this.pushingArticle = undefined)}
      >
        <div class="push-fields">
          <div class="field">
            <label class="field-label">推播標題</label>
            <input
              type="text"
              class="field-input"
              .value=${this.articlePushTitle}
              @input=${(e: Event) => (this.articlePushTitle = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field-label">推播內容</label>
            <textarea
              class="field-input field-textarea"
              rows="3"
              .value=${this.articlePushBody}
              @input=${(e: Event) => (this.articlePushBody = (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </div>
        </div>
        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${() => (this.pushingArticle = undefined)}>
            取消
          </tc-button>
          <tc-button variant="primary" @click=${this.handleArticlePushConfirm}>
            發送推播
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private renderPublishConfirm() {
    if (!this.showPublishDialog) return '';

    return html`
      <tc-dialog
        open
        dialogTitle="確認發布"
        size="sm"
        @tc-close=${() => (this.showPublishDialog = false)}
      >
        <div class="publish-confirm-content">
          <p>確定要發布第 ${this.weekNumber} 期週報嗎？</p>

          <div class="push-section">
            <div class="push-toggle-row">
              <label class="toggle-label">
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    ?checked=${this.sendPushOnPublish}
                    @change=${(e: Event) => (this.sendPushOnPublish = (e.target as HTMLInputElement).checked)}
                  />
                  <span class="toggle-slider"></span>
                </label>
                發送推播通知
              </label>
            </div>

            ${this.sendPushOnPublish
              ? html`
                  <div class="push-fields">
                    <div class="field">
                      <label class="field-label">推播標題</label>
                      <input
                        type="text"
                        class="field-input"
                        .value=${this.pushTitle}
                        @input=${(e: Event) => (this.pushTitle = (e.target as HTMLInputElement).value)}
                      />
                    </div>
                    <div class="field">
                      <label class="field-label">推播內容</label>
                      <textarea
                        class="field-input field-textarea"
                        rows="2"
                        .value=${this.pushBody}
                        @input=${(e: Event) => (this.pushBody = (e.target as HTMLTextAreaElement).value)}
                      ></textarea>
                    </div>
                  </div>
                `
              : ''}
          </div>
        </div>
        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${() => (this.showPublishDialog = false)}>
            取消
          </tc-button>
          <tc-button variant="primary" @click=${this.handlePublishConfirm}>
            確認發布
          </tc-button>
        </div>
      </tc-dialog>
    `;
  }

  private handleBreadcrumbClick(e: Event): void {
    e.preventDefault();
    Router.go('/');
  }

  private handleBack(): void {
    Router.go('/');
  }

  private updateQueryParams(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('platform', this.platform);
    url.searchParams.set('category', String(this.activeCategory));
    window.history.replaceState(null, '', url.toString());
  }

  private handlePlatformSelect(platform: Platform): void {
    if (this.platform !== platform) {
      this.platform = platform;
      this.updateQueryParams();
      this.loadArticles();
    }
  }

  private async handleCategoryChange(e: CustomEvent): Promise<void> {
    this.activeCategory = e.detail.categoryId;
    this.updateQueryParams();
    await this.loadArticles();
  }

  private handleArticlePush(e: CustomEvent): void {
    const article = e.detail.article as Article;
    this.pushingArticle = article;
    this.articlePushTitle = article.title;
    this.articlePushBody = article.description || this.getArticlePreview(article.content);
  }

  private getArticlePreview(content: string): string {
    return content
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n{2,}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  private async handleArticlePushConfirm(): Promise<void> {
    if (!this.pushingArticle) return;

    try {
      const result = await sendPushNotification({
        title: this.articlePushTitle,
        body: this.articlePushBody,
        url: `/article/${this.pushingArticle.id}`,
      });
      toastStore.success(`推播已發送（${result.sent} 人）`);
      this.pushingArticle = undefined;
    } catch (error) {
      console.error('Push error:', error);
      toastStore.error('推播發送失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    }
  }

  private handlePublish(): void {
    if (!this.weekly) return;
    this.pushTitle = `慈濟週報 第 ${this.weekNumber} 期`;
    this.pushBody = '最新一期週報已上線，立即閱讀！';
    this.sendPushOnPublish = true;
    this.showPublishDialog = true;
  }

  private async handlePublishConfirm(): Promise<void> {
    this.showPublishDialog = false;

    try {
      await updateWeeklyStatus(
        this.weekNumber,
        'published',
        new Date().toISOString().split('T')[0]
      );
      toastStore.success('週報已發布');

      if (this.sendPushOnPublish) {
        try {
          const result = await sendPushNotification({
            title: this.pushTitle,
            body: this.pushBody,
            url: `/weekly/${this.weekNumber}`,
          });
          toastStore.success(`推播已發送（${result.sent} 人）`);
        } catch (pushError) {
          console.error('Push notification error:', pushError);
          toastStore.error('週報已發布，但推播通知發送失敗');
        }
      }

      await this.loadData();
    } catch (error) {
      console.error('Publish error:', error);
      toastStore.error('發布失敗');
    }
  }

  private async handleUnpublish(): Promise<void> {
    if (!this.weekly) return;

    try {
      await updateWeeklyStatus(this.weekNumber, 'draft');
      toastStore.success('已取消發布');
      await this.loadData();
    } catch (error) {
      console.error('Unpublish error:', error);
      toastStore.error('取消發布失敗');
    }
  }

  private async handleArchive(): Promise<void> {
    if (!this.weekly) return;

    try {
      await updateWeeklyStatus(this.weekNumber, 'archived');
      toastStore.success('週報已封存');
      await this.loadData();
    } catch (error) {
      console.error('Archive error:', error);
      toastStore.error('封存失敗');
    }
  }

  private async handleRestore(): Promise<void> {
    if (!this.weekly) return;

    try {
      await updateWeeklyStatus(this.weekNumber, 'draft');
      toastStore.success('週報已恢復');
      await this.loadData();
    } catch (error) {
      console.error('Restore error:', error);
      toastStore.error('恢復失敗');
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-weekly-detail': PageWeeklyDetail;
  }
}
