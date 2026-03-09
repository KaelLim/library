# Library Cleanup & ISO Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up dead code and address remaining ISO 27001/27002 security findings from the follow-up audit.

**Architecture:** Worker (Fastify + TypeScript), Dashboard (Lit + Vite + nginx), Supabase Docker infrastructure. Changes span input validation, error handling, secrets management, and dead code removal.

**Tech Stack:** TypeScript, Fastify JSON Schema, Firebase Admin SDK, Docker Compose

---

## Task 1: Remove dead code — unused supabase functions

**Files:**
- Modify: `worker/src/services/supabase.ts:55-105`

**Step 1: Remove 4 unused exported functions**

Remove these functions that have zero callers in the codebase:

```typescript
// DELETE lines 55-77: getCategoryByName() and getOrCreateCategory()
// DELETE lines 94-105: getArticlesByWeekly()
```

Keep the comment headers (`// ===== Category 操作 =====` etc.) if adjacent functions remain.

**Step 2: Remove getBooksCategoryByName**

```typescript
// DELETE lines 294-302: getBooksCategoryByName()
```

**Step 3: Verify build**

Run: `cd worker && npm run build`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add worker/src/services/supabase.ts
git commit -m "chore: remove 4 unused exported functions from supabase service"
```

---

## Task 2: Clean up stale artifacts

**Files:**
- Delete: `worker/dist/services/fliphtml5.js`
- Delete: `worker/dist/services/fliphtml5.d.ts`
- Delete: `worker/src/utils/` (empty directory)
- Modify: `supabase-docker/.env:143-144` (remove unused FLIPHTML5 vars)

**Step 1: Remove stale dist files and empty dir**

```bash
rm worker/dist/services/fliphtml5.js worker/dist/services/fliphtml5.d.ts
rmdir worker/src/utils
```

**Step 2: Remove unused env vars**

In `supabase-docker/.env`, delete these lines:
```
FLIPHTML5_ACCESS_KEY_ID=WAPuXPUKclFO
FLIPHTML5_ACCESS_KEY_SECRET=THAEQIemsTYHbQgtHTwvfEly
```

**Step 3: Commit**

```bash
git add -A worker/dist/services/fliphtml5.* worker/src/utils supabase-docker/.env
git commit -m "chore: remove stale fliphtml5 artifacts and unused env vars"
```

---

## Task 3: Firebase initialization error handling (HIGH)

**Files:**
- Modify: `worker/src/services/push-notification.ts:8-28`

**Step 1: Add try-catch and field validation to initFirebase()**

Replace the current `initFirebase()` function:

```typescript
function initFirebase() {
  if (initialized) return;

  let serviceAccount: admin.ServiceAccount;

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        || resolve(process.cwd(), 'firebase-service-account.json');
      serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Firebase] Failed to load service account:', msg);
    throw new Error(`Firebase initialization failed: ${msg}`);
  }

  if (!serviceAccount.projectId && !(serviceAccount as any).project_id) {
    throw new Error('Firebase service account missing project_id');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
}
```

**Step 2: Verify build**

Run: `cd worker && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add worker/src/services/push-notification.ts
git commit -m "fix: add error handling and validation to Firebase initialization"
```

---

## Task 4: FCM token input validation (HIGH)

**Files:**
- Modify: `worker/src/routes/api-v1.ts:368-408`

**Step 1: Add token format validation to Fastify schema**

Update `/push/subscribe` and `/push/unsubscribe` schemas to validate token format:

```typescript
// For both endpoints, update the token property:
token: {
  type: 'string',
  minLength: 50,
  maxLength: 255,
  pattern: '^[a-zA-Z0-9_:-]+$',
  description: 'FCM token',
},
```

Also add `maxLength` to `/push/send`:
```typescript
title: { type: 'string', minLength: 1, maxLength: 100, description: '通知標題' },
body: { type: 'string', minLength: 1, maxLength: 500, description: '通知內文' },
url: { type: 'string', maxLength: 500, description: '點擊後開啟的網址' },
```

**Step 2: Verify build**

Run: `cd worker && npm run build`
Expected: Build succeeds.

**Step 3: Test validation rejects bad input**

```bash
# Should fail (token too short)
curl -s -X POST http://localhost:8000/api/v1/push/subscribe \
  -H "Content-Type: application/json" \
  -d '{"token":"abc"}'
# Expected: 400 Bad Request

# Should fail (invalid characters)
curl -s -X POST http://localhost:8000/api/v1/push/subscribe \
  -H "Content-Type: application/json" \
  -d '{"token":"<script>alert(1)</script>"}'
# Expected: 400 Bad Request
```

**Step 4: Commit**

```bash
git add worker/src/routes/api-v1.ts
git commit -m "fix: add FCM token format validation and push send field limits"
```

---

## Task 5: Sanitize error messages (MEDIUM)

**Files:**
- Modify: `worker/src/server.ts:307-311, 735-740`

**Step 1: Sanitize Google Docs error**

At line 307-311, change:
```typescript
// Before:
message: `無法連接 Google Docs: ${error instanceof Error ? error.message : 'Unknown error'}`,

// After:
message: '無法連接 Google Docs，請稍後再試',
```

Keep the `console.error` log that already exists above for internal debugging.

**Step 2: Sanitize book creation error**

At line 735-740, change:
```typescript
// Before:
message: error instanceof Error ? error.message : 'Unknown error',

// After:
message: '電子書建立失敗，請稍後再試',
```

Add a console.error before it if not already present (line 736 already has one).

**Step 3: Verify build**

Run: `cd worker && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add worker/src/server.ts
git commit -m "fix: sanitize error messages to prevent information disclosure"
```

---

## Task 6: Firebase credentials documentation (CRITICAL)

**Files:**
- Modify: `worker/.env.example` (add Firebase section)
- Verify: `.gitignore` contains firebase-service-account.json

**Step 1: Verify .gitignore**

Check that `firebase-service-account.json` is NOT tracked by git:
```bash
git ls-files --error-unmatch worker/firebase-service-account.json 2>&1
# Expected: error (file not tracked)
```

If not in `.gitignore`, add:
```
**/firebase-service-account.json
```

**Step 2: Update worker/.env.example**

Add Firebase section:
```bash
# Firebase Cloud Messaging (推播通知)
# 方式一：檔案路徑（本地開發）
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json

# 方式二：JSON 字串（生產環境 / Cloudflare Workers）
# FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
```

**Step 3: Commit**

```bash
git add .gitignore worker/.env.example
git commit -m "docs: document Firebase credentials configuration"
```

---

## Task 7: Push to remote and verify

**Step 1: Push all commits**

```bash
git push
```

**Step 2: Rebuild and verify**

```bash
cd supabase-docker && docker compose up -d --build worker dashboard
```

**Step 3: Smoke test**

1. Open `http://localhost:8000/` — dashboard loads normally
2. Test invalid token rejected:
   ```bash
   curl -s -X POST http://localhost:8000/api/v1/push/subscribe \
     -H "Content-Type: application/json" -d '{"token":"bad"}'
   ```
   Expected: 400 error
3. Test valid subscribe still works:
   ```bash
   curl -s -X POST http://localhost:8000/api/v1/push/subscribe \
     -H "Content-Type: application/json" \
     -d '{"token":"test_valid_token_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'
   ```
   Expected: `{"success":true}`
4. Clean up test token from DB

---

## Summary

| Task | Severity | Type | Description |
|------|----------|------|-------------|
| 1 | LOW | Dead code | Remove 4 unused supabase functions |
| 2 | LOW | Dead code | Remove fliphtml5 artifacts, empty dir, unused env |
| 3 | HIGH | Security | Firebase init error handling + validation |
| 4 | HIGH | Security | FCM token format validation + push field limits |
| 5 | MEDIUM | Security | Sanitize error messages (prevent info disclosure) |
| 6 | CRITICAL | Security | Document Firebase credentials, verify .gitignore |
| 7 | — | Verify | Push, rebuild, smoke test |

**Not addressed in this plan (deferred):**
- L1: DOMPurify for markdown — current HTML escape is sufficient
- L2: Request ID logging — nice-to-have, not a security risk
- M4: Storage bucket public — intentional for public website images
