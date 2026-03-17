# Push Notification Management Page — Design Spec

## Overview

新增 Dashboard 推播管理頁面 (`/push`)，提供自訂推播發送功能與統一的推播歷史紀錄。所有推播（自訂、週報發佈、文稿推播）統一寫入 `audit_logs`，在此頁面集中查看。

## Scope

- **新增：** Dashboard 推播管理頁面
- **新增：** Worker `GET /api/v1/push/logs` 查詢端點
- **修改：** Worker `POST /api/v1/push/send` 增加 audit log 寫入
- **修改：** Dashboard 現有週報/文稿推播呼叫帶上 `source` 參數
- **修改：** `audit_logs` action check constraint 新增 `'send_push'`（同時補齊已存在但漏列的 `'batch_generate_descriptions'`, `'batch_generate_thumbnails'`）
- **不影響：** tzuchi-weekly（只用 subscribe/unsubscribe，不受影響）

---

## 1. Data Layer

### 1.1 audit_logs Schema Change

```sql
-- 補齊所有 action 類型（含已存在但遺漏的 + 新增 send_push）
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'login', 'logout', 'insert', 'update', 'delete', 'import',
    'ai_transform', 'create_book', 'upload_pdf',
    'batch_generate_descriptions', 'batch_generate_thumbnails',
    'send_push'
  )
);
```

Init SQL (`data.sql`) 同步更新 constraint，包含所有 action 類型。

### 1.2 Push Log Record Format

每次推播寫入 `audit_logs`：

| Field | Value |
|-------|-------|
| `action` | `'send_push'` |
| `user_email` | 操作者 email |
| `table_name` | `'push_subscriptions'` |
| `record_id` | `null` |
| `metadata` | `{ title, body, url, sent, failed, source }` |

`source` 值：
- `'custom'` — 自訂推播（推播管理頁面發送）
- `'weekly_publish'` — 發佈週報時附帶推播
- `'article'` — 數位文稿推播

### 1.3 Worker API Changes

#### `POST /api/v1/push/send` — 修改

Request body 新增可選欄位：
```typescript
{
  title: string;      // 必填, 1-100 chars
  body: string;       // 必填, 1-500 chars
  url?: string;       // 選填, max 500 chars, pattern: ^(https://|/)
  source?: string;    // 選填, 預設 'custom', enum: 'custom' | 'weekly_publish' | 'article'
}
```

Fastify JSON Schema 加入 URL pattern 驗證：
```json
{
  "url": { "type": "string", "maxLength": 500, "pattern": "^(https://|/)" }
}
```

發送完成後寫入 audit_log：
```typescript
await insertAuditLog({
  user_email: request.user.email,
  action: 'send_push',
  table_name: 'push_subscriptions',
  metadata: { title, body, url, sent: result.sent, failed: result.failed, source }
});
```

**Rate limit 429 處理：** Dashboard 收到 429 時顯示 toast「推播頻率超過限制，請稍後再試」。

#### `GET /api/v1/push/logs` — 新增

- **認證：** `requireAuth`
- **Query params：** `limit` (default 20), `offset` (default 0), `source` (optional filter)
- **Response：** 使用現有 `paginate()` helper，回傳格式同其他端點：
```typescript
{
  data: Array<{
    id: number;
    user_email: string;
    metadata: { title: string; body: string; url?: string; sent: number; failed: number; source: string };
    created_at: string;
  }>;
  total: number;
  page: number;
  page_count: number;
  limit: number;
  offset: number;
}
```

- 查詢 `audit_logs WHERE action = 'send_push'`，依 `created_at DESC` 排序
- 若帶 `source` 參數，加 `metadata->>'source' = ?` 條件

### 1.4 Worker Type Changes

`worker/src/types/index.ts` — `AuditLog.action` union type 新增 `'send_push'`。

---

## 2. Dashboard Page

### 2.1 Routing

- **路徑：** `/push`
- **元件：** `page-push` (`dashboard/src/pages/page-push.ts`)
- **認證：** 需登入（同其他頁面）

### 2.2 Sidebar Navigation

在 `tc-sidebar.ts` 新增 nav item：
```html
<tc-nav-item icon="bell" label="推播管理" href="/push"></tc-nav-item>
```
位置：「電子書」和「審計日誌」之間。

### 2.3 Page Layout

頁面分上下兩區：

#### 上區：發送表單

```
┌─────────────────────────────────────────┐
│  推播管理                                │
│                                          │
│  標題 ┌──────────────────────────────┐  │
│       │                              │  │
│       └──────────────────────────────┘  │
│  內文 ┌──────────────────────────────┐  │
│       │                              │  │
│       │                              │  │
│       └──────────────────────────────┘  │
│  連結 ┌──────────────────────────────┐  │
│  (選填)│ https://                     │  │
│       └──────────────────────────────┘  │
│                                          │
│                        [發送推播]        │
└─────────────────────────────────────────┘
```

- 標題：`<input>`, required, maxlength 100
- 內文：`<textarea>`, required, maxlength 500, 3 行高
- 連結：`<input>`, optional, 驗證 `https://` 開頭或 `/` 開頭（內部路徑）
- 發送按鈕：點擊後彈出 `tc-dialog` 確認（「確定要發送推播嗎？」）
- 發送成功：toast 顯示「推播已發送：成功 N 筆、失敗 N 筆」
- 發送失敗（429）：toast 顯示「推播頻率超過限制，請稍後再試」
- 發送成功後自動清空表單、刷新歷史紀錄

#### 下區：推播歷史

```
┌─────────────────────────────────────────────────────────────────┐
│  推播歷史                          來源篩選 [全部 ▾]            │
│                                                                  │
│  時間          來源      標題        內文摘要    sent  failed 操作者│
│  ──────────────────────────────────────────────────────────────  │
│  03/17 14:30  [自訂]    春季活動    歡迎參加...  45    2    user@│
│  03/16 10:00  [週報]    第52期      最新一期...  43    1    user@│
│  03/15 09:00  [文稿]    環保新知    認識環保...  44    0    user@│
│  ──────────────────────────────────────────────────────────────  │
│                               < 1 2 3 >                         │
└─────────────────────────────────────────────────────────────────┘
```

- 表格欄位：時間、來源（badge）、標題、內文摘要（截斷 50 字）、連結（icon link）、sent/failed、操作者
- 來源 badge 顏色：自訂 blue、週報 green、文稿 purple
- 來源篩選：dropdown（全部 / 自訂 / 週報發佈 / 文稿推播）
- 分頁：每頁 20 筆，使用 `limit`/`offset` 分頁（同 audit logs 頁面風格）

### 2.4 Dashboard Service

`dashboard/src/services/worker.ts` 變更：

```typescript
// 修改現有 sendPushNotification 加上 source 參數
export interface PushNotificationRequest {
  title: string;
  body: string;
  url?: string;
  source?: 'custom' | 'weekly_publish' | 'article';
}

// 新增查詢推播歷史（直接呼叫 /api/v1/push/logs，同 sendPushNotification 路徑風格）
export interface PushLogEntry {
  id: number;
  user_email: string;
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

export async function fetchPushLogs(
  limit?: number,
  offset?: number,
  source?: string
): Promise<PaginatedResponse<PushLogEntry>>
```

`fetchPushLogs` 使用 `/api/v1/push/logs` 路徑（同 `sendPushNotification`，不走 `/worker/*`）。

### 2.5 Existing Push Callers Update

- `page-weekly-detail.ts` — `handlePublishConfirm()` 呼叫 `sendPushNotification` 時加 `source: 'weekly_publish'`
- `page-weekly-detail.ts` — `handleArticlePushConfirm()` 呼叫時加 `source: 'article'`
- `page-weekly-list.ts` — publish flow 呼叫 `sendPushNotification` 時加 `source: 'weekly_publish'`

### 2.6 Dashboard Type Changes

- `dashboard/src/types/database.ts` — `AuditAction` type 新增 `'send_push'`
- `dashboard/src/pages/page-logs.ts` — `ACTION_CONFIG` 新增 `send_push` 設定（label: '推播', icon, color）

---

## 3. Migration Strategy

### 新環境（init SQL）
- `data.sql` 中 `audit_logs_action_check` 直接包含所有 action 類型（含 `'send_push'`, `'batch_generate_descriptions'`, `'batch_generate_thumbnails'`）

### 正式環境（migration）
- `supabase-docker/volumes/db/migrations/002_add_send_push_action.sql`
- ALTER constraint 語句（補齊所有遺漏 + 新增 `send_push`）

---

## 4. Files Changed

| File | Change |
|------|--------|
| `supabase-docker/volumes/db/init/data.sql` | action constraint 補齊所有類型 |
| `supabase-docker/volumes/db/migrations/002_add_send_push_action.sql` | 新增 migration |
| `worker/src/routes/api-v1.ts` | `/push/send` 加 audit log + source + URL pattern；新增 `/push/logs` |
| `worker/src/types/index.ts` | `AuditLog.action` 加 `'send_push'` |
| `dashboard/src/pages/page-push.ts` | 新增推播管理頁面 |
| `dashboard/src/services/worker.ts` | 加 `source` 參數、新增 `fetchPushLogs()` |
| `dashboard/src/types/database.ts` | `AuditAction` 加 `'send_push'` |
| `dashboard/src/pages/page-logs.ts` | `ACTION_CONFIG` 加 `send_push` |
| `dashboard/src/components/layout/tc-sidebar.ts` | 新增 nav item |
| `dashboard/src/app.ts` | 新增 `/push` 路由 |
| `dashboard/src/pages/page-weekly-detail.ts` | 推播呼叫加 `source` |
| `dashboard/src/pages/page-weekly-list.ts` | 推播呼叫加 `source` |
