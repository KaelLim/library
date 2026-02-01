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
cd worker && npm run dev          # Development (:3000)
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
| `fliphtml5.ts` | FlipHTML5 電子書 API (upload, create, update) |
| `pdf-compressor.ts` | PDF 壓縮 (Ghostscript) |
| `google-docs.ts` | Google Docs export |
| `image-processor.ts` | Base64 圖片提取上傳 |

## Database Schema

See `database.md` for full schema.

**週報系統**
- `weekly` - 週報期數 (week_number PK, status: draft/published/archived)
- `articles` - 文稿 (platform: 'docs'/'digital', description 供 SEO)
- `category` - 8 個固定分類

**電子書系統**
- `books` - 電子書 (book_id 對應 FlipHTML5, turn_page: left/right)
- `books_category` - 分類 (folder_id 對應 FlipHTML5 資料夾)

## Environment Variables

```bash
# worker/.env
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_KEY=your-service-role-key
FLIPHTML5_ACCESS_KEY_ID=your-key      # 電子書功能
FLIPHTML5_ACCESS_KEY_SECRET=your-secret

# dashboard/.env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Key Patterns

- **ESM modules** - All imports use `.js` extension
- **Platform field** - Articles: 'docs' (原稿) / 'digital' (AI改寫版)
- **turn_page** - Books: 'left' (中文右翻左) / 'right' (英文左翻右)
- **Audit logging** - All DB operations logged to `audit_logs`

## Claude Agent SDK

**必須使用 Claude Agent SDK，不要使用 Anthropic SDK！**

```typescript
// ✅ 正確 - 使用 Claude Agent SDK（不需要 API key）
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const msg of query({
  prompt: 'Your prompt',
  options: { model: 'claude-sonnet-4-20250514' },
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
    model: 'claude-sonnet-4-20250514',
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
3. `uploading_original` - 原始 markdown 上傳
4. `ai_parsing` - Claude 解析 → JSON
5. `uploading_clean` - 整理後 markdown 上傳
6. `importing_docs` - 匯入原稿 (platform='docs')
7. `ai_rewriting` - Claude 改寫 + 生成 description
8. `importing_digital` - 匯入數位版 (platform='digital')

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

## Dashboard Pages

- `/login` - Google OAuth
- `/` - 週報列表
- `/weekly/:id` - 週報詳情（編輯文稿）
- `/weekly/:id/import` - 匯入進度
- `/books` - 電子書管理
