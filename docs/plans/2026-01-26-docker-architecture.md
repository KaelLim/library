# Docker 架構規劃

## 概述

將 weekly-import-worker 打包為 Docker 容器，整合至 [supabase-docker](https://github.com/KaelLim/supabase-docker)，透過 Kong API Gateway 統一路由。

## 系統架構

```
                         Kong API Gateway (:8000)
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
   /*  (Dashboard)         /worker/*              /studio/*
        │                    (Worker)              (Supabase Studio)
        │                         │
        │                         ▼
        │              ┌─────────────────┐
        │              │  Worker 容器    │
        │              │ Express/Fastify │
        │              └────────┬────────┘
        │                       │
        ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                        Supabase                             │
│  /rest/v1/*    /auth/v1/*    /storage/v1/*    /realtime/*  │
│  ┌─────────┐  ┌─────────┐  ┌───────────┐  ┌──────────┐     │
│  │ weekly  │  │articles │  │audit_logs │  │  bucket  │     │
│  └─────────┘  └─────────┘  └───────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Kong 路由配置

整合至 `supabase-docker` 後的完整路由：

| 路徑 | 目標服務 |
|------|----------|
| `/studio/*` | Supabase Studio |
| `/rest/v1/*` | PostgREST |
| `/auth/v1/*` | GoTrue |
| `/storage/v1/*` | Storage |
| `/realtime/v1/*` | Realtime |
| `/functions/v1/*` | Edge Functions |
| `/worker/*` | **Worker (新增)** |
| `/*` | **Dashboard (新增)** |

## 部署整合

### docker-compose.yml 新增服務

```yaml
# Worker service
worker:
  build: ../library/worker
  environment:
    - SUPABASE_URL=http://kong:8000
    - SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY}
  networks:
    - supabase
  restart: unless-stopped

# Dashboard service
dashboard:
  build: ../library/dashboard
  networks:
    - supabase
  restart: unless-stopped
```

### kong.yml 新增路由

```yaml
# Worker API
- name: worker
  url: http://worker:3000
  routes:
    - name: worker-route
      paths:
        - /worker
      strip_path: false

# Dashboard (預設路由，放最後)
- name: dashboard
  url: http://dashboard:3000
  routes:
    - name: dashboard-route
      paths:
        - /
      strip_path: false
```

## 元件說明

### Worker Container

- **框架**: Fastify
- **Runtime**: Node.js 20
- **Base Image**: `node:20-slim`
- **內部 Port**: 3000
- **職責**: 執行週報匯入 pipeline（AI 處理耗時，不適合 Edge Function）

**必要元件**:
- Node.js 20
- Claude Code CLI（Agent SDK 依賴）
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

**Dockerfile**:
```dockerfile
FROM node:20-slim

# 安裝 curl（用於 Claude Code 安裝）
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# 安裝 Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# 設定 PATH
ENV PATH="/root/.claude/bin:$PATH"

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**環境變數**:
```
SUPABASE_URL=http://kong:8000
SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY}
```

**部署後登入 Claude**:
```bash
# 進入 container
docker exec -it worker bash

# 登入 Claude（手動執行一次）
claude login
```

> 注意：容器內部透過 Docker network 連接 Kong，使用內部 URL

**API Endpoint**:
```
POST /worker
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

- **內部 Port**: 3000
- **職責**:
  - 提供 Google Doc ID/URL 輸入介面
  - 觸發 worker 執行匯入（`POST /worker`，同 origin 無 CORS 問題）
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
- [ ] 是否需要認證機制保護 Worker API（可透過 Kong 或應用層實作）
