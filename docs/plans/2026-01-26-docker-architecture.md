# Docker 架構規劃

## 概述

將 weekly-import-worker 打包為 Docker 容器，搭配 Dashboard 前端，形成完整的週報匯入系統。

## 系統架構

```
┌─────────────┐      POST /import       ┌─────────────────┐
│  Dashboard  │ ───────────────────────→│  Worker (容器)   │
│  (Frontend) │                         │  Express/Fastify │
└─────────────┘                         └────────┬────────┘
       ↑                                         │
       │ 讀取進度                                  │ fetch md
       │                                         ↓
┌──────┴──────────────────────────────────────────────────┐
│                      Supabase                           │
│  ┌─────────┐  ┌─────────┐  ┌───────────┐  ┌──────────┐ │
│  │ weekly  │  │articles │  │audit_logs │  │  bucket  │ │
│  └─────────┘  └─────────┘  └───────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 元件說明

### Worker Container

- **框架**: Express 或 Fastify
- **Runtime**: Node.js
- **職責**: 執行週報匯入 pipeline（AI 處理耗時，不適合 Edge Function）

**環境變數**:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

> 注意：不需要 ANTHROPIC_API_KEY（使用 Claude Max 帳號）

**API Endpoint**:
```
POST /import
{
  "doc_id": "1EJi4AabcbPV2EqhxiTiv3KCLmlfD3R0cR1U3eOQHYzs",
  "weekly_id": 117,
  "user_email": "editor@example.com"
}

Response: 202 Accepted
{
  "message": "Import started",
  "weekly_id": 117
}
```

### Google Docs 整合

直接透過 export URL 下載 markdown，不需要本機檔案：

```
https://docs.google.com/document/d/{DOC_ID}/export?format=md
```

Worker 流程：
1. 收到 `doc_id`
2. 組成 export URL 並 fetch markdown
3. 上傳至 Supabase bucket (`original.md`)
4. 執行後續 pipeline（圖片處理、AI 解析、AI 改寫）

### Dashboard

- **職責**:
  - 提供 Google Doc ID/URL 輸入介面
  - 觸發 worker 執行匯入
  - 顯示匯入進度（讀取 `audit_logs`）
  - 管理 weekly 狀態（draft → published）
  - 預覽/編輯文稿

- **進度追蹤方式**:
  - Polling `audit_logs` 表
  - 或使用 Supabase Realtime 訂閱

## Import Pipeline

```
Google Doc URL/ID
       ↓
Worker fetch export?format=md
       ↓
上傳 Supabase bucket (original.md)
       ↓
提取 base64 圖片 → 上傳 bucket → 替換為 URL
       ↓
Claude AI 解析 → 結構化 JSON
       ↓
上傳 clean.md
       ↓
匯入 articles (platform='docs')
       ↓
Claude AI 改寫每篇文章
       ↓
匯入 articles (platform='digital')
       ↓
完成，寫入 audit_log
```

## 為何不用 Supabase Edge Function

- Edge Function 有執行時間限制（Free: 60s, Pro: 150s）
- AI 改寫每篇文章都需要等待回應
- 文章數量多時容易超時
- 獨立容器沒有時間限制，更適合長時間任務

## 待決定事項

- [ ] Dashboard 技術選型（Next.js / Nuxt / SvelteKit / 其他）
- [ ] Worker 框架選型（Express / Fastify）
- [ ] 部署平台（Railway / Fly.io / Cloud Run / 其他）
- [ ] 是否需要認證機制保護 Worker API
