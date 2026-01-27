# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

慈濟週報匯入系統 - 自動化將 Google Docs 週報匯入 Supabase 資料庫，使用 Claude AI 進行內容解析與改寫。

本專案整合了：
- **Worker** - Fastify API 服務，執行匯入 pipeline
- **Dashboard** - 前端管理介面（規劃中）
- **Supabase** - 自架資料庫與儲存服務

## Project Structure

```
library/
├── .claude/skills/           # Claude AI prompts
│   ├── parse-weekly.md       # 解析週報 markdown → JSON
│   └── rewrite-for-digital.md # 改寫為數位版（GEO/AIO/SEO）
├── docs/plans/               # 架構規劃文件
├── worker/                   # 週報匯入 Worker（TypeScript）
├── dashboard/                # 前端管理介面（規劃中）
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
├── /worker/*        → Worker (待新增)
└── /*               → Dashboard (待新增)
```

### Worker Container

**Base image**: `node:20-slim` (Debian-based，支援 Claude Code CLI 安裝)

**必要元件**:
- Node.js 20
- Claude Code CLI（SDK 依賴）
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

**部署後登入 Claude**:
```bash
# 進入 container
docker exec -it worker bash

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

1. **starting** - 初始化 Supabase 和 Anthropic clients
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

## Planned Work

- [ ] Worker: 改為 Fastify HTTP API
- [ ] Worker: 建立 Dockerfile（見上方規格）
- [ ] Worker: 整合到 supabase-docker/docker-compose.yml
- [ ] Kong: 新增 `/worker/*` 路由
- [ ] Dashboard: 前端管理介面（不使用 Next.js）
- [ ] Backup: PostgreSQL 和 Storage 備份策略

## Key Patterns

- **ESM modules** - All imports use `.js` extension
- **Service-based architecture** - Each external dependency has dedicated service module
- **Audit logging** - All database operations are logged with metadata
- **Platform field** - Articles exist as 'docs' (original) and 'digital' (AI-rewritten) pairs

## Related Documents

- `database.md` - 資料庫 schema
- `docs/plans/2026-01-26-docker-architecture.md` - Docker 架構規劃
