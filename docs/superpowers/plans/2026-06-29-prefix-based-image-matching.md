# Prefix-Based Image Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AI-only per-category Vision matching with prefix-deterministic JOIN + Vision fallback, eliminating ~90% of AI calls and reducing mis-match risk.

**Architecture:** Pass 1 parses `x-x-x.ext` prefixes on Drive high-res files and JOINs against `(categoryId, articleIdx, imageIdx)` triples derived from markdown. Unmatched files on either side are bucketed by category and run through the existing `runVisionMatchForCategory` as Pass 2 fallback. The entire AI folder-mapping step is removed; Drive structure (flat or subfoldered) becomes irrelevant.

**Tech Stack:** TypeScript (ESM, NodeNext), Fastify, vitest 2.x, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` ≥ 0.2.19), Supabase Storage.

## Global Constraints

- ESM modules — every relative import MUST end in `.js`.
- AI calls MUST use `@anthropic-ai/claude-agent-sdk` (`query`/`runSessionWithStreaming`), never `@anthropic-ai/sdk`.
- Model alias MUST be `'opus'` — never pin dated model IDs.
- Test framework is vitest 2.x; tests live under `worker/tests/**/*.test.ts`.
- `tsc --noEmit` (via `npm run build`) MUST pass after every task that ships TypeScript.
- Audit log `action` is the string literal `'image_match'` (already in the `AuditLog['action']` union).
- All commits sign with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer.
- Run all commands from `worker/` directory unless stated otherwise. Use absolute paths in `git add` to avoid cwd drift.

## Spec Reference

`docs/superpowers/specs/2026-06-29-prefix-based-image-matching-design.md` (commit `ec382c1`). Read it before starting Task 1 — every task implements one slice of §5–§7 of that spec.

## File Map

**Modify:**
- `worker/src/services/image-matcher.ts` — add 5 new pure functions, rewrite `matchAndReplacePerCategory`, delete folder-mapping code
- `worker/src/services/google-drive.ts` — remove `filterSubfolders` / `listSubfolders` / `DriveSubfolder`
- `worker/src/worker.ts` — update audit log metadata at line ~154
- `worker/src/routes/weekly.ts` — update audit log metadata at line ~142

**Create:**
- `worker/tests/services/image-matcher.parse-prefix.test.ts`
- `worker/tests/services/image-matcher.derive-triple.test.ts`
- `worker/tests/services/image-matcher.join.test.ts`
- `worker/tests/services/image-matcher.bucket.test.ts`
- `worker/tests/services/image-matcher.strategy.test.ts`

**Delete:**
- `worker/tests/services/image-matcher.derive.test.ts` (superseded by derive-triple)
- `worker/tests/services/image-matcher.detect.test.ts` (target function gone)
- `worker/tests/services/image-matcher.mapping.test.ts` (target functions gone)
- `worker/tests/services/google-drive.test.ts` (target function gone)

---

### Task 1: `parseDrivePrefix` — high-res filename parser

**Files:**
- Create: `worker/tests/services/image-matcher.parse-prefix.test.ts`
- Modify: `worker/src/services/image-matcher.ts` (add new export)

**Interfaces:**
- Consumes: nothing
- Produces: `export function parseDrivePrefix(filename: string): { categoryId: number; articleIdx: number; imageIdx: number } | null`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/services/image-matcher.parse-prefix.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDrivePrefix } from '../../src/services/image-matcher.js';

describe('parseDrivePrefix', () => {
  it('parses canonical x-x-x.ext', () => {
    expect(parseDrivePrefix('3-2-3.jpg')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('parses with trailing chinese suffix', () => {
    expect(parseDrivePrefix('3-2-3-定稿.jpg')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('parses with trailing parenthesized index', () => {
    expect(parseDrivePrefix('3-2-3 (1).png')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('tolerates leading zeros', () => {
    expect(parseDrivePrefix('03-02-03.jpg')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('rejects prefix not at start of filename', () => {
    expect(parseDrivePrefix('cover-3-2-3.jpg')).toBeNull();
  });

  it('rejects categoryId > 8', () => {
    expect(parseDrivePrefix('9-1-1.jpg')).toBeNull();
  });

  it('rejects categoryId < 1', () => {
    expect(parseDrivePrefix('0-1-1.jpg')).toBeNull();
  });

  it('rejects articleIdx of 0', () => {
    expect(parseDrivePrefix('1-0-1.jpg')).toBeNull();
  });

  it('rejects imageIdx of 0', () => {
    expect(parseDrivePrefix('1-1-0.jpg')).toBeNull();
  });

  it('returns null for unrelated filename', () => {
    expect(parseDrivePrefix('random.jpg')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDrivePrefix('')).toBeNull();
  });

  it('returns null when fewer than three segments', () => {
    expect(parseDrivePrefix('3-2.jpg')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- tests/services/image-matcher.parse-prefix.test.ts`
Expected: FAIL with `parseDrivePrefix is not a function` (or `does not provide an export`).

- [ ] **Step 3: Add `parseDrivePrefix` to `image-matcher.ts`**

In `worker/src/services/image-matcher.ts`, add the following near the top (after existing imports, before `IMAGE_FILENAME_REGEX`):

```typescript
const DRIVE_PREFIX_REGEX = /^(\d+)-(\d+)-(\d+)/;

/**
 * 解析高解析度 Drive 檔名 prefix。
 * 規則：開頭三組正整數以 `-` 分隔；categoryId 必須在 1-8；articleIdx / imageIdx 必須 ≥ 1。
 * 容忍：前導 0、`-定稿`、` (1)` 等後綴。
 */
export function parseDrivePrefix(
  filename: string,
): { categoryId: number; articleIdx: number; imageIdx: number } | null {
  const match = DRIVE_PREFIX_REGEX.exec(filename);
  if (!match) return null;
  const categoryId = Number(match[1]);
  const articleIdx = Number(match[2]);
  const imageIdx = Number(match[3]);
  if (categoryId < 1 || categoryId > 8) return null;
  if (articleIdx < 1 || imageIdx < 1) return null;
  return { categoryId, articleIdx, imageIdx };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test -- tests/services/image-matcher.parse-prefix.test.ts`
Expected: PASS — 12 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
        /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.parse-prefix.test.ts
git commit -m "$(cat <<'EOF'
feat(image-matcher): add parseDrivePrefix for x-x-x.ext filenames

Lenient regex tolerates leading zeros and trailing suffixes; rejects
categoryId outside 1-8 and zero article/image indices.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `deriveImageTripleMap` — low-res markdown → triple map

**Files:**
- Create: `worker/tests/services/image-matcher.derive-triple.test.ts`
- Modify: `worker/src/services/image-matcher.ts` (add new export)

**Interfaces:**
- Consumes: `ParsedWeekly` from `worker/src/types/index.ts` — `{ weekly_id: number; categories: Array<{ category_id: number; name: string; sort_order: number; articles: Array<{ title: string; content: string }> }> }`. Reuses `IMAGE_FILENAME_REGEX` (already defined in `image-matcher.ts` as `/\/images\/(image\d+\.\w+)\)/g`).
- Produces: `export type ImageTriple = { categoryId: number; articleIdx: number; imageIdx: number }`; `export function deriveImageTripleMap(parsed: ParsedWeekly): Map<string, ImageTriple>`. Key is the image filename (e.g. `image14.jpg`).

- [ ] **Step 1: Write the failing test**

Create `worker/tests/services/image-matcher.derive-triple.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveImageTripleMap } from '../../src/services/image-matcher.js';
import type { ParsedWeekly } from '../../src/types/index.js';

describe('deriveImageTripleMap', () => {
  it('assigns article index per-category (1-based) and image index per-article (1-based)', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 140,
      categories: [
        {
          category_id: 1,
          name: '全球焦點',
          sort_order: 1,
          articles: [
            {
              title: 'A',
              content:
                '![](/x/images/image1.jpg) tail ![](/x/images/image2.png)',
            },
            { title: 'B', content: '![](/x/images/image3.jpg)' },
          ],
        },
        {
          category_id: 3,
          name: '慈濟要聞',
          sort_order: 3,
          articles: [{ title: 'C', content: '![](/x/images/image7.jpg)' }],
        },
      ],
    };
    const map = deriveImageTripleMap(parsed);
    expect(map.get('image1.jpg')).toEqual({ categoryId: 1, articleIdx: 1, imageIdx: 1 });
    expect(map.get('image2.png')).toEqual({ categoryId: 1, articleIdx: 1, imageIdx: 2 });
    expect(map.get('image3.jpg')).toEqual({ categoryId: 1, articleIdx: 2, imageIdx: 1 });
    expect(map.get('image7.jpg')).toEqual({ categoryId: 3, articleIdx: 1, imageIdx: 1 });
    expect(map.size).toBe(4);
  });

  it('first occurrence wins when same filename appears in multiple categories', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        {
          category_id: 2,
          name: 'X',
          sort_order: 2,
          articles: [{ title: 'A', content: '![](/x/images/image9.jpg)' }],
        },
        {
          category_id: 5,
          name: 'Y',
          sort_order: 5,
          articles: [{ title: 'B', content: '![](/x/images/image9.jpg)' }],
        },
      ],
    };
    expect(deriveImageTripleMap(parsed).get('image9.jpg')).toEqual({
      categoryId: 2,
      articleIdx: 1,
      imageIdx: 1,
    });
  });

  it('returns empty map when there are no image references', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        {
          category_id: 1,
          name: 'X',
          sort_order: 1,
          articles: [{ title: 'A', content: 'no images' }],
        },
      ],
    };
    expect(deriveImageTripleMap(parsed).size).toBe(0);
  });

  it('returns empty map for empty categories array', () => {
    expect(deriveImageTripleMap({ weekly_id: 1, categories: [] }).size).toBe(0);
  });

  it('articleIdx counts only within its own category, not globally', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        {
          category_id: 1,
          name: 'X',
          sort_order: 1,
          articles: [
            { title: 'A', content: '![](/x/images/image1.jpg)' },
            { title: 'B', content: '![](/x/images/image2.jpg)' },
          ],
        },
        {
          category_id: 2,
          name: 'Y',
          sort_order: 2,
          articles: [{ title: 'C', content: '![](/x/images/image3.jpg)' }],
        },
      ],
    };
    const map = deriveImageTripleMap(parsed);
    expect(map.get('image3.jpg')).toEqual({ categoryId: 2, articleIdx: 1, imageIdx: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- tests/services/image-matcher.derive-triple.test.ts`
Expected: FAIL with `deriveImageTripleMap is not a function` (or `does not provide an export`).

- [ ] **Step 3: Add `ImageTriple` type and `deriveImageTripleMap` to `image-matcher.ts`**

In `worker/src/services/image-matcher.ts`, immediately after the existing `IMAGE_FILENAME_REGEX` constant declaration, add:

```typescript
export type ImageTriple = { categoryId: number; articleIdx: number; imageIdx: number };

/**
 * 從 parse 結果推導每張低解析度圖對應的三元組 (categoryId, articleIdx, imageIdx)。
 * - articleIdx：該分類內第幾篇文稿（1-based）
 * - imageIdx：該篇 article.content 中第幾張圖（1-based，依 regex 順序）
 * 同檔名跨多版引用時，第一次出現勝出。
 */
export function deriveImageTripleMap(parsed: ParsedWeekly): Map<string, ImageTriple> {
  const map = new Map<string, ImageTriple>();
  for (const category of parsed.categories) {
    let articleIdx = 0;
    for (const article of category.articles) {
      articleIdx += 1;
      IMAGE_FILENAME_REGEX.lastIndex = 0;
      let imageIdx = 0;
      let match;
      while ((match = IMAGE_FILENAME_REGEX.exec(article.content)) !== null) {
        imageIdx += 1;
        const filename = match[1];
        if (!map.has(filename)) {
          map.set(filename, {
            categoryId: category.category_id,
            articleIdx,
            imageIdx,
          });
        }
      }
    }
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test -- tests/services/image-matcher.derive-triple.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
        /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.derive-triple.test.ts
git commit -m "$(cat <<'EOF'
feat(image-matcher): add deriveImageTripleMap

Walks ParsedWeekly to assign each low-res filename a (categoryId,
articleIdx, imageIdx) triple. articleIdx is per-category 1-based;
imageIdx is per-article 1-based by markdown order.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `joinByTriple` — Pass 1 deterministic match

**Files:**
- Create: `worker/tests/services/image-matcher.join.test.ts`
- Modify: `worker/src/services/image-matcher.ts` (add new exports)

**Interfaces:**
- Consumes: `ImageTriple` from Task 2; `parseDrivePrefix` from Task 1; `DriveFile` from `worker/src/services/google-drive.ts` — `{ id: string; name: string; mimeType: string; size?: string }`.
- Produces:
  - `export interface PrefixMatch { lowFilename: string; driveFileId: string; driveFileName: string; mimeType: string }`
  - `export interface OrphanLow { filename: string; triple: ImageTriple }`
  - `export interface OrphanHigh { file: DriveFile; prefix: { categoryId: number; articleIdx: number; imageIdx: number } | null }`
  - `export interface JoinOutcome { matched: PrefixMatch[]; orphanLow: OrphanLow[]; orphanHigh: OrphanHigh[]; conflictTriples: string[] }`
  - `export function joinByTriple(lowMap: Map<string, ImageTriple>, highFiles: DriveFile[]): JoinOutcome`
  - Internal `tripleKey` format: `${categoryId}-${articleIdx}-${imageIdx}`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/services/image-matcher.join.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { joinByTriple } from '../../src/services/image-matcher.js';
import type { ImageTriple } from '../../src/services/image-matcher.js';
import type { DriveFile } from '../../src/services/google-drive.js';

function img(id: string, name: string): DriveFile {
  return { id, name, mimeType: 'image/jpeg' };
}

describe('joinByTriple', () => {
  it('matches one-to-one when low and high align', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
      ['image2.jpg', { categoryId: 3, articleIdx: 2, imageIdx: 1 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg'), img('d2', '3-2-1.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toEqual([
      { lowFilename: 'image1.jpg', driveFileId: 'd1', driveFileName: '1-1-1.jpg', mimeType: 'image/jpeg' },
      { lowFilename: 'image2.jpg', driveFileId: 'd2', driveFileName: '3-2-1.jpg', mimeType: 'image/jpeg' },
    ]);
    expect(out.orphanLow).toEqual([]);
    expect(out.orphanHigh).toEqual([]);
    expect(out.conflictTriples).toEqual([]);
  });

  it('puts low images with no high match into orphanLow', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
      ['image2.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 2 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toHaveLength(1);
    expect(out.orphanLow).toEqual([
      { filename: 'image2.jpg', triple: { categoryId: 1, articleIdx: 1, imageIdx: 2 } },
    ]);
    expect(out.orphanHigh).toEqual([]);
  });

  it('puts unclaimed high images into orphanHigh with their parsed prefix', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg'), img('d2', '2-1-1.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toHaveLength(1);
    expect(out.orphanHigh).toEqual([
      { file: high[1], prefix: { categoryId: 2, articleIdx: 1, imageIdx: 1 } },
    ]);
  });

  it('flags unparseable high-res files in orphanHigh with prefix=null', () => {
    const low = new Map<string, ImageTriple>();
    const high: DriveFile[] = [img('d1', 'random.jpg')];
    const out = joinByTriple(low, high);
    expect(out.orphanHigh).toEqual([{ file: high[0], prefix: null }]);
  });

  it('on triple collision (two high files parse to same key): low goes to orphan, both highs go to orphan, key recorded', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 3, articleIdx: 2, imageIdx: 3 }],
    ]);
    const high: DriveFile[] = [img('d1', '3-2-3.jpg'), img('d2', '3-2-3-定稿.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toEqual([]);
    expect(out.orphanLow).toEqual([
      { filename: 'image1.jpg', triple: { categoryId: 3, articleIdx: 2, imageIdx: 3 } },
    ]);
    expect(out.orphanHigh).toHaveLength(2);
    expect(out.orphanHigh.map((o) => o.file.id).sort()).toEqual(['d1', 'd2']);
    expect(out.conflictTriples).toEqual(['3-2-3']);
  });

  it('returns empty outcome for empty inputs', () => {
    const out = joinByTriple(new Map(), []);
    expect(out).toEqual({ matched: [], orphanLow: [], orphanHigh: [], conflictTriples: [] });
  });

  it('treats unparseable high as separate from triple collisions', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg'), img('d2', 'random.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toHaveLength(1);
    expect(out.orphanHigh).toEqual([{ file: high[1], prefix: null }]);
    expect(out.conflictTriples).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- tests/services/image-matcher.join.test.ts`
Expected: FAIL with `joinByTriple is not a function`.

- [ ] **Step 3: Add `JoinOutcome` types and `joinByTriple` to `image-matcher.ts`**

In `worker/src/services/image-matcher.ts`, add (after `deriveImageTripleMap`, before the existing `DriveStructure` type that will be deleted in Task 8):

```typescript
export interface PrefixMatch {
  lowFilename: string;
  driveFileId: string;
  driveFileName: string;
  mimeType: string;
}

export interface OrphanLow {
  filename: string;
  triple: ImageTriple;
}

export interface OrphanHigh {
  file: DriveFile;
  prefix: { categoryId: number; articleIdx: number; imageIdx: number } | null;
}

export interface JoinOutcome {
  matched: PrefixMatch[];
  orphanLow: OrphanLow[];
  orphanHigh: OrphanHigh[];
  conflictTriples: string[];
}

function tripleKey(t: { categoryId: number; articleIdx: number; imageIdx: number }): string {
  return `${t.categoryId}-${t.articleIdx}-${t.imageIdx}`;
}

/**
 * Pass 1：以三元組 key 將低解析度與高解析度做 deterministic JOIN。
 * 衝突（多個 Drive 檔解析出同一 key） → 該 low 與所有 high 皆進 orphans。
 * 解不出 prefix 的 high → 進 orphanHigh，prefix=null。
 */
export function joinByTriple(
  lowMap: Map<string, ImageTriple>,
  highFiles: DriveFile[],
): JoinOutcome {
  const highByKey = new Map<string, DriveFile[]>();
  const unparseable: DriveFile[] = [];

  for (const file of highFiles) {
    const prefix = parseDrivePrefix(file.name);
    if (!prefix) {
      unparseable.push(file);
      continue;
    }
    const key = tripleKey(prefix);
    const list = highByKey.get(key);
    if (list) list.push(file);
    else highByKey.set(key, [file]);
  }

  const matched: PrefixMatch[] = [];
  const orphanLow: OrphanLow[] = [];
  const conflictTriples: string[] = [];
  const claimedHighIds = new Set<string>();
  const conflictedHighIds = new Set<string>();

  for (const [filename, triple] of lowMap) {
    const key = tripleKey(triple);
    const candidates = highByKey.get(key);
    if (!candidates || candidates.length === 0) {
      orphanLow.push({ filename, triple });
      continue;
    }
    if (candidates.length >= 2) {
      conflictTriples.push(key);
      orphanLow.push({ filename, triple });
      for (const c of candidates) conflictedHighIds.add(c.id);
      continue;
    }
    const high = candidates[0];
    matched.push({
      lowFilename: filename,
      driveFileId: high.id,
      driveFileName: high.name,
      mimeType: high.mimeType,
    });
    claimedHighIds.add(high.id);
  }

  const orphanHigh: OrphanHigh[] = [];
  for (const file of highFiles) {
    if (claimedHighIds.has(file.id)) continue;
    if (conflictedHighIds.has(file.id)) {
      const prefix = parseDrivePrefix(file.name);
      orphanHigh.push({ file, prefix });
      continue;
    }
    if (unparseable.includes(file)) {
      orphanHigh.push({ file, prefix: null });
      continue;
    }
    // parseable but its triple had no low-res counterpart
    const prefix = parseDrivePrefix(file.name);
    orphanHigh.push({ file, prefix });
  }

  return { matched, orphanLow, orphanHigh, conflictTriples };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test -- tests/services/image-matcher.join.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
        /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.join.test.ts
git commit -m "$(cat <<'EOF'
feat(image-matcher): add joinByTriple Pass 1 deterministic JOIN

Joins low-res triples against parsed high-res prefixes; collisions
(>=2 high files parsing to the same key) send all participants to
orphan pools. Unparseable high-res files surface in orphanHigh with
prefix=null for downstream audit logging.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `bucketOrphansByCategory` — Pass 2 prep

**Files:**
- Create: `worker/tests/services/image-matcher.bucket.test.ts`
- Modify: `worker/src/services/image-matcher.ts` (add new export)

**Interfaces:**
- Consumes: `OrphanLow`, `OrphanHigh` from Task 3.
- Produces:
  - `export interface OrphanBuckets { byCategory: Map<number, { lowFilenames: string[]; highFiles: DriveFile[] }>; unknownHighRes: DriveFile[] }`
  - `export function bucketOrphansByCategory(orphanLow: OrphanLow[], orphanHigh: OrphanHigh[]): OrphanBuckets`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/services/image-matcher.bucket.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { bucketOrphansByCategory } from '../../src/services/image-matcher.js';
import type { OrphanLow, OrphanHigh } from '../../src/services/image-matcher.js';
import type { DriveFile } from '../../src/services/google-drive.js';

function img(id: string, name: string): DriveFile {
  return { id, name, mimeType: 'image/jpeg' };
}

describe('bucketOrphansByCategory', () => {
  it('groups low by triple.categoryId and high by prefix.categoryId', () => {
    const low: OrphanLow[] = [
      { filename: 'a.jpg', triple: { categoryId: 1, articleIdx: 1, imageIdx: 1 } },
      { filename: 'b.jpg', triple: { categoryId: 1, articleIdx: 1, imageIdx: 2 } },
      { filename: 'c.jpg', triple: { categoryId: 3, articleIdx: 1, imageIdx: 1 } },
    ];
    const high: OrphanHigh[] = [
      { file: img('h1', '1-1-1.jpg'), prefix: { categoryId: 1, articleIdx: 1, imageIdx: 1 } },
      { file: img('h2', '3-1-2.jpg'), prefix: { categoryId: 3, articleIdx: 1, imageIdx: 2 } },
    ];
    const out = bucketOrphansByCategory(low, high);
    expect(out.byCategory.get(1)!.lowFilenames).toEqual(['a.jpg', 'b.jpg']);
    expect(out.byCategory.get(1)!.highFiles.map((f) => f.id)).toEqual(['h1']);
    expect(out.byCategory.get(3)!.lowFilenames).toEqual(['c.jpg']);
    expect(out.byCategory.get(3)!.highFiles.map((f) => f.id)).toEqual(['h2']);
    expect(out.unknownHighRes).toEqual([]);
  });

  it('puts high files with prefix=null into unknownHighRes', () => {
    const high: OrphanHigh[] = [
      { file: img('h1', 'random.jpg'), prefix: null },
      { file: img('h2', '2-1-1.jpg'), prefix: { categoryId: 2, articleIdx: 1, imageIdx: 1 } },
    ];
    const out = bucketOrphansByCategory([], high);
    expect(out.unknownHighRes.map((f) => f.id)).toEqual(['h1']);
    expect(out.byCategory.get(2)!.highFiles.map((f) => f.id)).toEqual(['h2']);
  });

  it('creates a category bucket even when only one side has entries', () => {
    const low: OrphanLow[] = [
      { filename: 'a.jpg', triple: { categoryId: 5, articleIdx: 1, imageIdx: 1 } },
    ];
    const out = bucketOrphansByCategory(low, []);
    expect(out.byCategory.get(5)!.lowFilenames).toEqual(['a.jpg']);
    expect(out.byCategory.get(5)!.highFiles).toEqual([]);
  });

  it('returns empty buckets for empty inputs', () => {
    const out = bucketOrphansByCategory([], []);
    expect(out.byCategory.size).toBe(0);
    expect(out.unknownHighRes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- tests/services/image-matcher.bucket.test.ts`
Expected: FAIL with `bucketOrphansByCategory is not a function`.

- [ ] **Step 3: Add `OrphanBuckets` and `bucketOrphansByCategory`**

In `worker/src/services/image-matcher.ts`, add immediately after `joinByTriple`:

```typescript
export interface OrphanBuckets {
  byCategory: Map<number, { lowFilenames: string[]; highFiles: DriveFile[] }>;
  unknownHighRes: DriveFile[];
}

/**
 * Pass 2 準備：把 Pass 1 的孤兒依 categoryId 分桶。
 * - orphanLow 依 triple.categoryId 分組
 * - orphanHigh 依 prefix?.categoryId 分組；prefix=null 進 unknownHighRes（不參與 Vision）
 */
export function bucketOrphansByCategory(
  orphanLow: OrphanLow[],
  orphanHigh: OrphanHigh[],
): OrphanBuckets {
  const byCategory = new Map<number, { lowFilenames: string[]; highFiles: DriveFile[] }>();
  const ensure = (catId: number) => {
    let bucket = byCategory.get(catId);
    if (!bucket) {
      bucket = { lowFilenames: [], highFiles: [] };
      byCategory.set(catId, bucket);
    }
    return bucket;
  };

  for (const o of orphanLow) {
    ensure(o.triple.categoryId).lowFilenames.push(o.filename);
  }

  const unknownHighRes: DriveFile[] = [];
  for (const o of orphanHigh) {
    if (!o.prefix) {
      unknownHighRes.push(o.file);
      continue;
    }
    ensure(o.prefix.categoryId).highFiles.push(o.file);
  }

  return { byCategory, unknownHighRes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test -- tests/services/image-matcher.bucket.test.ts`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
        /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.bucket.test.ts
git commit -m "$(cat <<'EOF'
feat(image-matcher): bucket Pass 1 orphans by categoryId for Vision fallback

Low orphans grouped by triple.categoryId; high orphans grouped by
their parsed prefix.categoryId. Unparseable high-res files (prefix=null)
land in unknownHighRes and are excluded from Vision matching.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `computeStrategy` — audit log strategy decision

**Files:**
- Create: `worker/tests/services/image-matcher.strategy.test.ts`
- Modify: `worker/src/services/image-matcher.ts` (add new export)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type MatchStrategy = 'prefix-only' | 'prefix-with-fallback' | 'vision-only' | 'skipped-no-drive-images' | 'skipped-no-low-res'`
  - `export function computeStrategy(input: { driveTotal: number; lowResTotal: number; prefixMatched: number; visionAttempted: boolean }): MatchStrategy`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/services/image-matcher.strategy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeStrategy } from '../../src/services/image-matcher.js';

describe('computeStrategy', () => {
  it('returns skipped-no-drive-images when Drive yielded nothing', () => {
    expect(
      computeStrategy({ driveTotal: 0, lowResTotal: 5, prefixMatched: 0, visionAttempted: false }),
    ).toBe('skipped-no-drive-images');
  });

  it('returns skipped-no-low-res when markdown has no image references', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 0, prefixMatched: 0, visionAttempted: false }),
    ).toBe('skipped-no-low-res');
  });

  it('skipped-no-drive-images takes precedence over no-low-res', () => {
    expect(
      computeStrategy({ driveTotal: 0, lowResTotal: 0, prefixMatched: 0, visionAttempted: false }),
    ).toBe('skipped-no-drive-images');
  });

  it('prefix-only when all matched via prefix and Vision was not invoked', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 5, prefixMatched: 5, visionAttempted: false }),
    ).toBe('prefix-only');
  });

  it('prefix-with-fallback when prefix matched some and Vision was invoked', () => {
    expect(
      computeStrategy({ driveTotal: 6, lowResTotal: 5, prefixMatched: 3, visionAttempted: true }),
    ).toBe('prefix-with-fallback');
  });

  it('vision-only when prefix matched nothing but Vision was invoked', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 5, prefixMatched: 0, visionAttempted: true }),
    ).toBe('vision-only');
  });

  it('prefix-only when neither prefix nor Vision matched (no work attempted)', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 5, prefixMatched: 0, visionAttempted: false }),
    ).toBe('prefix-only');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- tests/services/image-matcher.strategy.test.ts`
Expected: FAIL with `computeStrategy is not a function`.

- [ ] **Step 3: Add `MatchStrategy` and `computeStrategy`**

In `worker/src/services/image-matcher.ts`, add immediately after `bucketOrphansByCategory`:

```typescript
export type MatchStrategy =
  | 'prefix-only'
  | 'prefix-with-fallback'
  | 'vision-only'
  | 'skipped-no-drive-images'
  | 'skipped-no-low-res';

/**
 * 從計數器決定 audit log strategy 欄位。判定順序見 spec §6。
 */
export function computeStrategy(input: {
  driveTotal: number;
  lowResTotal: number;
  prefixMatched: number;
  visionAttempted: boolean;
}): MatchStrategy {
  if (input.driveTotal === 0) return 'skipped-no-drive-images';
  if (input.lowResTotal === 0) return 'skipped-no-low-res';
  if (input.prefixMatched > 0 && input.visionAttempted) return 'prefix-with-fallback';
  if (input.prefixMatched === 0 && input.visionAttempted) return 'vision-only';
  return 'prefix-only';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test -- tests/services/image-matcher.strategy.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
        /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.strategy.test.ts
git commit -m "$(cat <<'EOF'
feat(image-matcher): add computeStrategy for audit log classification

Five strategies; skipped-no-drive-images takes precedence; vision-only
requires visionAttempted=true even when matched=0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rewrite `matchAndReplacePerCategory` orchestrator + update callers

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (replace existing `matchAndReplacePerCategory` and `PerCategoryMatchOutcome`)
- Modify: `worker/src/worker.ts` (audit log block around line 144-170)
- Modify: `worker/src/routes/weekly.ts` (audit log block around line 142-160)

**Interfaces:**
- Consumes: `deriveImageTripleMap`, `joinByTriple`, `bucketOrphansByCategory`, `computeStrategy`, `runVisionMatchForCategory` (existing, untouched); `listImagesRecursive`, `downloadFile` from `google-drive.js`; `compressImage` from `image-compressor.js`; `uploadImage` from `supabase.js`.
- Produces: New `PerCategoryMatchOutcome` shape:

```typescript
export interface PerCategoryMatchOutcome {
  totalReplaced: number;
  strategy: MatchStrategy;
  prefixMatched: number;
  visionMatched: number;
  driveTotal: number;
  lowResTotal: number;
  orphanLowAfter: string[];
  unparseableHighRes: string[];
  conflictTriples: string[];
}
```

`matchAndReplacePerCategory` signature unchanged from caller's perspective: `(options: { weeklyId; parsed; providerToken; driveFolderId; onProgress? }) => Promise<PerCategoryMatchOutcome>`.

Callers' audit log metadata changes per spec §6 — old `drive_structure` / `folder_mapping` / `per_category` / `unmapped_folders` fields are removed, replaced by `strategy` / `prefix_matched` / `vision_matched` / `drive_total` / `low_res_total` / `orphan_low_after` / `unparseable_high_res` / `conflict_triples`.

> Note: this task does **not** delete the obsolete functions (`detectDriveStructure`, `mapDriveFoldersToCategories` etc.) — they're orphaned but still compile. Deletion happens in Task 7 to keep this task's diff focused on behavioral change.

- [ ] **Step 1: Replace the existing `matchAndReplacePerCategory` and `PerCategoryMatchOutcome`**

In `worker/src/services/image-matcher.ts`, locate the existing `PerCategoryMatchOutcome` interface (around line 340) and the existing `matchAndReplacePerCategory` function (around line 354). Replace BOTH with:

```typescript
export interface PerCategoryMatchOutcome {
  totalReplaced: number;
  strategy: MatchStrategy;
  prefixMatched: number;
  visionMatched: number;
  driveTotal: number;
  lowResTotal: number;
  orphanLowAfter: string[];
  unparseableHighRes: string[];
  conflictTriples: string[];
}

/**
 * 主入口：prefix-first 兩段式比對。
 * Pass 1：deterministic JOIN via x-x-x.ext prefix
 * Pass 2：Vision fallback per category（沿用 runVisionMatchForCategory）
 */
export async function matchAndReplacePerCategory(options: {
  weeklyId: number;
  parsed: ParsedWeekly;
  providerToken: string;
  driveFolderId: string;
  onProgress?: (msg: string) => void;
}): Promise<PerCategoryMatchOutcome> {
  const { weeklyId, parsed, providerToken, driveFolderId, onProgress } = options;

  const emptyOutcome = (strategy: MatchStrategy, driveTotal: number, lowResTotal: number): PerCategoryMatchOutcome => ({
    totalReplaced: 0,
    strategy,
    prefixMatched: 0,
    visionMatched: 0,
    driveTotal,
    lowResTotal,
    orphanLowAfter: [],
    unparseableHighRes: [],
    conflictTriples: [],
  });

  onProgress?.('列出 Drive 高解析度圖...');
  const highFiles = await listImagesRecursive(providerToken, driveFolderId);
  const lowMap = deriveImageTripleMap(parsed);

  if (highFiles.length === 0) {
    onProgress?.('Drive 沒有任何圖檔，跳過替換');
    return emptyOutcome('skipped-no-drive-images', 0, lowMap.size);
  }
  if (lowMap.size === 0) {
    onProgress?.('Markdown 無圖片引用，跳過替換');
    return emptyOutcome('skipped-no-low-res', highFiles.length, 0);
  }

  onProgress?.(`Pass 1 prefix 比對：${lowMap.size} 張低解析度 vs ${highFiles.length} 張 Drive 圖`);
  const join = joinByTriple(lowMap, highFiles);

  let prefixMatched = 0;
  for (const m of join.matched) {
    onProgress?.(`替換 ${m.lowFilename} ← ${m.driveFileName}`);
    const buffer = await downloadFile(providerToken, m.driveFileId);
    const compressed = await compressImage(buffer, m.mimeType);
    await uploadImage(weeklyId, m.lowFilename, compressed.buffer, compressed.mimeType);
    prefixMatched += 1;
  }

  const buckets = bucketOrphansByCategory(join.orphanLow, join.orphanHigh);
  const visionEligibleCats = [...buckets.byCategory.entries()].filter(
    ([, b]) => b.lowFilenames.length > 0 && b.highFiles.length > 0,
  );
  const visionAttempted = visionEligibleCats.length > 0;

  let visionMatched = 0;
  const matchedLowFilenames = new Set<string>();
  if (visionAttempted) {
    onProgress?.(`Pass 2 Vision fallback：${visionEligibleCats.length} 個分類有漏網圖檔`);
    for (const [catId, bucket] of visionEligibleCats) {
      const result = await runVisionMatchForCategory({
        weeklyId,
        categoryId: catId,
        lowFilenames: bucket.lowFilenames,
        highFiles: bucket.highFiles,
        providerToken,
        onProgress,
      });
      visionMatched += result.replaced;
      // runVisionMatchForCategory doesn't return which specific files matched,
      // so for orphanLowAfter we conservatively keep all orphan low filenames
      // and subtract the count below. Use bucket size when fully replaced; else leave all.
      if (result.replaced === bucket.lowFilenames.length) {
        for (const fn of bucket.lowFilenames) matchedLowFilenames.add(fn);
      }
    }
  }

  const orphanLowAfter = join.orphanLow
    .map((o) => o.filename)
    .filter((fn) => !matchedLowFilenames.has(fn));

  const strategy = computeStrategy({
    driveTotal: highFiles.length,
    lowResTotal: lowMap.size,
    prefixMatched,
    visionAttempted,
  });

  return {
    totalReplaced: prefixMatched + visionMatched,
    strategy,
    prefixMatched,
    visionMatched,
    driveTotal: highFiles.length,
    lowResTotal: lowMap.size,
    orphanLowAfter,
    unparseableHighRes: buckets.unknownHighRes.map((f) => f.name),
    conflictTriples: join.conflictTriples,
  };
}
```

- [ ] **Step 2: Update `worker.ts` audit log payload**

In `worker/src/worker.ts`, locate the block beginning `await writeAuditLog({` immediately after the `console.log` line for `[replacing_images] strategy=...`. Replace the entire `await writeAuditLog({ ... })` call with:

```typescript
await writeAuditLog({
  user_email: userEmail || null,
  action: 'image_match',
  table_name: null,
  record_id: null,
  old_data: null,
  new_data: null,
  metadata: {
    weekly_id: weeklyId,
    strategy: outcome.strategy,
    total_replaced: outcome.totalReplaced,
    prefix_matched: outcome.prefixMatched,
    vision_matched: outcome.visionMatched,
    drive_total: outcome.driveTotal,
    low_res_total: outcome.lowResTotal,
    orphan_low_after: outcome.orphanLowAfter,
    unparseable_high_res: outcome.unparseableHighRes,
    conflict_triples: outcome.conflictTriples,
  },
});
```

Also update the `console.log` two lines above to match the new field name (`outcome.totalReplaced` is unchanged, just keep verifying):

```typescript
console.log(
  `[replacing_images] strategy=${outcome.strategy}, replaced=${outcome.totalReplaced}, prefix=${outcome.prefixMatched}, vision=${outcome.visionMatched}`,
);
```

- [ ] **Step 3: Update `routes/weekly.ts` audit log payload**

In `worker/src/routes/weekly.ts`, locate the block `await insertAuditLog({` after the `matchAndReplacePerCategory` call (around line 142). Replace the entire `await insertAuditLog({ ... })` with:

```typescript
await insertAuditLog({
  user_email: user_email || null,
  action: 'image_match',
  table_name: 'weekly',
  record_id: weeklyId,
  old_data: null,
  new_data: null,
  metadata: {
    weekly_id: weeklyId,
    step: 'replace_images',
    drive_folder_url: driveFolderUrl,
    strategy: outcome.strategy,
    total_replaced: outcome.totalReplaced,
    prefix_matched: outcome.prefixMatched,
    vision_matched: outcome.visionMatched,
    drive_total: outcome.driveTotal,
    low_res_total: outcome.lowResTotal,
    orphan_low_after: outcome.orphanLowAfter,
    unparseable_high_res: outcome.unparseableHighRes,
    conflict_triples: outcome.conflictTriples,
  },
});
```

- [ ] **Step 4: Verify the project compiles**

Run: `cd worker && npm run build`
Expected: `tsc` exits 0 with no errors.

- [ ] **Step 5: Run all tests**

Run: `cd worker && npm test`
Expected: All 5 new test files PASS. Pre-existing tests (`image-matcher.derive.test.ts`, `image-matcher.detect.test.ts`, `image-matcher.mapping.test.ts`, `google-drive.test.ts`) MAY still pass; they're deleted in Tasks 7-8. Pre-existing vitest noise from `src/server.ts:411` "EADDRINUSE port 3001" (when dev server is running concurrently) is an unrelated artifact — ignore.

- [ ] **Step 6: Commit**

```bash
git add /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
        /Users/kaellim/Desktop/projects/library/worker/src/worker.ts \
        /Users/kaellim/Desktop/projects/library/worker/src/routes/weekly.ts
git commit -m "$(cat <<'EOF'
feat(image-matcher): rewrite matchAndReplacePerCategory as prefix-first hybrid

Pass 1 does deterministic JOIN via x-x-x.ext prefixes against
ParsedWeekly-derived triples. Pass 2 runs Vision fallback only on
orphan pools, bucketed per category. The folder-mapping AI step is
no longer invoked. Audit log metadata reshaped: dropped
drive_structure / folder_mapping / per_category / unmapped_folders;
added strategy / prefix_matched / vision_matched / drive_total /
low_res_total / orphan_low_after / unparseable_high_res /
conflict_triples for post-hoc analysis.

Obsolete folder-mapping declarations stay in image-matcher.ts as dead
code until Task 7 cleanup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Delete obsolete code from `image-matcher.ts` and dead tests

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (delete orphaned exports)
- Delete: `worker/tests/services/image-matcher.derive.test.ts`
- Delete: `worker/tests/services/image-matcher.detect.test.ts`
- Delete: `worker/tests/services/image-matcher.mapping.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (purely subtractive)

- [ ] **Step 1: Remove obsolete exports from `image-matcher.ts`**

In `worker/src/services/image-matcher.ts`, **delete** the following declarations entirely:

1. The `deriveImageCategoryMap` function (replaced by `deriveImageTripleMap`).
2. The `DriveStructure` type alias.
3. The `decideDriveStructure` function.
4. The `detectDriveStructure` async function.
5. The `FolderCategoryMapping` interface.
6. The `CATEGORY_TABLE` constant.
7. The `buildFolderMappingPrompt` function.
8. The `validateFolderMappingResponse` function.
9. The `mapDriveFoldersToCategories` async function.

Then **prune unused imports** at the top of the file:
- Remove `listFiles` from the `google-drive.js` import (only used by `detectDriveStructure`).
- Remove `filterSubfolders` and `DriveSubfolder` from the `google-drive.js` import.
- Remove `runSessionWithStreaming` from the `session-streamer.js` import IF and only if `runVisionMatchForCategory` no longer uses it. **Verify by grepping for `runSessionWithStreaming` in the file**; keep the import if any caller remains. Same check for `extractJsonObject` from `ai-parser.js` — likely only used by `mapDriveFoldersToCategories` and can be removed; verify before removing.

After deletion, the import block at the top of `image-matcher.ts` should look like:

```typescript
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  downloadFile,
  listImagesRecursive,
  type DriveFile,
} from './google-drive.js';
import { runSessionWithStreaming } from './session-streamer.js';
import { getSupabase, uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';
import type { ParsedWeekly } from '../types/index.js';
```

(Keep `runSessionWithStreaming` — `runVisionMatchForCategory` uses it. Remove `extractJsonObject` import — it's only used by the deleted `mapDriveFoldersToCategories`.)

- [ ] **Step 2: Delete superseded test files**

Run:

```bash
rm /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.derive.test.ts \
   /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.detect.test.ts \
   /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.mapping.test.ts
```

- [ ] **Step 3: Verify the project compiles**

Run: `cd worker && npm run build`
Expected: `tsc` exits 0 with no errors.

- [ ] **Step 4: Run all tests**

Run: `cd worker && npm test`
Expected: 5 test files (parse-prefix, derive-triple, join, bucket, strategy) all PASS. Total ≈ 35 tests.

- [ ] **Step 5: Commit**

```bash
git add -u /Users/kaellim/Desktop/projects/library/worker/src/services/image-matcher.ts \
           /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.derive.test.ts \
           /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.detect.test.ts \
           /Users/kaellim/Desktop/projects/library/worker/tests/services/image-matcher.mapping.test.ts
git commit -m "$(cat <<'EOF'
refactor(image-matcher): remove obsolete AI folder-mapping code

Prefix-based matching makes detectDriveStructure /
mapDriveFoldersToCategories / buildFolderMappingPrompt /
validateFolderMappingResponse / CATEGORY_TABLE and the older
deriveImageCategoryMap helper redundant. Tests for the removed
functions deleted.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Delete subfolder helpers from `google-drive.ts`

**Files:**
- Modify: `worker/src/services/google-drive.ts` (delete dead exports)
- Delete: `worker/tests/services/google-drive.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Verify no remaining callers**

Run from repo root:

```bash
grep -rn -E "filterSubfolders|listSubfolders|DriveSubfolder" /Users/kaellim/Desktop/projects/library/worker/src
```

Expected output: only matches in `worker/src/services/google-drive.ts` itself (the declarations being deleted). If any caller remains, STOP and audit — do not delete.

- [ ] **Step 2: Remove the three declarations from `google-drive.ts`**

In `worker/src/services/google-drive.ts`, delete the following lines:

1. The `DriveSubfolder` interface
2. The `filterSubfolders` function
3. The `listSubfolders` async function

The file should end cleanly after the `downloadFile` function.

- [ ] **Step 3: Delete the obsolete test file**

Run:

```bash
rm /Users/kaellim/Desktop/projects/library/worker/tests/services/google-drive.test.ts
```

- [ ] **Step 4: Verify build and tests**

Run: `cd worker && npm run build && npm test`
Expected: `tsc` exits 0; all 5 remaining test files PASS (parse-prefix, derive-triple, join, bucket, strategy).

- [ ] **Step 5: Commit**

```bash
git add -u /Users/kaellim/Desktop/projects/library/worker/src/services/google-drive.ts \
           /Users/kaellim/Desktop/projects/library/worker/tests/services/google-drive.test.ts
git commit -m "$(cat <<'EOF'
refactor(google-drive): remove subfolder helpers

filterSubfolders / listSubfolders / DriveSubfolder only existed to
serve the deleted AI folder-mapping path. Prefix matching ignores
Drive structure entirely.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Manual e2e (user-side, cannot automate)

Implementation tasks complete after Task 8. The user must run these acceptance steps before deploying:

1. **Local dev verification with a fully-prefixed Drive folder**
   - Prepare a Google Drive folder containing 5+ images, all named `x-x-x.jpg` matching markdown structure
   - Trigger an import in dashboard
   - Query `audit_logs` for the most recent `action='image_match'` row
   - Expect: `metadata.strategy = 'prefix-only'`, `metadata.prefix_matched > 0`, `metadata.vision_matched = 0`

2. **Mixed scenario**
   - Rename one Drive file to `random.jpg`
   - Trigger import (or "從 Drive 補圖" on existing weekly)
   - Expect: `metadata.strategy = 'prefix-with-fallback'` OR `'vision-only'` (depending on if Vision finds it); `metadata.unparseable_high_res` should contain the renamed file's name

3. **Degenerate scenarios**
   - Empty Drive folder → `strategy: 'skipped-no-drive-images'`
   - Drive with files but markdown has zero image refs (e.g., a draft week with no body) → `strategy: 'skipped-no-low-res'`

4. **"從 Drive 補圖" button parity**
   - On any existing weekly, click the "從 Drive 補圖" button in the detail page
   - Verify the same audit log shape and behavior as the import flow

5. **Deploy**

```bash
ssh kaelsohappy1@192.168.2.235 'cd ~/library && git pull && cd supabase-docker && docker compose up -d --build worker'
```

---

## Self-Review Notes

Spec coverage check:
- §3 (why this beats per-category Vision) — informational; no task
- §4 (pipeline change) — Task 6
- §5.1.1 derive — Task 2
- §5.1.2 parse — Task 1
- §5.1.3 join — Task 3
- §5.1.4 apply — Task 6 (inside orchestrator)
- §5.2 bucket + Vision fallback — Task 4 + Task 6
- §5.3 orchestrator — Task 6
- §6 audit log + strategy — Task 5 (logic) + Task 6 (write side)
- §7.1 modify list — Task 6
- §7.2 delete list — Tasks 7, 8
- §7.3 new tests — Tasks 1-5
- §7.4 callers — Task 6
- §8 edge cases — Tested in Tasks 1-5; orchestrator covers them in Task 6
- §10 test plan — Tasks 1-5 unit; Task 9 manual e2e
- §11 rollout — Task 9

Type consistency check:
- `ImageTriple` defined Task 2, used Tasks 3, 4
- `OrphanLow` / `OrphanHigh` / `JoinOutcome` defined Task 3, used Task 4, 6
- `OrphanBuckets` defined Task 4, used Task 6
- `MatchStrategy` defined Task 5, used Task 6 (in `PerCategoryMatchOutcome`)
- `PerCategoryMatchOutcome` shape redefined Task 6; callers in same task pivot to new fields
- `matchAndReplacePerCategory` signature preserved — only the returned object's fields differ; caller call-site is unchanged

No placeholders remaining; every step contains either complete code, an exact shell command, or a precise edit instruction with the surrounding code visible.
