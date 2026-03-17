# Push Notification Management Page — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/push` page to the dashboard for sending custom push notifications and viewing all push history from audit_logs.

**Architecture:** Worker API gets audit logging on `/push/send` + new `/push/logs` query endpoint. Dashboard gets a new `page-push` component with send form + paginated history table. All push sources (custom, weekly_publish, article) write to `audit_logs` with `action: 'send_push'`.

**Tech Stack:** Lit Web Components, Fastify, Supabase (PostgreSQL), Firebase Cloud Messaging

**Spec:** `docs/superpowers/specs/2026-03-17-push-notification-page-design.md`

---

## Chunk 1: Data Layer & Worker API

### Task 1: Update audit_logs action constraint

**Files:**
- Modify: `supabase-docker/volumes/db/init/data.sql:56-58` — update CHECK constraint
- Modify: `supabase-docker/volumes/db/init/002_books.sql:68-72` — update CHECK constraint (overrides data.sql)
- Create: `supabase-docker/volumes/db/migrations/002_add_send_push_action.sql`

- [ ] **Step 1: Update init SQL constraint**

In `supabase-docker/volumes/db/init/data.sql`, replace the constraint (line 56-58):

```sql
  CONSTRAINT audit_logs_action_check CHECK (
    action IN ('login', 'logout', 'insert', 'update', 'delete', 'import', 'ai_transform', 'create_book', 'upload_pdf', 'batch_generate_descriptions', 'batch_generate_thumbnails', 'send_push')
  )
```

- [ ] **Step 1b: Update 002_books.sql constraint**

In `supabase-docker/volumes/db/init/002_books.sql`, replace the constraint (lines 68-72) — this file runs after data.sql and overrides its constraint:

```sql
-- 更新 audit_logs action check (需要先刪除再重建)
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'upload_pdf',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push'
  )
);
```

- [ ] **Step 2: Create migration file**

Create `supabase-docker/volumes/db/migrations/002_add_send_push_action.sql`:

```sql
-- 補齊所有 action 類型（含已存在但遺漏的 + 新增 send_push）
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'upload_pdf',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push'
  )
);
```

- [ ] **Step 3: Commit**

```bash
git add supabase-docker/volumes/db/init/data.sql supabase-docker/volumes/db/init/002_books.sql supabase-docker/volumes/db/migrations/002_add_send_push_action.sql
git commit -m "feat: add send_push to audit_logs action constraint"
```

---

### Task 2: Update Worker types

**Files:**
- Modify: `worker/src/types/index.ts:52` — add `'send_push'` to AuditLog action union

- [ ] **Step 1: Add send_push to AuditLog action type**

In `worker/src/types/index.ts` line 52, add `| 'send_push'` to the action union:

```typescript
  action: 'login' | 'logout' | 'insert' | 'update' | 'delete' | 'import' | 'ai_transform' | 'create_book' | 'upload_pdf' | 'batch_generate_descriptions' | 'batch_generate_thumbnails' | 'send_push';
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/types/index.ts
git commit -m "feat: add send_push to AuditLog action type"
```

---

### Task 3: Add audit logging to POST /push/send + source param

**Files:**
- Modify: `worker/src/routes/api-v1.ts:497-520` — add audit log write, source param, URL pattern

- [ ] **Step 1: Update the /push/send endpoint**

First, add `insertAuditLog` to the imports from `supabase.ts`:

```typescript
import { getSupabase, insertAuditLog } from '../services/supabase.js';
```

Then in `worker/src/routes/api-v1.ts`, replace the existing `/push/send` handler (lines 497-520):

```typescript
// POST /push/send - 發送推播（dashboard 用）
fastify.post<{
  Body: { title: string; body: string; url?: string; source?: string };
}>('/push/send', {
  preHandler: [requireAuth],
  config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  schema: {
    tags: ['推播'],
    summary: '發送推播通知',
    description: '發送推播通知給所有訂閱者',
    body: {
      type: 'object',
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100, description: '通知標題' },
        body: { type: 'string', minLength: 1, maxLength: 500, description: '通知內文' },
        url: { type: 'string', maxLength: 500, pattern: '^(https://|/)', description: '點擊後開啟的網址' },
        source: { type: 'string', enum: ['custom', 'weekly_publish', 'article'], default: 'custom', description: '推播來源' },
      },
    },
  },
}, async (request) => {
  const { title, body, url, source = 'custom' } = request.body;
  const result = await sendPushNotification({ title, body, url });

  // 寫入 audit log（使用 insertAuditLog helper，同 books.ts / articles.ts 寫法）
  await insertAuditLog({
    user_email: (request as any).user?.email || null,
    action: 'send_push',
    table_name: 'push_subscriptions',
    record_id: null,
    old_data: null,
    new_data: null,
    metadata: { title, body, url, sent: result.sent, failed: result.failed, source },
  });

  return result;
});
```

Note: `insertAuditLog` accepts `metadata: Record<string, unknown> | null` — same pattern used in `books.ts` and `articles.ts`.

- [ ] **Step 2: Verify build**

```bash
cd worker && npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/api-v1.ts
git commit -m "feat: add audit logging and source param to push/send"
```

---

### Task 4: Add GET /push/logs endpoint

**Files:**
- Modify: `worker/src/routes/api-v1.ts` — add new endpoint after /push/send

- [ ] **Step 1: Add the /push/logs endpoint**

In `worker/src/routes/api-v1.ts`, add after the `/push/send` handler:

```typescript
// GET /push/logs - 查詢推播歷史
fastify.get<{
  Querystring: { limit?: string; offset?: string; source?: string };
}>('/push/logs', {
  preHandler: [requireAuth],
  schema: {
    tags: ['推播'],
    summary: '查詢推播歷史',
    description: '從 audit_logs 查詢推播紀錄',
    querystring: {
      type: 'object',
      properties: {
        limit: { type: 'string' },
        offset: { type: 'string' },
        source: { type: 'string', enum: ['custom', 'weekly_publish', 'article'] },
      },
    },
  },
}, async (request) => {
  const { limit: limitStr, offset: offsetStr, source } = request.query;
  const { limit, offset } = parsePagination(limitStr, offsetStr);

  const supabase = getSupabase();

  // Count query
  let countQuery = supabase
    .from('audit_logs')
    .select('*', { count: 'exact', head: true })
    .eq('action', 'send_push');

  if (source) {
    countQuery = countQuery.eq('metadata->>source', source);
  }

  const { count } = await countQuery;

  // Data query
  let dataQuery = supabase
    .from('audit_logs')
    .select('id, user_email, metadata, created_at')
    .eq('action', 'send_push')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (source) {
    dataQuery = dataQuery.eq('metadata->>source', source);
  }

  const { data, error } = await dataQuery;

  if (error) throw error;

  return paginate(data || [], count || 0, limit, offset);
});
```

- [ ] **Step 2: Verify build**

```bash
cd worker && npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/api-v1.ts
git commit -m "feat: add GET /push/logs endpoint for push history"
```

---

## Chunk 2: Dashboard Types & Service

### Task 5: Update Dashboard types

**Files:**
- Modify: `dashboard/src/types/database.ts:38` — add `'send_push'` to AuditLog action union

- [ ] **Step 1: Add send_push to dashboard AuditLog type**

In `dashboard/src/types/database.ts` line 38, add missing batch actions + `send_push` to the action field:

```typescript
  action: 'login' | 'logout' | 'insert' | 'update' | 'delete' | 'import' | 'ai_transform' | 'create_book' | 'upload_pdf' | 'batch_generate_descriptions' | 'batch_generate_thumbnails' | 'send_push';
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/types/database.ts
git commit -m "feat: add send_push to dashboard AuditLog type"
```

---

### Task 6: Update ACTION_CONFIG in page-logs.ts

**Files:**
- Modify: `dashboard/src/pages/page-logs.ts:16-26` — add send_push entry

- [ ] **Step 1: Add send_push to ACTION_CONFIG**

In `dashboard/src/pages/page-logs.ts`, add to the ACTION_CONFIG object (after `logout` entry):

```typescript
  batch_generate_descriptions: { variant: 'info', label: '批次描述' },
  batch_generate_thumbnails: { variant: 'info', label: '批次縮圖' },
  send_push: { variant: 'info', label: '推播' },
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/page-logs.ts
git commit -m "feat: add send_push to audit logs ACTION_CONFIG"
```

---

### Task 7: Update dashboard worker service

**Files:**
- Modify: `dashboard/src/services/worker.ts:120-158` — add source to interface, add fetchPushLogs

- [ ] **Step 1: Add source to PushNotificationRequest**

In `dashboard/src/services/worker.ts`, update the interface (around line 120):

```typescript
export interface PushNotificationRequest {
  title: string;
  body: string;
  url?: string;
  source?: 'custom' | 'weekly_publish' | 'article';
}
```

- [ ] **Step 2: Update sendPushNotification for 429 handling**

In `dashboard/src/services/worker.ts`, update the error handling in `sendPushNotification` (around line 148):

```typescript
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('推播頻率超過限制，請稍後再試');
    }
    const error = await response.json().catch(() => ({
      message: `Request failed with status ${response.status}`,
    }));
    throw new Error(error.message);
  }
```

- [ ] **Step 3: Add fetchPushLogs function**

In `dashboard/src/services/worker.ts`, add after `sendPushNotification`:

```typescript
export interface PushLogEntry {
  id: number;
  user_email: string | null;
  metadata: {
    title: string;
    body: string;
    url?: string;
    sent: number;
    failed: number;
    source: string;
  };
  created_at: string;
}

export interface PushLogsResponse {
  data: PushLogEntry[];
  total: number;
  page: number;
  page_count: number;
  limit: number;
  offset: number;
}

export async function fetchPushLogs(
  limit = 20,
  offset = 0,
  source?: string
): Promise<PushLogsResponse> {
  const headers: Record<string, string> = {};
  const token = authStore.session?.access_token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (source) {
    params.set('source', source);
  }

  const response = await fetch(`/api/v1/push/logs?${params}`, { headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: `Request failed with status ${response.status}`,
    }));
    throw new Error(error.message);
  }

  return response.json();
}
```

- [ ] **Step 4: Verify build**

```bash
cd dashboard && npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/services/worker.ts
git commit -m "feat: add push logs service and source param"
```

---

### Task 8: Update existing push callers with source

**Files:**
- Modify: `dashboard/src/pages/page-weekly-detail.ts:732,699` — add source to sendPushNotification calls
- Modify: `dashboard/src/pages/page-weekly-list.ts:486` — add source to sendPushNotification call

- [ ] **Step 1: Update page-weekly-detail.ts handlePublishConfirm**

In `dashboard/src/pages/page-weekly-detail.ts`, in `handlePublishConfirm()` (around line 732), update the sendPushNotification call:

```typescript
        const result = await sendPushNotification({
          title: this.pushTitle,
          body: this.pushBody,
          url: `/weekly/${this.weekNumber}`,
          source: 'weekly_publish',
        });
```

- [ ] **Step 2: Update page-weekly-detail.ts handleArticlePushConfirm**

In `dashboard/src/pages/page-weekly-detail.ts`, in `handleArticlePushConfirm()` (around line 699), update:

```typescript
    const result = await sendPushNotification({
      title: this.articlePushTitle,
      body: this.articlePushBody,
      url: `/article/${this.pushingArticle.id}`,
      source: 'article',
    });
```

- [ ] **Step 3: Update page-weekly-list.ts**

In `dashboard/src/pages/page-weekly-list.ts`, in the publish flow (around line 486), update:

```typescript
    const result = await sendPushNotification({
      title: this.pushTitle,
      body: this.pushBody,
      url: `/weekly/${weekNumber}`,
      source: 'weekly_publish',
    });
```

- [ ] **Step 4: Verify build**

```bash
cd dashboard && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/page-weekly-detail.ts dashboard/src/pages/page-weekly-list.ts
git commit -m "feat: add source param to existing push notification calls"
```

---

## Chunk 3: Dashboard Page & Navigation

### Task 9: Add bell icon to tc-nav-item

**Files:**
- Modify: `dashboard/src/components/layout/tc-nav-item.ts:74-84` — add bell icon SVG path

- [ ] **Step 1: Add bell icon to icons map**

In `dashboard/src/components/layout/tc-nav-item.ts`, add to the `icons` Record (around line 77):

```typescript
    bell: `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>`,
```

This is the standard Lucide bell icon path.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/layout/tc-nav-item.ts
git commit -m "feat: add bell icon to nav item component"
```

---

### Task 10: Add sidebar nav item and route

**Files:**
- Modify: `dashboard/src/components/layout/tc-sidebar.ts:170-175` — add push nav item
- Modify: `dashboard/src/app.ts:9-18,108` — add import and route

- [ ] **Step 1: Add nav item to sidebar**

In `dashboard/src/components/layout/tc-sidebar.ts`, add between the book-open and scroll-text items (line 173):

```html
  <tc-nav-item icon="bell" label="推播管理" href="/push"></tc-nav-item>
```

Result:
```html
<nav class="nav">
  <tc-nav-item icon="newspaper" label="週報列表" href="/"></tc-nav-item>
  <tc-nav-item icon="book-open" label="電子書" href="/books"></tc-nav-item>
  <tc-nav-item icon="bell" label="推播管理" href="/push"></tc-nav-item>
  <tc-nav-item icon="scroll-text" label="審計日誌" href="/logs"></tc-nav-item>
  <tc-nav-item icon="file-text" label="API 文檔" href="/api/v1/docs/" .external=${true}></tc-nav-item>
</nav>
```

- [ ] **Step 2: Add page import to app.ts**

In `dashboard/src/app.ts`, add import (after line 15, the page-books-list import):

```typescript
import './pages/page-push.js';
```

- [ ] **Step 3: Add route to app.ts**

In `dashboard/src/app.ts`, add route after the `/books` route (around line 108):

```typescript
      {
        path: '/push',
        component: 'page-push',
        action: () => this.authGuard(),
      },
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/layout/tc-sidebar.ts dashboard/src/app.ts
git commit -m "feat: add push management route and sidebar nav"
```

---

### Task 11: Create page-push.ts

**Files:**
- Create: `dashboard/src/pages/page-push.ts`

This is the main implementation task. The page has two sections: send form (top) and history table (bottom).

- [ ] **Step 1: Create the page component**

Create `dashboard/src/pages/page-push.ts`:

```typescript
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { toastStore } from '../stores/toast-store.js';
import {
  sendPushNotification,
  fetchPushLogs,
  type PushLogEntry,
} from '../services/worker.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/index.js';

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  custom: { label: '自訂', color: 'var(--color-info)' },
  weekly_publish: { label: '週報', color: 'var(--color-success)' },
  article: { label: '文稿', color: '#9333ea' },
};

const PAGE_SIZE = 20;

@customElement('page-push')
export class PagePush extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: var(--spacing-6);
      max-width: 960px;
      margin: 0 auto;
    }

    h1 {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-6) 0;
    }

    h2 {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-4) 0;
    }

    /* Send Form */
    .send-section {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-6);
      margin-bottom: var(--spacing-8);
    }

    .form-group {
      margin-bottom: var(--spacing-4);
    }

    .form-group label {
      display: block;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-1);
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      font-family: inherit;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-group .hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--spacing-1);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-4);
    }

    /* History Section */
    .history-section {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-6);
    }

    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-4);
    }

    .history-header h2 {
      margin: 0;
    }

    .filter-select {
      padding: var(--spacing-1) var(--spacing-3);
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    /* Table */
    .table-container {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-sm);
    }

    th {
      text-align: left;
      padding: var(--spacing-2) var(--spacing-3);
      color: var(--color-text-muted);
      font-weight: var(--font-weight-medium);
      border-bottom: 1px solid var(--color-border);
      white-space: nowrap;
    }

    td {
      padding: var(--spacing-2) var(--spacing-3);
      color: var(--color-text-primary);
      border-bottom: 1px solid var(--color-border-subtle);
      vertical-align: top;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .source-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-bg-card);
    }

    .cell-truncate {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cell-url a {
      color: var(--color-primary);
      text-decoration: none;
    }

    .cell-url a:hover {
      text-decoration: underline;
    }

    .cell-number {
      text-align: center;
    }

    .cell-email {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Pagination */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-4);
    }

    .pagination button {
      padding: var(--spacing-1) var(--spacing-3);
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .pagination button:hover:not(:disabled) {
      background: var(--color-bg-hover);
    }

    .pagination button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .pagination .page-info {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }

    .empty-state {
      text-align: center;
      padding: var(--spacing-8);
      color: var(--color-text-muted);
    }

    .loading {
      text-align: center;
      padding: var(--spacing-8);
      color: var(--color-text-muted);
    }
  `;

  // Form state
  @state() private pushTitle = '';
  @state() private pushBody = '';
  @state() private pushUrl = '';
  @state() private sending = false;
  @state() private showConfirmDialog = false;

  // History state
  @state() private logs: PushLogEntry[] = [];
  @state() private totalLogs = 0;
  @state() private currentPage = 1;
  @state() private pageCount = 1;
  @state() private sourceFilter = '';
  @state() private loadingLogs = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.loadLogs();
  }

  private async loadLogs(): Promise<void> {
    this.loadingLogs = true;
    try {
      const offset = (this.currentPage - 1) * PAGE_SIZE;
      const result = await fetchPushLogs(
        PAGE_SIZE,
        offset,
        this.sourceFilter || undefined
      );
      this.logs = result.data;
      this.totalLogs = result.total;
      this.pageCount = result.page_count;
    } catch (error) {
      console.error('Failed to load push logs:', error);
      toastStore.error('載入推播歷史失敗');
    } finally {
      this.loadingLogs = false;
    }
  }

  private get isFormValid(): boolean {
    if (!this.pushTitle.trim() || !this.pushBody.trim()) return false;
    if (this.pushUrl.trim() && !this.pushUrl.match(/^(https:\/\/|\/)/)) return false;
    return true;
  }

  private handleSendClick(): void {
    if (!this.isFormValid) return;
    this.showConfirmDialog = true;
  }

  private async handleConfirmSend(): Promise<void> {
    this.showConfirmDialog = false;
    this.sending = true;
    try {
      const result = await sendPushNotification({
        title: this.pushTitle.trim(),
        body: this.pushBody.trim(),
        url: this.pushUrl.trim() || undefined,
        source: 'custom',
      });
      toastStore.success(`推播已發送：成功 ${result.sent} 筆、失敗 ${result.failed} 筆`);
      // Reset form
      this.pushTitle = '';
      this.pushBody = '';
      this.pushUrl = '';
      // Refresh history
      this.currentPage = 1;
      await this.loadLogs();
    } catch (error) {
      console.error('Push send error:', error);
      toastStore.error(error instanceof Error ? error.message : '推播發送失敗');
    } finally {
      this.sending = false;
    }
  }

  private handleFilterChange(e: Event): void {
    this.sourceFilter = (e.target as HTMLSelectElement).value;
    this.currentPage = 1;
    this.loadLogs();
  }

  private handlePageChange(page: number): void {
    this.currentPage = page;
    this.loadLogs();
  }

  private formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  render() {
    return html`
      <tc-app-shell pageTitle="推播管理">
        ${this.renderSendForm()}
        ${this.renderHistory()}

        <tc-dialog
          ?open=${this.showConfirmDialog}
          dialogTitle="確認發送"
          @tc-close=${() => (this.showConfirmDialog = false)}
        >
          <p>確定要發送推播嗎？</p>
          <p><strong>${this.pushTitle}</strong></p>
          <p>${this.pushBody}</p>
          ${this.pushUrl ? html`<p>連結：${this.pushUrl}</p>` : nothing}
          <div slot="footer">
            <tc-button variant="secondary" @click=${() => (this.showConfirmDialog = false)}>取消</tc-button>
            <tc-button variant="primary" @click=${this.handleConfirmSend}>發送</tc-button>
          </div>
        </tc-dialog>
      </tc-app-shell>
    `;
  }

  private renderSendForm() {
    return html`
      <div class="send-section">
        <h2>發送推播</h2>
        <div class="form-group">
          <label>標題</label>
          <input
            type="text"
            maxlength="100"
            placeholder="推播標題"
            .value=${this.pushTitle}
            @input=${(e: Event) => (this.pushTitle = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-group">
          <label>內文</label>
          <textarea
            maxlength="500"
            rows="3"
            placeholder="推播內文"
            .value=${this.pushBody}
            @input=${(e: Event) => (this.pushBody = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
        <div class="form-group">
          <label>連結（選填）</label>
          <input
            type="text"
            maxlength="500"
            placeholder="https:// 或 / 開頭"
            .value=${this.pushUrl}
            @input=${(e: Event) => (this.pushUrl = (e.target as HTMLInputElement).value)}
          />
          <div class="hint">支援外部連結（https://）或內部路徑（/weekly/123）</div>
        </div>
        <div class="form-actions">
          <tc-button
            variant="primary"
            ?disabled=${!this.isFormValid || this.sending}
            ?loading=${this.sending}
            @click=${this.handleSendClick}
          >發送推播</tc-button>
        </div>
      </div>
    `;
  }

  private renderHistory() {
    return html`
      <div class="history-section">
        <div class="history-header">
          <h2>推播歷史</h2>
          <select class="filter-select" @change=${this.handleFilterChange}>
            <option value="">全部</option>
            <option value="custom">自訂</option>
            <option value="weekly_publish">週報發佈</option>
            <option value="article">文稿推播</option>
          </select>
        </div>

        ${this.loadingLogs
          ? html`<div class="loading">載入中...</div>`
          : this.logs.length === 0
            ? html`<div class="empty-state">尚無推播紀錄</div>`
            : html`
                <div class="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>時間</th>
                        <th>來源</th>
                        <th>標題</th>
                        <th>內文</th>
                        <th>連結</th>
                        <th>成功</th>
                        <th>失敗</th>
                        <th>操作者</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${this.logs.map(
                        (log) => html`
                          <tr>
                            <td style="white-space:nowrap">${this.formatDate(log.created_at)}</td>
                            <td>${this.renderSourceBadge(log.metadata?.source)}</td>
                            <td class="cell-truncate">${log.metadata?.title || '-'}</td>
                            <td class="cell-truncate">${this.truncate(log.metadata?.body || '-', 50)}</td>
                            <td class="cell-url">
                              ${log.metadata?.url
                                ? html`<a href="${log.metadata.url}" target="_blank" rel="noopener">連結</a>`
                                : '-'}
                            </td>
                            <td class="cell-number">${log.metadata?.sent ?? '-'}</td>
                            <td class="cell-number">${log.metadata?.failed ?? '-'}</td>
                            <td class="cell-email">${log.user_email?.split('@')[0] || '-'}</td>
                          </tr>
                        `
                      )}
                    </tbody>
                  </table>
                </div>

                ${this.pageCount > 1 ? this.renderPagination() : nothing}
              `}
      </div>
    `;
  }

  private renderSourceBadge(source?: string) {
    const config = SOURCE_CONFIG[source || ''] || { label: source || '未知', color: 'var(--color-text-muted)' };
    return html`
      <span class="source-badge" style="background:${config.color}">${config.label}</span>
    `;
  }

  private renderPagination() {
    return html`
      <div class="pagination">
        <button
          ?disabled=${this.currentPage <= 1}
          @click=${() => this.handlePageChange(this.currentPage - 1)}
        >&lt;</button>
        <span class="page-info">${this.currentPage} / ${this.pageCount}</span>
        <button
          ?disabled=${this.currentPage >= this.pageCount}
          @click=${() => this.handlePageChange(this.currentPage + 1)}
        >&gt;</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-push': PagePush;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd dashboard && npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/page-push.ts
git commit -m "feat: add push notification management page"
```

---

## Chunk 4: Build, Deploy & Verify

### Task 12: Final build verification and deploy

- [ ] **Step 1: Build worker**

```bash
cd worker && npm run build
```

Expected: No errors.

- [ ] **Step 2: Build dashboard**

```bash
cd dashboard && npm run build
```

Expected: No errors.

- [ ] **Step 3: Docker deploy**

```bash
cd supabase-docker && docker compose up -d --build worker dashboard
```

- [ ] **Step 4: Run migration on local DB**

Open Supabase Studio at `http://localhost:8000/studio` and run:

```sql
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'upload_pdf',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push'
  )
);
```

- [ ] **Step 5: Manual verification**

1. Open `http://localhost:8000/` — verify sidebar has "推播管理" with bell icon
2. Click "推播管理" — verify `/push` page loads with form + empty history
3. Fill in title, body, optional URL → send → verify confirm dialog → verify toast with results
4. Verify history table shows the push just sent with source "自訂"
5. Test source filter dropdown
6. Test pagination (if enough records)
7. Verify API docs at `/api/v1/docs/` show new endpoints
8. Test publishing a weekly → verify push log appears with source "週報"

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address verification issues"
```
