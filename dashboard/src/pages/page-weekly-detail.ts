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
import { rewriteArticle } from '../services/worker.js';
import { authStore } from '../stores/auth-store.js';
import { toastStore } from '../stores/toast-store.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/ui/tc-badge.js';
import '../components/ui/tc-spinner.js';
import '../components/ui/tc-dialog.js';
import '../components/article/tc-platform-toggle.js';
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
      gap: 12px;
    }

    .tabs-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 0;
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 24px;
    }

    .tabs-container {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    .version-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 8px;
      flex-shrink: 0;
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
  private rewritingArticle?: Article;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    this.weekNumber = parseInt(this.location?.params?.id || '0', 10);

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

      if (categories.length > 0) {
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
            <button class="back-btn" @click=${this.handleBack} title="返回">
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

        <!-- Tabs Row -->
        <div class="tabs-row">
          <div class="tabs-container">
            <tc-category-tabs
              .categories=${this.categories}
              .counts=${this.articleCounts}
              activeCategory=${this.activeCategory}
              @tc-category-change=${this.handleCategoryChange}
            ></tc-category-tabs>
          </div>
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
                      ?showRewrite=${this.platform === 'digital'}
                      @tc-article-rewrite=${this.handleArticleRewrite}
                    ></tc-article-card>
                  `
                )}
              </div>
            `}
      </tc-app-shell>

      ${this.renderRewriteConfirm()}
    `;
  }

  private renderRewriteConfirm() {
    if (!this.rewritingArticle) return '';

    return html`
      <tc-dialog
        open
        dialogTitle="確認重新改寫"
        size="sm"
        @tc-close=${this.handleRewriteCancel}
      >
        <div class="confirm-content">
          <p>確定要重新 AI 改寫「${this.rewritingArticle.title}」嗎？</p>
          <p>這將會覆蓋目前的數位版內容。</p>
        </div>
        <div slot="footer" class="footer-buttons">
          <tc-button variant="secondary" @click=${this.handleRewriteCancel}>
            取消
          </tc-button>
          <tc-button variant="primary" @click=${this.handleRewriteConfirm}>
            確認改寫
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

  private handlePlatformSelect(platform: Platform): void {
    if (this.platform !== platform) {
      this.platform = platform;
      this.loadArticles();
    }
  }

  private async handleCategoryChange(e: CustomEvent): Promise<void> {
    this.activeCategory = e.detail.categoryId;
    await this.loadArticles();
  }

  
  private handleArticleRewrite(e: CustomEvent): void {
    this.rewritingArticle = e.detail.article;
  }

  private handleRewriteCancel(): void {
    this.rewritingArticle = undefined;
  }

  private async handleRewriteConfirm(): Promise<void> {
    if (!this.rewritingArticle) return;

    try {
      await rewriteArticle({
        article_id: this.rewritingArticle.id,
        user_email: authStore.userEmail || 'unknown',
      });

      toastStore.success('AI 改寫已開始');
      this.rewritingArticle = undefined;
    } catch (error) {
      console.error('Rewrite error:', error);
      toastStore.error('改寫失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    }
  }

  private async handlePublish(): Promise<void> {
    if (!this.weekly) return;

    try {
      await updateWeeklyStatus(
        this.weekNumber,
        'published',
        new Date().toISOString().split('T')[0]
      );
      toastStore.success('週報已發布');
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
