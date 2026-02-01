# CLAUDE.md - Supabase Docker

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory.

## Project Overview

自架 Supabase 服務，整合慈濟週報管理系統（週報匯入 + 書籍管理）。

本目錄包含：
- **docker-compose.yml** - 完整的 Supabase 服務 + 週報系統容器
- **volumes/** - 配置文件與資料持久化
- **Kong 路由** - API Gateway 統一入口

## 架構概覽

```
Kong API Gateway (:8000)
├── /studio/*        → Supabase Studio (Basic Auth 保護)
├── /rest/v1/*       → PostgREST (API Key 驗證)
├── /auth/v1/*       → GoTrue (認證服務)
├── /storage/v1/*    → Storage (檔案儲存)
├── /realtime/v1/*   → Realtime (WebSocket)
├── /functions/v1/*  → Edge Functions
├── /analytics/v1/*  → Logflare
├── /pg/*            → pg-meta (admin only)
├── /worker/*        → Worker API (週報匯入 + 書籍管理)
└── /*               → Dashboard (前端介面)
```

## 服務清單

| Container | Image | Port | 說明 |
|-----------|-------|------|------|
| supabase-kong | kong:2.8.1 | 8000 | API Gateway |
| supabase-db | supabase/postgres:15.8.1 | 5432 | PostgreSQL |
| supabase-auth | supabase/gotrue:v2.184.0 | 9999 | 認證服務 |
| supabase-rest | postgrest/postgrest:v14.1 | 3000 | REST API |
| supabase-realtime | supabase/realtime:v2.68.0 | 4000 | WebSocket |
| supabase-storage | supabase/storage-api:v1.33.0 | 5000 | 檔案儲存 |
| supabase-studio | ghcr.io/kaellim/supabase-root | 3000 | 管理介面 |
| supabase-pooler | supabase/supavisor:2.7.4 | 6543 | Connection Pooler |
| weekly-dashboard | (build) | 8973 | 週報管理前端 |
| weekly-worker | (build) | 3001 | 週報匯入 API |

## 常用指令

```bash
# 啟動所有服務
docker compose up -d

# 查看日誌
docker compose logs -f

# 查看特定服務
docker compose logs -f worker dashboard

# 停止服務（保留資料）
docker compose down

# 完全重置（刪除所有資料）
docker compose down -v --remove-orphans

# 重建特定服務
docker compose up -d --build worker
docker compose up -d --build dashboard
```

## 環境設定

複製 `.env.example` 為 `.env` 並設定以下變數：

```bash
# 資料庫
POSTGRES_PASSWORD=your-db-password

# JWT (用於 API 認證)
JWT_SECRET=your-jwt-secret
ANON_KEY=your-anon-key
SERVICE_ROLE_KEY=your-service-role-key

# Studio 登入
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=admin-password

# FlipHTML5 電子書 API
FLIPHTML5_ACCESS_KEY_ID=your-access-key
FLIPHTML5_ACCESS_KEY_SECRET=your-secret-key

# 外部 URL（生產環境）
SUPABASE_PUBLIC_URL=https://your-domain.com
```

## 目錄結構

```
supabase-docker/
├── docker-compose.yml      # 主要配置
├── .env                    # 環境變數（不入版控）
├── .env.example            # 環境變數範本
│
└── volumes/
    ├── api/
    │   └── kong.yml        # Kong 路由配置
    ├── db/
    │   ├── data/           # PostgreSQL 資料（不入版控）
    │   ├── init/           # 初始化 SQL
    │   │   ├── data.sql    # 週報系統 schema
    │   │   └── 002_books.sql  # 書籍系統 schema
    │   └── *.sql           # Supabase 系統 SQL
    ├── storage/            # 檔案儲存
    ├── functions/          # Edge Functions
    ├── logs/
    │   └── vector.yml      # 日誌收集配置
    └── pooler/
        └── pooler.exs      # Connection pooler 配置
```

## Kong 路由說明

Kong 是 API Gateway，根據路徑轉發請求：

### 認證路由
- `/auth/v1/verify`, `/auth/v1/callback`, `/auth/v1/authorize` - 公開路由
- `/auth/v1/*` - 需要 API Key

### API 路由
- `/rest/v1/*` → PostgREST - 需要 API Key (anon 或 service_role)
- `/storage/v1/*` → Storage - 自行管理認證
- `/realtime/v1/*` → Realtime - WebSocket，需要 API Key

### 管理路由
- `/studio/*` → Supabase Studio - Basic Auth 保護
- `/pg/*` → pg-meta - 僅 admin 可存取

### 週報系統路由
- `/worker/*` → Worker API - CORS enabled
- `/*` → Dashboard - 根路徑 catch-all

## 資料庫初始化

`volumes/db/init/` 目錄下的 SQL 會在資料庫首次啟動時執行：

1. `data.sql` - 週報系統 schema (weekly, articles, category, audit_logs)
2. `002_books.sql` - 書籍系統 schema (books, books_category)

如需重新初始化：
```bash
# 刪除資料後重啟
rm -rf volumes/db/data
docker compose up -d
```

## Worker 整合

Worker 容器透過 Kong 的 `/worker/*` 路由對外提供 API：

```
外部請求: GET http://localhost:8000/worker/health
         ↓
Kong:    strip_path: true → http://worker:3001/health
         ↓
Worker:  回應 { status: 'ok' }
```

Worker 使用環境變數連接 Supabase：
- `SUPABASE_URL=http://kong:8000` (Docker 內部)
- `SUPABASE_SERVICE_KEY` (service_role 權限)

## Dashboard 整合

Dashboard 容器作為根路徑 catch-all：

```
外部請求: GET http://localhost:8000/
         ↓
Kong:    strip_path: false → http://dashboard:8973/
         ↓
Dashboard: 回應 SPA 內容
```

Dashboard 透過 Kong proxy 存取其他服務：
- `/rest/v1/*` → PostgREST
- `/auth/v1/*` → GoTrue
- `/worker/*` → Worker API

## 開發 vs 生產

### 開發環境
```bash
# Mac OS 直接運行 Dashboard + Worker
cd dashboard && npm run dev  # :8973
cd worker && npm run dev     # :3000

# Docker 只運行 Supabase
cd supabase-docker && docker compose up db kong auth rest storage realtime
```

### 生產環境
```bash
# 全部使用 Docker
cd supabase-docker && docker compose up -d
```

## 故障排除

### 服務無法連接
```bash
# 檢查服務狀態
docker compose ps

# 檢查網路
docker network ls
docker network inspect weekly_default
```

### 資料庫問題
```bash
# 連接資料庫
docker exec -it supabase-db psql -U postgres

# 檢查 realtime 設定
SELECT * FROM _realtime.tenants;
```

### Kong 路由問題
```bash
# 查看 Kong 日誌
docker compose logs kong

# 檢查路由配置
docker exec supabase-kong kong config parse /home/kong/kong.yml
```

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Jan 29, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #4 | 4:57 PM | 🔵 | Supabase Docker Local Development Configuration | ~723 |
</claude-mem-context>
