# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

慈濟週報管理系統 - 自動化將 Google Docs 週報匯入 Supabase 資料庫，使用 Claude AI 進行內容解析與改寫，並整合 FlipHTML5 電子書平台。

## Architecture

```
library/
├── worker/              # Fastify API (TypeScript)
├── dashboard/           # Lit Web Components + Vite
├── supabase-docker/     # 自架 Supabase + Kong Gateway
└── .claude/skills/      # AI prompts (parse-weekly, rewrite-for-digital)
```

### Kong API Gateway (:8000)

```
/studio/*     → Supabase Studio (Basic Auth)
/rest/v1/*    → PostgREST
/auth/v1/*    → GoTrue
/storage/v1/* → Storage
/realtime/v1/*→ Realtime (WebSocket)
/worker/*     → Worker API
/*            → Dashboard
```

## Commands

```bash
# Worker
cd worker && npm run dev          # Development (:3001)
cd worker && npm run build        # Build TypeScript

# Dashboard
cd dashboard && npm run dev       # Development (:8973)
cd dashboard && npm run build     # Production build

# Supabase
cd supabase-docker && docker compose up -d     # Start all
cd supabase-docker && docker compose logs -f   # View logs
```

## Core Services (worker/src/services/)

| Service | Purpose |
|---------|---------|
| `supabase.ts` | Database CRUD, file storage, audit logging |
| `ai-parser.ts` | Claude: markdown → JSON parsing |
| `ai-rewriter.ts` | Claude: 原稿 → 數位版 + description 生成 |
| `session-streamer.ts` | Claude 即時串流，廣播到 Supabase Realtime |
| `tts.ts` | TTS 語音生成 (Qwen3-TTS Clone API, SSE 串流) |
| `image-matcher.ts` | Claude Vision 比對低/高解析度圖片並替換 |
| `image-compressor.ts` | 圖片壓縮 (sharp) |
| `fliphtml5.ts` | FlipHTML5 電子書 API (upload, create, update) |
| `pdf-compressor.ts` | PDF 壓縮 (Ghostscript) |
| `google-docs.ts` | Google Docs export |
| `image-processor.ts` | Base64 圖片提取上傳 |

## Database Schema

See `database.md` for full schema.

**週報系統**
- `weekly` - 週報期數 (week_number PK, status: draft/published/archived)
- `articles` - 文稿 (platform: 'docs'/'digital', description 供 SEO)
- `category` - 8 個固定分類（AI 解析時必須使用既有 category_id 1-8，不可建立新分類）

**電子書系統**
- `books` - 電子書 (book_id 對應 FlipHTML5, turn_page: left/right)
- `books_category` - 分類 (folder_id 對應 FlipHTML5 資料夾)

## Environment Variables

```bash
# worker/.env (本地開發用；Docker 環境由 docker-compose.yml 傳入)
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_KEY=your-service-role-key
FLIPHTML5_ACCESS_KEY_ID=your-key      # 電子書功能
FLIPHTML5_ACCESS_KEY_SECRET=your-secret
TTS_API_URL=https://tcm1.tzuchi-org.tw  # TTS/ASR API

# dashboard/.env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=your-anon-key

# supabase-docker/.env (Docker 環境)
SUPABASE_PUBLIC_URL=http://localhost:8000  # 正式: https://librarypj.tzuchi-org.tw
```

## Key Patterns

- **ESM modules** - All imports use `.js` extension
- **Platform field** - Articles: 'docs' (原稿) / 'digital' (AI改寫版)
- **Fixed categories** - category_id 1-8 固定不變，AI 解析只能從中選擇，不可新增
- **turn_page** - Books: 'left' (中文右翻左) / 'right' (英文左翻右)
- **Audit logging** - All DB operations logged to `audit_logs`
- **Storage** - 使用 Docker named volume（macOS xattr 相容），需用 `docker cp` 備份

## Claude Agent SDK

**必須使用 Claude Agent SDK，不要使用 Anthropic SDK！**

```typescript
// ✅ 正確 - 使用 Claude Agent SDK（不需要 API key）
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const msg of query({
  prompt: 'Your prompt',
  options: { model: 'opus' },  // alias 自動跟著現行 Opus；不寫死版本
})) {
  if (msg.type === 'result' && (msg as any).subtype === 'success') {
    console.log((msg as any).result);
  }
}

// ❌ 錯誤 - 不要使用 @anthropic-ai/sdk（需要 API key）
```

### Token-Level Streaming

```typescript
for await (const msg of query({
  prompt,
  options: {
    model: 'opus',
    maxTurns: 1,
    includePartialMessages: true,  // 啟用 token-level streaming
  },
})) {
  if (msg.type === 'stream_event') {
    const event = (msg as any).event;
    if (event?.type === 'content_block_delta') {
      const text = event.delta?.text;
      if (text) process.stdout.write(text);
    }
  }
}
```

## Supabase Realtime

Worker 和 Dashboard 透過 Broadcast 溝通：

```typescript
// 訂閱
supabase.channel(`import:${weeklyId}`)
  .on('broadcast', { event: 'progress' }, callback)
  .on('broadcast', { event: 'session_output' }, callback)
  .subscribe();

// 廣播
channel.send({ type: 'broadcast', event: 'progress', payload: data });
```

## Import Pipeline

1. `exporting_docs` - Google Docs → markdown
2. `converting_images` - base64 → bucket URL
2.5. `replacing_images` - Claude Vision 比對替換高解析度圖片（需提供 Drive 資料夾）
3. `uploading_original` - 原始 markdown 上傳
4. `ai_parsing` - Claude 解析 → JSON（透過 session-streamer 即時串流）
5. `uploading_clean` - 整理後 markdown 上傳
6. `importing_docs` - 匯入原稿 (platform='docs')
7. `ai_rewriting` - Claude 改寫 + 生成 description（透過 session-streamer 即時串流）
8. `importing_digital` - 匯入數位版 (platform='digital')
9. `generating_audio` - TTS 語音生成 + 上傳 MP3 到 Storage

## FlipHTML5 Integration

```typescript
import { createFlipBookFromPdf, updateFlipBookConfig, turnPageToRightToLeft } from './services/fliphtml5.js';

// 上傳 PDF 並建立電子書
const result = await createFlipBookFromPdf(pdfBuffer, 'book.pdf', 'Book Title', {
  folderId: 7742461,
  config: { RightToLeft: 'Yes' },  // 中文右翻左
});

// 更新翻頁設定
await updateFlipBookConfig(bookId, {
  RightToLeft: turnPageToRightToLeft('left'),  // 'Yes'
});
```

## API URL 處理

- **`SUPABASE_URL`** (`http://kong:8000`) — Docker 內部用，Worker 存取 Supabase 服務
- **`SUPABASE_PUBLIC_URL`** — 對外公開 URL（本地 `http://localhost:8000`，正式 `https://librarypj.tzuchi-org.tw`）
- API 回傳的 URL（mp3_url、pdf_path、thumbnail_url、reader_url）必須用 `SUPABASE_PUBLIC_URL`，不可用內部 `SUPABASE_URL`
- 資料庫存相對路徑，API 層用 `toPublicUrl()` 組裝完整 URL
- **`/worker/*` 路由需要 `apikey` header**（Kong key-auth），使用 `fetchWorker()` 會自動帶；直接 `fetch()` 需手動加 `apikey` + `Authorization`

## Production Deployment Notes

### Kong Port Binding
- Kong ports 必須綁定 `0.0.0.0`（不可用 `127.0.0.1`），因為正式環境有外部 nginx 反向代理轉發流量到 Kong:8000
- `127.0.0.1` 綁定會導致外部 502 錯誤

### 正式環境部署步驟
```bash
# 在正式伺服器上
cd supabase-docker
git pull
docker compose up -d --build worker dashboard  # 重建有更新的容器
docker compose up -d                            # 重啟其他服務
```

### Dashboard Push Notification 路由
- Dashboard 的 `sendPushNotification` 使用 `/api/v1/push/send`（公開路由，不走 `/worker/*` 的 key-auth）
- Worker 的 `requireAuth` middleware 驗證 Supabase access token
- **注意**：正式環境 worker 容器需要重新 build 才有此端點

## Dashboard Pages

- `/login` - Google OAuth
- `/` - 週報列表
- `/weekly/:id` - 週報詳情（編輯文稿、試聽語音）
- `/weekly/:id/import` - 匯入進度
- `/books` - 電子書管理
- `/push` - 推播管理（自訂推播 + 歷史紀錄）
- `/logs` - 系統日誌
- `/test-drive` - 測試頁
