# Deterministic Image Mapping Design

## Goal

Replace the AI Vision–based image matcher with a deterministic filename convention. Low-res Docs images and high-res Drive files are linked by a shared `categoryId-articleIdx-imageIdx` code baked into the filename. Any deviation between the two sources aborts the import with a specific per-image error.

## Motivation

The current pipeline runs `matchAndReplacePerCategory` (worker/src/services/image-matcher.ts) after AI parsing. It has three passes:
- **Pass 1** — deterministic JOIN via Drive filename prefix vs. an AI-parsed triple derived from `deriveImageTripleMap(parsed)`.
- **Pass 2** — per-category Claude Vision fallback for orphans.
- **Pass 3** — cross-category Vision fallback for unparseable Drive files.

The AI parser's article/image ordering is unreliable, so `deriveImageTripleMap` produces wrong triples. Pass 1 then misses. Pass 2/3 Vision matching is expensive, adds latency, and still misclassifies. Editors already tag Drive high-res files with `x-x-x` prefixes; there is no reason to also run Vision.

## Contract

Editors must:
1. Put every high-res image for the weekly into the Drive folder, filename starts with `${categoryId}-${articleIdx}-${imageIdx}` (existing convention, no change).
2. Insert images into the Google Doc in the exact same order as the sorted x-x-x sequence (ascending by category, then article, then image index).

The worker validates the invariant on every import. Any deviation → import fails, no data written, editor sees exactly which image is wrong.

## Scope

**In scope:**
- New pipeline step `validating_images` between `exporting_docs` and `converting_images`.
- Rename base64 uploads from `image1.png` / `image2.png` to `1-2-3` (no extension) — content-type is authoritative.
- Rewrite `image-processor.ts` to accept an ordered x-x-x list and use it for filenames.
- Rewrite `image-matcher.ts` to a lean `replaceDriveHighRes` that downloads + compresses + upserts each Drive file to the same `x-x-x` Storage key (no Vision, no per-category bucketing, no prefix JOIN — the mapping is already baked in from step 3).
- Update `worker.ts` pipeline: remove Vision fallback code path, remove `strategy` audit_log fields, add validation step.
- Update `dashboard/src/types/api.ts` `ImportStep` union and `IMPORT_STEPS` array:
  - insert `validating_images` after `exporting_docs`
  - keep `replacing_images` step key, change description text (no "AI 比對" wording)
- Update parse-weekly skill / prompt if it references `image1.png` naming (search + adjust).

**Out of scope:**
- Restructuring AI parser as skills / multi-subagent (item 4, separate spec).
- Extension in filename (deliberately dropped — see design note).
- Historical article backfill (existing articles keep `image1.png`; only new imports use x-x-x).
- iOS PWA / other unrelated items.

## Design

### File naming

Storage key: `articles/${weekly_id}/images/${cat}-${art}-${img}` — no extension.

- Content-Type header is set from `compressImage`'s output `mimeType` (`image/jpeg` for all compressed images; original mimeType for SVGs / unsupported formats).
- Markdown URL: `/storage/v1/object/public/weekly/articles/${weekly_id}/images/${cat}-${art}-${img}`.
- Browsers render `<img src="…/1-2-3">` correctly because the response's Content-Type header is authoritative for `<img>`.
- No filename collisions on re-import: `upsert: true` overwrites, `x-x-x` is stable across re-runs of the same weekly.

Reasoning for no extension: `compressImage` always outputs JPEG for the low-res path, and the high-res replace path also passes through `compressImage`. Downstream is uniform JPEG. Encoding format in the filename was redundant. Keeping it decoration-free avoids Supabase path characters and dodges the low-res-png / high-res-jpg extension mismatch that would force a markdown URL rewrite mid-pipeline.

### Validation step

New pipeline function `validateDocImagesAgainstDrive(markdown, driveFiles)`:

**Inputs:**
- `markdown`: raw Docs export (both reference-style `[refId]: <data:…>` and inline `![](data:…)` counted).
- `driveFiles`: `DriveFile[]` from `listImagesRecursive` on the folder.

**Steps:**
1. Extract `driveFiles` prefixes via existing `parseDrivePrefix`. Collect canonical list of `x-x-x` codes; group by key.
2. Extract base64 image count from Docs markdown (inline base64 + reference-style defs, deduped by reference target).
3. Check invariants:
   - **U1**: Every Drive file's name parses to a valid x-x-x prefix. Unparseable files → error, list filenames.
   - **U2**: No duplicate x-x-x in Drive. Duplicates → error, list conflicting filenames per key.
   - **U3**: `count(docs base64 images) == count(unique x-x-x in Drive)`. Mismatch → error with both counts and a per-position mapping table showing which position had no Drive counterpart (Docs has more) or which x-x-x had no Docs image (Drive has more).

**Returns** on success: an ordered `xxxCodes: string[]` (sorted by tuple `(cat, art, img)` ascending) — index N corresponds to the N-th Docs base64 image (0-based).

**On failure:** throws `ImageValidationError` with:
- `code`: `unparseable_drive` | `duplicate_drive` | `count_mismatch`
- `details`: structured object (see Error surface below).

### Pipeline changes (worker.ts)

Before (current step 4.5):
```
converting_images → uploading_original → ai_parsing → replacing_images(AI Vision)
```

After:
```
validating_images → converting_images(rename to x-x-x) → replacing_images(direct download) → uploading_original → ai_parsing
```

Sequencing rationale:
- `validating_images` first so we fail cheap (no image upload, no AI cost) when the invariant breaks.
- `replacing_images` moves BEFORE `uploading_original` and `ai_parsing` so the persisted markdown already points at the high-res URLs and downstream steps don't churn on stale low-res.

### Converting_images (image-processor.ts)

Signature change:

```ts
export async function processAllImages(
  markdown: string,
  weeklyId: number,
  xxxCodes: string[],   // NEW — from validation step
): Promise<string>
```

Behavior:
- Extract base64 images in document order (existing regex passes).
- For the N-th image (0-based) use filename `xxxCodes[N]` (no extension).
- Rename inline base64 `![alt](data:…)` → `![alt](URL)` with the new key.
- Same for reference-style `[refId]: <data:…>`.
- If the extracted count at runtime does not equal `xxxCodes.length`: throw a defensive `AssertionError` (this should already be validated, but guard against regex drift).

### Replacing_images (image-matcher.ts rewrite)

Replace the entire file with a lean function:

```ts
export interface ReplaceOutcome {
  replaced: number;
  driveTotal: number;
}

export async function replaceWithDriveHighRes(args: {
  weeklyId: number;
  xxxToDriveFile: Map<string, DriveFile>;
  providerToken: string;
  onProgress?: (msg: string) => void;
}): Promise<ReplaceOutcome>;
```

Behavior:
- For each `(xxx, driveFile)` in the map: `downloadFile → compressImage → uploadImage(weeklyId, xxx, ...)`.
- Uses `upsert: true` (existing default) to overwrite the low-res.
- Progress reports per file: `替換 x-x-x`.

Delete: `parseDrivePrefix` (used by validation, moved into validator or kept as util), `deriveImageTripleMap`, `joinByTriple`, `bucketOrphansByCategory`, `runVisionMatchForCategory`, `computeStrategy`, `matchAndReplacePerCategory`, all `PerCategoryMatchOutcome` / `OrphanBuckets` / `PrefixMatch` / `OrphanLow` / `OrphanHigh` / `VisionMatchEntry` types.

Keep `parseDrivePrefix` as a small util exported from image-matcher (or move to a new `image-code.ts`) — the validator depends on it.

### Dashboard progress (dashboard/src/types/api.ts)

`ImportStep` union:
```diff
  | 'exporting_docs'
+ | 'validating_images'
  | 'converting_images'
```

`IMPORT_STEPS` array — insert:
```ts
{ key: 'validating_images', label: '驗證圖片編號', description: '比對 Docs 圖片數量與 Drive 檔案編號' },
```
before `converting_images`.

Update `replacing_images` entry:
```diff
- { key: 'replacing_images', label: '替換高解析度', description: 'AI 比對並替換高解析度圖片' },
+ { key: 'replacing_images', label: '替換高解析度', description: '下載並替換 Drive 高解析度圖片' },
```

### Error surface

`ImageValidationError` (new class or plain Error with structured `.details`) — worker catches and:
1. Writes `progress` broadcast with `step: 'failed'` + `error: <human-readable summary>`.
2. Writes `audit_log`:
   ```json
   {
     "action": "import",
     "metadata": {
       "step": "validation_failed",
       "reason": "count_mismatch",
       "docs_image_count": 12,
       "drive_image_count": 15,
       "missing_in_drive": [],
       "extra_in_drive": ["3-1-4","3-1-5","3-1-6"]
     }
   }
   ```
3. Aborts import — no articles inserted, no clean.md, no audio.

Dashboard shows the error banner from the `progress.error` field (existing mechanism).

Example messages:

- `count_mismatch`:
  > 匯入失敗：圖片數量不一致。Docs 有 12 張圖片，Drive 有 15 張 x-x-x 檔案。Drive 多出：[3-1-4, 3-1-5, 3-1-6]

- `unparseable_drive`:
  > 匯入失敗：Drive 資料夾有無法解析編號的檔案。請確認以下檔案有 `category-article-image` 開頭：cover.jpg, 未定稿-1.jpg

- `duplicate_drive`:
  > 匯入失敗：Drive 資料夾內同一個編號出現多次。衝突：x-x-x=1-2-3 對應到 3 個檔案（1-2-3-封面.jpg, 1-2-3-定稿.jpg, 1-2-3 (1).jpg）

### Ordering invariant (important editor contract)

**Docs image order must match sorted x-x-x order in Drive.**

The validator guarantees counts + codes match. It does NOT verify that base64 image N in Docs semantically maps to Drive file N. Enforcement is by editor discipline: if the editor mis-orders images in the Doc, images will be swapped between articles.

Suggested future safeguard (out of this spec): dashboard preview shows each image with the derived x-x-x tag before finalizing import, so editor can eyeball. For now, editors are trusted per convention.

### AI parser (parse-weekly)

Not changed in this spec. The AI parser still receives markdown with `x-x-x` URLs and generates `article.content` referencing them. Since filenames are stable identifiers (not order-dependent), AI parser output does not need to preserve image order for image-matcher purposes — image files are already correctly placed by the time parsing runs.

## Testing

**Unit (worker):**
- `validateDocImagesAgainstDrive` — synthetic Drive lists + synthetic markdown blobs covering: happy path, count mismatch (both directions), unparseable Drive filename, duplicate x-x-x.
- `processAllImages(markdown, weeklyId, xxxCodes)` — verifies renamed filenames match input codes, URLs are absolute, both inline + reference-style base64 handled.
- `replaceWithDriveHighRes` — mocked Drive download + Supabase upload, verifies same-key overwrite happens.

**Integration (manual for now):**
- Import a real weekly with correct x-x-x setup — expect: no `replacing_images` errors, all image URLs point to `x-x-x` (no extension), all high-res replaced.
- Import a weekly where Drive is missing one file — expect: `validating_images` fails with clear message, no articles inserted.
- Import where editor reordered one image in Docs (violating ordering invariant, but count matches) — expect: import succeeds but images are swapped. Documented limitation.

**Dashboard smoke:**
- Verify progress panel shows the new `validating_images` step with correct label and description.
- Verify failed import surfaces the error banner from `progress.error`.

## Migration

- Historical articles (imported before this change) still reference `image1.png` style URLs — leave alone; no data migration needed.
- The new x-x-x convention applies only to new imports.
- Old image-matcher's audit_log entries stay in the table (immutable log).

## Rollout

1. Merge changes to worker + dashboard.
2. Rebuild worker Docker image on production: `docker compose up -d --build worker`.
3. Rebuild dashboard: `docker compose up -d --build dashboard` (Vite build embeds new IMPORT_STEPS).
4. Announce to editors: Drive high-res files must be x-x-x prefixed AND Docs image order must match sorted x-x-x order. Deviation → import fails.
5. First real import — monitor logs closely for validation failures.

## Non-goals / deferred

- Ordering violation detection (Docs order != Drive sort order but counts match). Requires either editor-supplied per-image codes in the Doc (rejected in Q&A) or content-based verification (rejected — that's Vision, which we're removing).
- Non-JPEG high-res passthrough. All images end up JPEG via `compressImage`. If Drive has a PNG that must not be re-encoded, out of scope.
- Backfill / migration of existing articles' `image1.png` URLs.
