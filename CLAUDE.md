# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Weekly Import Worker** (週報匯入工作流程) - a TypeScript CLI tool that automates importing Tzu Chi Weekly publications (慈濟週報) from Google Docs exports into a Supabase database. It uses Claude AI for intelligent document parsing and content rewriting.

## Commands

All commands run from the `worker/` directory:

```bash
# Install dependencies
npm install

# Run import (main workflow)
npm run import <md_file_path> [week_number] [user_email]
npm run import ./downloads/週報.md 117 editor@example.com

# Development with watch mode
npm run dev

# Build TypeScript
npm run build

# Run compiled version
npm start
```

### Test Scripts

```bash
# Test image extraction from Google Docs markdown
npx tsx src/test-images.ts

# Test Claude AI parsing
npx tsx src/test-ai-parse.ts
```

## Architecture

### Import Pipeline

The worker executes a 9-step sequential pipeline (`worker/src/worker.ts`):

1. **starting** - Initialize Supabase and Anthropic clients
2. **exporting_docs** - Load markdown file from disk
3. **converting_images** - Extract base64 images, upload to Supabase Storage, replace with URLs
4. **uploading_original** - Store original markdown to bucket
5. **ai_parsing** - Claude parses markdown into structured JSON (categories + articles)
6. **uploading_clean** - Store reformatted markdown to bucket
7. **importing_docs** - Insert parsed articles to database (platform='docs')
8. **ai_rewriting** - Claude rewrites each article for digital distribution
9. **importing_digital** - Insert rewritten articles to database (platform='digital')

### Core Services

| Service | Purpose |
|---------|---------|
| `services/supabase.ts` | Database CRUD, file storage, audit logging |
| `services/ai-parser.ts` | Claude-powered markdown→JSON parsing using `.claude/skills/parse-weekly-md.md` |
| `services/ai-rewriter.ts` | Claude-powered content optimization using `.claude/skills/rewrite-for-digital.md` |
| `services/image-processor.ts` | Base64 image extraction and bucket upload |
| `services/google-docs.ts` | File I/O and weekly ID extraction |

### Claude Skills

AI prompts are stored in `.claude/skills/`:
- `parse-weekly.md` - Instructions for parsing 8-category weekly structure
- `rewrite-for-digital.md` - GEO/AIO/SEO optimization while preserving Tzu Chi style

### Database Schema

See `database.md` for full schema. Key tables:
- **weekly** - Publication issues (week_number as PK, status: draft/published/archived)
- **articles** - Unified table with `platform` field ('docs' for original, 'digital' for AI-rewritten)
- **category** - 8 fixed categories with sort_order
- **audit_logs** - Complete operation trail

### Storage Structure

```
bucket: weekly
articles/{weekly_id}/
  images/image1.jpg
  original.md
  clean.md
```

## Environment Setup

Copy `worker/.env.example` to `worker/.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
ANTHROPIC_API_KEY=your-api-key  # Optional if using Claude Max account
```

## Key Patterns

- **ESM modules** - All imports use `.js` extension (TypeScript compiles to ESM)
- **Service-based architecture** - Each external dependency has dedicated service module
- **Audit logging** - All database operations are logged with metadata
- **Platform field** - Articles exist as 'docs' (original) and 'digital' (AI-rewritten) pairs
