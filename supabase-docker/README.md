# Supabase Self-Hosted (Kong Gateway)

自架 Supabase 後端，使用 Kong 作為單一入口，支援整合任意前端應用。

## 快速部署

```bash
# 1. Clone
git clone https://github.com/KaelLim/supabase-docker.git
cd supabase-docker

# 2. 設定環境變數
cp .env.example .env
nano .env
# 必改項目：
#   - POSTGRES_PASSWORD
#   - JWT_SECRET（使用 openssl rand -base64 32 生成）
#   - ANON_KEY / SERVICE_ROLE_KEY（見下方說明）
#   - DASHBOARD_USERNAME / DASHBOARD_PASSWORD

# 3. 啟動（僅 Supabase）
docker compose up -d
```

## 存取服務

| 服務 | URL | 說明 |
|------|-----|------|
| Studio | http://localhost:8000/studio | 管理介面（需 basic-auth） |
| REST API | http://localhost:8000/rest/v1/ | PostgREST |
| Auth | http://localhost:8000/auth/v1/ | GoTrue 認證 |
| Storage | http://localhost:8000/storage/v1/ | 檔案儲存 |
| Realtime | http://localhost:8000/realtime/v1/ | WebSocket |
| Edge Functions | http://localhost:8000/functions/v1/ | Deno Functions |

## 生成 JWT Keys

```bash
# 生成 JWT_SECRET
openssl rand -base64 32

# ANON_KEY 和 SERVICE_ROLE_KEY：
# 使用 https://supabase.com/docs/guides/self-hosting#api-keys
# 輸入上面生成的 JWT_SECRET
```

## 架構

```
Kong API Gateway (:8000) — 單一入口
├── /studio/*        → Supabase Studio (basic-auth)
├── /rest/v1/*       → PostgREST
├── /auth/v1/*       → GoTrue (Auth)
├── /storage/v1/*    → Storage
├── /realtime/v1/*   → Realtime (WebSocket)
├── /functions/v1/*  → Edge Functions (Deno)
└── /*               → 預設: Studio / 或你的 App
```

## 整合你的應用程式

### 方法 1: 加入 docker-compose（推薦）

1. 在 `docker-compose.yml` 新增你的 app：
```yaml
my-app:
  container_name: my-app
  image: your-app-image
  profiles: [app]
  restart: unless-stopped
  # ...
```

2. 修改 `volumes/api/kong.yml`：啟用 `[B]` 區塊，設定根路徑指向你的 app

3. 啟動：`docker compose --profile app up -d`

### 方法 2: 外部應用連接

前端直接連接 `http://your-server:8000`：
```javascript
import { createClient } from '@supabase/supabase-js'
const supabase = createClient('http://your-server:8000', 'your-anon-key')
```

## 目錄結構

```
supabase-docker/
├── docker-compose.yml           # 主配置
├── docker-compose.override.yml  # Storage named volume
├── .env.example                 # 環境變數範本
└── volumes/
    ├── api/kong.yml             # Kong 路由配置
    ├── db/*.sql                 # 資料庫初始化
    ├── functions/main/          # Edge Functions 入口
    ├── logs/vector.yml          # Log 配置
    └── pooler/pooler.exs        # Connection pooler
```

## 常用指令

```bash
# 啟動（僅 Supabase）
docker compose up -d

# 啟動（含 App）
docker compose --profile app up -d

# 查看日誌
docker compose logs -f

# 重啟 Edge Functions
docker compose restart functions

# 停止
docker compose down

# 重置（危險！清除所有資料）
docker compose down -v
```

## Edge Functions

位於 `volumes/functions/`：

```
functions/
└── main/index.ts    # 路由入口
```

新增函數：
1. 建立 `volumes/functions/my-function/index.ts`
2. 在 `main/index.ts` 加入 import 和路由
3. `docker compose restart functions`

## 自訂 Studio Image

本 repo 使用 `ghcr.io/kaellim/supabase-root:latest`，支援 `/studio` 子路徑部署。

如需自建：
```bash
git clone https://github.com/supabase/supabase.git
cd supabase
docker build . \
  -f apps/studio/Dockerfile \
  --target production \
  --build-arg NEXT_PUBLIC_BASE_PATH=/studio \
  -t your-registry/supabase-studio:latest
```

## License

MIT
