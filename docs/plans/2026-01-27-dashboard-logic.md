# Dashboard 後台邏輯

## 概述

Dashboard 後台負責週報管理系統的業務邏輯，與 Supabase 和 Worker 互動。

## 認證流程

### Google OAuth

```
User → Dashboard → Supabase Auth (Google OAuth) → allowed_users 驗證
```

1. 使用者點擊「Google 登入」
2. 導向 Supabase Auth Google OAuth
3. 回調後檢查 `allowed_users` 表
4. email 存在且 `is_active = true` → 登入成功
5. 否則 → 拒絕存取

### Session 管理

- 使用 Supabase Auth Session
- JWT token 存於 cookie 或 localStorage
- 每次 API 請求帶上 token

## 週報管理 API

### 列表查詢

```
GET /rest/v1/weekly?select=*&order=week_number.desc
```

回傳：
```json
[
  {
    "week_number": 117,
    "status": "draft",
    "publish_date": null,
    "created_at": "2026-01-27T10:00:00Z"
  }
]
```

### 新增週報（觸發匯入）

```
POST /worker/import
{
  "doc_url": "https://docs.google.com/document/d/xxx/edit",
  "weekly_id": 118,
  "user_email": "editor@example.com"
}
```

流程：
1. Dashboard 解析 Google Doc URL，提取 doc_id
2. 呼叫 Worker API 觸發匯入
3. Worker 回傳 202 Accepted
4. Dashboard 訂閱 `audit_logs` 追蹤進度

### 狀態變更

```
PATCH /rest/v1/weekly?week_number=eq.117
{
  "status": "published",
  "publish_date": "2026-01-27"
}
```

狀態流程：`draft` → `published` → `archived`

### 刪除週報

```
DELETE /rest/v1/weekly?week_number=eq.117
```

注意：會 cascade 刪除相關 articles

## 文稿管理 API

### 查詢文稿

```
GET /rest/v1/articles?weekly_id=eq.117&select=*,category(name)&order=category_id,order_number
```

### 篩選平台版本

```
GET /rest/v1/articles?weekly_id=eq.117&platform=eq.docs
GET /rest/v1/articles?weekly_id=eq.117&platform=eq.digital
```

### 編輯文稿

```
PATCH /rest/v1/articles?id=eq.123
{
  "title": "修改後的標題",
  "content": "修改後的內容..."
}
```

### 重新 AI 改寫（單篇）

```
POST /worker/rewrite
{
  "article_id": 123,
  "user_email": "editor@example.com"
}
```

Worker 會：
1. 讀取 docs 版文稿
2. 呼叫 Claude AI 改寫
3. 更新對應的 digital 版文稿
4. 寫入 audit_log

## 匯入狀態追蹤

### Supabase Realtime 訂閱

```typescript
const subscription = supabase
  .channel('import-progress')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'audit_logs',
      filter: `metadata->>weekly_id=eq.${weeklyId}`
    },
    (payload) => {
      // 更新 UI 進度
      updateProgress(payload.new);
    }
  )
  .subscribe();
```

### 進度狀態對應

| audit_log.metadata.step | 顯示文字 |
|-------------------------|----------|
| `started` | 開始匯入 |
| `downloading` | 下載中 |
| `processing_images` | 處理圖片 |
| `ai_parsing` | AI 解析中 |
| `importing_docs` | 匯入原稿 |
| `ai_rewriting` | AI 改寫中 |
| `importing_digital` | 匯入數位版 |
| `completed` | 完成 |
| `failed` | 失敗 |

## 審計日誌查詢

```
GET /rest/v1/audit_logs?order=created_at.desc&limit=50
```

篩選條件：
- 按時間範圍
- 按使用者 `user_email`
- 按操作類型 `action`
- 按週報 `metadata->>weekly_id`

## 錯誤處理

### API 錯誤回應

```json
{
  "error": "WEEKLY_NOT_FOUND",
  "message": "週報 #999 不存在"
}
```

### 常見錯誤碼

| 錯誤碼 | 說明 |
|--------|------|
| `AUTH_FAILED` | 認證失敗 |
| `USER_NOT_ALLOWED` | 使用者不在白名單 |
| `WEEKLY_NOT_FOUND` | 週報不存在 |
| `WEEKLY_EXISTS` | 週報已存在 |
| `IMPORT_IN_PROGRESS` | 匯入進行中 |
| `WORKER_UNAVAILABLE` | Worker 服務不可用 |

## 權限控制

目前為單一角色（白名單內使用者皆有完整權限），未來可擴充：

| 角色 | 權限 |
|------|------|
| viewer | 檢視週報、文稿 |
| editor | 編輯文稿、觸發匯入 |
| admin | 管理使用者、刪除週報 |
