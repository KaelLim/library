# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

慈濟週報匯入系統 - 自動化將 Google Docs 週報匯入 Supabase 資料庫，使用 Claude AI 進行內容解析與改寫。

本專案整合了：
- **Worker** - Fastify API 服務，執行匯入 pipeline
- **Dashboard** - 前端管理介面（Lit Web Components + Vite）
- **Supabase** - 自架資料庫與儲存服務

## Project Structure

```
library/
├── .claude/skills/           # Claude AI prompts
│   ├── parse-weekly.md       # 解析週報 markdown → JSON
│   └── rewrite-for-digital.md # 改寫為數位版（GEO/AIO/SEO）
├── docs/plans/               # 架構規劃文件
├── worker/                   # 週報匯入 Worker（TypeScript）
├── dashboard/                # 前端管理介面（Lit + Vite）
│   ├── src/
│   │   ├── components/       # UI 元件
│   │   ├── pages/            # 頁面元件
│   │   ├── services/         # API 服務
│   │   └── stores/           # 狀態管理
│   └── server/               # Fastify 靜態伺服器
└── supabase-docker/          # 自架 Supabase（從 GitHub clone）
    ├── docker-compose.yml
    └── volumes/
        └── api/kong.yml      # Kong 路由配置
```

## Docker Architecture

```
Kong API Gateway (:8000)
├── /studio/*        → Supabase Studio
├── /rest/v1/*       → PostgREST
├── /auth/v1/*       → GoTrue
├── /storage/v1/*    → Storage
├── /realtime/v1/*   → Realtime
├── /functions/v1/*  → Edge Functions
├── /worker/*        → Worker (library-worker container)
└── /*               → MasterSlides / Dashboard
```

### Worker Container

**Base image**: `node:20-slim` (Debian-based，支援 Claude Code CLI 安裝)

**必要元件**:
- Node.js 20
- Claude Code CLI（SDK 依賴）
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

**Dockerfile** (已建立於 `worker/Dockerfile`):
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

EXPOSE 3001
CMD ["node", "dist/server.js"]
```

**部署後登入 Claude**:
```bash
# 進入 container
docker exec -it library-worker bash

# 登入 Claude（手動執行一次）
claude login
```

## Commands

### Worker Development

```bash
cd worker

# Install dependencies
npm install

# Run import (CLI mode)
npm run import <md_file_path> [week_number] [user_email]

# Development with watch mode
npm run dev

# Build TypeScript
npm run build
```

### Dashboard Development

```bash
cd dashboard

# Install dependencies
npm install

# Development server (port 8973)
npm run dev

# Build for production
npm run build

# Run production server
npm run serve
```

### Supabase Docker

```bash
cd supabase-docker

# Setup environment
cp .env.example .env
# Edit .env with your secrets

# Start all services
docker compose up -d

# Stop services (preserves data)
docker compose down

# View logs
docker compose logs -f
```

## Import Pipeline

Worker 執行 9 步驟 pipeline：

1. **starting** - 初始化 Supabase client
2. **exporting_docs** - 從 Google Docs 下載 markdown (`export?format=md`)
3. **converting_images** - 提取 base64 圖片，上傳到 bucket，替換為 URL
4. **uploading_original** - 上傳原始 markdown 到 bucket
5. **ai_parsing** - Claude 解析 markdown 為結構化 JSON
6. **uploading_clean** - 上傳整理後的 markdown
7. **importing_docs** - 匯入原稿到資料庫 (platform='docs')
8. **ai_rewriting** - Claude 改寫每篇文章為數位版
9. **importing_digital** - 匯入數位版到資料庫 (platform='digital')

## Core Services

| Service | Purpose |
|---------|---------|
| `worker/src/services/supabase.ts` | Database CRUD, file storage, audit logging |
| `worker/src/services/session-streamer.ts` | Claude AI 即時串流，廣播到 Supabase Realtime |
| `worker/src/services/ai-parser.ts` | Claude markdown→JSON parsing |
| `worker/src/services/ai-rewriter.ts` | Claude content optimization |
| `worker/src/services/image-processor.ts` | Base64 image extraction and upload |
| `worker/src/services/google-docs.ts` | Google Docs export integration |

## Database Schema

See `database.md` for full schema. Key tables:
- **weekly** - 週報期數 (week_number as PK, status: draft/published/archived)
- **articles** - 文稿 (platform: 'docs' 原稿 / 'digital' AI改寫版)
- **category** - 8 個固定分類
- **audit_logs** - 操作紀錄

## Environment Setup

### Worker

```bash
# worker/.env
SUPABASE_URL=http://localhost:8000  # 或 http://kong:8000 (Docker 內部)
SUPABASE_SERVICE_KEY=your-service-role-key
```

### Supabase Docker

```bash
# supabase-docker/.env
POSTGRES_PASSWORD=your-db-password
JWT_SECRET=your-jwt-secret
ANON_KEY=your-anon-key
SERVICE_ROLE_KEY=your-service-role-key
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=admin-password
```

## Dashboard

Dashboard 是週報管理系統的前端介面，使用 Lit Web Components 開發。

### 技術棧
- **Lit 3** - Web Components 框架
- **@vaadin/router** - SPA 路由
- **@supabase/supabase-js** - Supabase client
- **Vite** - 開發與建置工具
- **Fastify** - 生產環境靜態伺服器

### 頁面結構
- `/login` - Google OAuth 登入
- `/` - 週報列表（首頁）
- `/weekly/:id` - 週報詳情（編輯文稿）
- `/weekly/:id/import` - 匯入進度追蹤

### 元件架構
- `src/components/ui/` - 基礎 UI 元件（button, input, badge, dialog, toast, tabs, spinner）
- `src/components/layout/` - 版面元件（app-shell, sidebar, card）
- `src/components/weekly/` - 週報相關元件
- `src/components/article/` - 文稿相關元件
- `src/components/progress/` - 進度追蹤元件

### 環境變數
```bash
# dashboard/.env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=your-anon-key
# VITE_WORKER_URL 不需要設定，開發時透過 Vite proxy，生產時透過 Kong
```

## Planned Work

- [x] Worker: 改為 Fastify HTTP API
- [x] Worker: 建立 Dockerfile（見上方規格）
- [x] Worker: 整合到 supabase-docker/docker-compose.yml
- [x] Kong: 新增 `/worker/*` 路由
- [x] Dashboard: 前端管理介面（Lit Web Components）
- [ ] Backup: PostgreSQL 和 Storage 備份策略

## Key Patterns

- **ESM modules** - All imports use `.js` extension
- **Service-based architecture** - Each external dependency has dedicated service module
- **Audit logging** - All database operations are logged with metadata
- **Platform field** - Articles exist as 'docs' (original) and 'digital' (AI-rewritten) pairs

## ⚠️ 重要：Claude SDK 使用規範

**必須使用 Claude Agent SDK，不要使用 Anthropic SDK！**

```typescript
// ✅ 正確 - 使用 Claude Agent SDK（不需要 API key，使用 Claude Code 認證）
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Your prompt here',
  options: { model: 'claude-sonnet-4-20250514' },
});

for await (const msg of q) {
  if (msg.type === 'result' && msg.subtype === 'success') {
    console.log(msg.result);
  }
}

// ❌ 錯誤 - 不要使用 Anthropic SDK（需要 API key）
// import Anthropic from '@anthropic-ai/sdk';  // 不要用這個！
// const anthropic = new Anthropic();           // 不要用這個！
```

**套件依賴**:
- ✅ `@anthropic-ai/claude-agent-sdk` - 使用 Claude Code 認證，不需 API key
- ❌ `@anthropic-ai/sdk` - 需要 `ANTHROPIC_API_KEY`，本專案不使用

## AI 即時串流模式

使用 `query()` + `includePartialMessages: true` 取得 **token-level streaming**。

### 訊息類型

SDK 的 `query()` 會 yield 不同類型的訊息：

| Type | 說明 |
|------|------|
| `system` | 初始化訊息 (subtype: 'init') |
| `assistant` | 完整的 AI 回應（message-level） |
| `stream_event` | Token-level 串流事件（需啟用 `includePartialMessages`） |
| `result` | 最終結果 (subtype: 'success' 或 'error_*') |

### Token-Level Streaming 範例

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// 使用 AsyncGenerator 發送 prompt
async function* generateMessages() {
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: 'Your prompt here',
    },
  };
}

let accumulatedText = '';

for await (const msg of query({
  prompt: generateMessages(),
  options: {
    model: 'claude-sonnet-4-20250514',
    maxTurns: 1,
    includePartialMessages: true,  // 關鍵！啟用 token-level streaming
  },
})) {
  // 處理 stream_event（token-level 串流）
  if (msg.type === 'stream_event') {
    const event = (msg as any).event;

    // content_block_delta 包含實際的 text delta
    if (event?.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta?.text) {
        accumulatedText += delta.text;

        // 可以在這裡即時廣播/顯示
        if (accumulatedText.length >= 100) {
          console.log('Chunk:', accumulatedText);
          accumulatedText = '';
        }
      }
    }
  }

  // 處理最終結果
  if (msg.type === 'result') {
    if ((msg as any).subtype === 'success') {
      console.log('Result:', (msg as any).result);
    }
  }
}
```

### Session Streaming 服務

`worker/src/services/session-streamer.ts` 封裝了完整的串流邏輯：

```typescript
import { runSessionWithStreaming } from './services/session-streamer.js';

const result = await runSessionWithStreaming(prompt, {
  weeklyId: 1,                    // 用於 Supabase channel 名稱
  model: 'claude-sonnet-4-20250514',
  chunkSize: 100,                 // 每 100 字元廣播一次
});
```

功能：
- 自動訂閱 Supabase Realtime channel (`import:{weeklyId}`)
- Token-level 串流，累積後廣播到前端
- 發送 `session_output` 事件，包含 `system`/`assistant` 訊息
- 自動清理 channel

## Supabase Realtime 廣播

Worker 和 Dashboard 透過 Supabase Realtime Broadcast 溝通：

### Channel 命名
- `import:{weeklyId}` - 匯入進度 channel

### 事件類型
- `progress` - 匯入步驟進度更新
- `session_output` - AI 串流輸出

### 前端訂閱範例
```typescript
// dashboard/src/services/realtime.ts
const channel = supabase
  .channel(`import:${weeklyId}`)
  .on('broadcast', { event: 'progress' }, (payload) => {
    // 處理進度更新
  })
  .on('broadcast', { event: 'session_output' }, (payload) => {
    // 處理 AI 串流輸出
    const { data } = payload.payload;
    if (data.type === 'assistant') {
      console.log('AI:', data.message.content);
    }
  })
  .subscribe();
```

**注意**：Broadcast 不需要 RLS policies，因為它是直接的 pub/sub 機制，不經過資料庫。

## Related Documents

- `database.md` - 資料庫 schema
- `docs/plans/2026-01-26-docker-architecture.md` - Docker 架構規劃
