# Per-category Image Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce image-matching error rate from ~10% to <2% by narrowing the AI Vision candidate set to a single Drive subfolder per category, using `ai_parsing` output as the authoritative image→category source.

**Architecture:** Reorder pipeline so `replacing_images` runs after `ai_parsing`. New Drive convention: 8 subfolders, AI maps each subfolder name to a category_id (1–8). For each category, AI Vision compares only the low-res images in that category against only the high-res images in the matching Drive subfolder. Strict fallback: if Drive lacks the subfolder structure or mapping fails, skip high-res replacement entirely (no more "global match" path — it is the source of the bug being fixed).

**Tech Stack:** Node.js 22+ / TypeScript 5.7 / Fastify / `@anthropic-ai/claude-agent-sdk` (model alias `'opus'`) / `runSessionWithStreaming` helper / Supabase / Google Drive v3 API / vitest (new, for unit tests).

## Global Constraints

- **Model**: every AI call uses alias `'opus'` (do not pin a version ID — retired aliases broke #140 previously).
- **SDK**: use `@anthropic-ai/claude-agent-sdk` (`query()`) via the existing `runSessionWithStreaming` wrapper — never import `@anthropic-ai/sdk`.
- **ESM imports**: all internal imports use `.js` extension (`import { foo } from './bar.js'`) — TS compiles to ESM output.
- **TypeScript**: project is `"strict": true`. New code must pass `npx tsc --noEmit` with zero new warnings.
- **Category IDs**: fixed 1–8, must match `parse-weekly` skill's table. Do not create new categories.
- **Spec reference**: `docs/superpowers/specs/2026-06-23-per-category-image-matching-design.md` is the source of truth for behaviour decisions.
- **Test files** live in `worker/tests/` (outside `src/`) so they are not picked up by `tsc` build. The build's `include: ["src/**/*"]` and `rootDir: "./src"` already exclude them.

---

### Task 1: Add vitest test infrastructure

**Files:**
- Modify: `worker/package.json`
- Create: `worker/vitest.config.ts`
- Create: `worker/tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs vitest; new tests under `worker/tests/**/*.test.ts` are auto-discovered.

- [ ] **Step 1: Install vitest as a devDependency**

Run:
```bash
cd worker && npm install -D vitest@^2
```

Expected: vitest added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create `worker/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add `test` script to `worker/package.json`**

Edit the `"scripts"` block, adding the `test` line (preserve existing scripts):
```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "import": "tsx src/index.ts",
  "test": "vitest run"
}
```

- [ ] **Step 4: Create `worker/tests/smoke.test.ts` to verify infra**

```ts
import { describe, it, expect } from 'vitest';

describe('vitest infra smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run:
```bash
cd worker && npm test
```

Expected output: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/vitest.config.ts worker/tests/smoke.test.ts
git commit -m "test(worker): add vitest infrastructure"
```

---

### Task 2: Add `filterSubfolders` (pure) and `listSubfolders` (wrapper) to `google-drive.ts`

**Files:**
- Modify: `worker/src/services/google-drive.ts` (append)
- Create: `worker/tests/services/google-drive.test.ts`

**Interfaces:**
- Consumes: existing `DriveFile`, `listFiles(token, folderId)`.
- Produces:
  - `interface DriveSubfolder { id: string; name: string }`
  - `function filterSubfolders(files: DriveFile[]): DriveSubfolder[]` (pure)
  - `async function listSubfolders(token: string, parentId: string): Promise<DriveSubfolder[]>` (IO wrapper)

- [ ] **Step 1: Write failing test for `filterSubfolders`**

Create `worker/tests/services/google-drive.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { filterSubfolders } from '../../src/services/google-drive.js';

describe('filterSubfolders', () => {
  it('returns only folder mime-type entries with id+name', () => {
    const files = [
      { id: 'f1', name: '一版全球焦點', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'i1', name: 'photo.jpg', mimeType: 'image/jpeg' },
      { id: 'f2', name: '二版上人開示', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'd1', name: 'doc.pdf', mimeType: 'application/pdf' },
    ];
    expect(filterSubfolders(files)).toEqual([
      { id: 'f1', name: '一版全球焦點' },
      { id: 'f2', name: '二版上人開示' },
    ]);
  });

  it('returns empty array when no folders present', () => {
    const files = [{ id: 'i1', name: 'a.jpg', mimeType: 'image/jpeg' }];
    expect(filterSubfolders(files)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd worker && npm test -- google-drive
```
Expected: FAIL with "filterSubfolders is not exported" or similar.

- [ ] **Step 3: Add `DriveSubfolder`, `filterSubfolders`, `listSubfolders` to `google-drive.ts`**

Append to `worker/src/services/google-drive.ts`:
```ts
export interface DriveSubfolder {
  id: string;
  name: string;
}

/**
 * 從 DriveFile 清單過濾出子資料夾。純函式，便於測試。
 */
export function filterSubfolders(files: DriveFile[]): DriveSubfolder[] {
  return files
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
    .map(({ id, name }) => ({ id, name }));
}

/**
 * 列出指定 Drive 資料夾的直接子資料夾（不遞迴）。
 */
export async function listSubfolders(token: string, parentId: string): Promise<DriveSubfolder[]> {
  return filterSubfolders(await listFiles(token, parentId));
}
```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd worker && npm test -- google-drive
```
Expected: `2 passed`.

- [ ] **Step 5: Run typecheck**

Run:
```bash
cd worker && npx tsc --noEmit
```
Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/services/google-drive.ts worker/tests/services/google-drive.test.ts
git commit -m "feat(drive): add listSubfolders + filterSubfolders helper"
```

---

### Task 3: Add `deriveImageCategoryMap` (pure) to `image-matcher.ts`

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (append, do NOT delete existing yet)
- Create: `worker/tests/services/image-matcher.derive.test.ts`

**Interfaces:**
- Consumes: `ParsedWeekly` from `../types/index.js`.
- Produces: `function deriveImageCategoryMap(parsed: ParsedWeekly): Map<string, number>` — maps `image_filename` to `category_id`.

- [ ] **Step 1: Write failing test**

Create `worker/tests/services/image-matcher.derive.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveImageCategoryMap } from '../../src/services/image-matcher.js';
import type { ParsedWeekly } from '../../src/types/index.js';

describe('deriveImageCategoryMap', () => {
  it('maps each image filename to the category of its article', () => {
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
                '文字 ![alt1](/storage/v1/object/public/weekly/articles/140/images/image1.jpg) 更多文字 ![alt2](/storage/v1/object/public/weekly/articles/140/images/image2.png)',
            },
          ],
        },
        {
          category_id: 3,
          name: '慈濟要聞',
          sort_order: 3,
          articles: [
            {
              title: 'B',
              content: '![](/storage/v1/object/public/weekly/articles/140/images/image7.jpg)',
            },
          ],
        },
      ],
    };
    const map = deriveImageCategoryMap(parsed);
    expect(map.get('image1.jpg')).toBe(1);
    expect(map.get('image2.png')).toBe(1);
    expect(map.get('image7.jpg')).toBe(3);
    expect(map.size).toBe(3);
  });

  it('ignores duplicate occurrences — first article wins', () => {
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
    expect(deriveImageCategoryMap(parsed).get('image9.jpg')).toBe(2);
  });

  it('returns empty map when there are no images', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        { category_id: 1, name: 'X', sort_order: 1, articles: [{ title: 'A', content: 'no images' }] },
      ],
    };
    expect(deriveImageCategoryMap(parsed).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd worker && npm test -- derive
```
Expected: FAIL with "deriveImageCategoryMap is not exported".

- [ ] **Step 3: Implement `deriveImageCategoryMap`**

Append to `worker/src/services/image-matcher.ts` (keep existing `matchAndReplaceImages` for now):
```ts
import type { ParsedWeekly } from '../types/index.js';

const IMAGE_FILENAME_REGEX = /\/images\/(image\d+\.\w+)\)/g;

/**
 * 從 parse 結果推導每張低解析度圖對應的 category_id。
 * 同一檔名出現在多版時，第一次出現的 category 勝出（regex 順序）。
 */
export function deriveImageCategoryMap(parsed: ParsedWeekly): Map<string, number> {
  const map = new Map<string, number>();
  for (const category of parsed.categories) {
    for (const article of category.articles) {
      IMAGE_FILENAME_REGEX.lastIndex = 0;
      let match;
      while ((match = IMAGE_FILENAME_REGEX.exec(article.content)) !== null) {
        const filename = match[1];
        if (!map.has(filename)) {
          map.set(filename, category.category_id);
        }
      }
    }
  }
  return map;
}
```

Note: `ParsedWeekly` import may already exist in this file via the existing code; if so, do not add a duplicate import — extend the existing one.

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd worker && npm test -- derive
```
Expected: `3 passed`.

- [ ] **Step 5: Run typecheck**

Run:
```bash
cd worker && npx tsc --noEmit
```
Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/services/image-matcher.ts worker/tests/services/image-matcher.derive.test.ts
git commit -m "feat(image-matcher): add deriveImageCategoryMap pure helper"
```

---

### Task 4: Add Drive structure types + `decideDriveStructure` (pure) + `detectDriveStructure` (wrapper)

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (append)
- Create: `worker/tests/services/image-matcher.detect.test.ts`

**Interfaces:**
- Consumes: `DriveFile`, `DriveSubfolder`, `listFiles` from `./google-drive.js` (Task 2).
- Produces:
  - `type DriveStructure = { mode: 'categorized'; subfolders: DriveSubfolder[] } | { mode: 'flat'; reason: string }`
  - `function decideDriveStructure(files: DriveFile[]): DriveStructure` (pure)
  - `async function detectDriveStructure(token: string, rootFolderId: string): Promise<DriveStructure>` (wrapper)

Decision rules (matching spec §6.1):
- 子資料夾 ≥ 2 個 **且** 根目錄沒有圖檔散落 → `categorized`
- 否則 → `flat` with reason

- [ ] **Step 1: Write failing tests**

Create `worker/tests/services/image-matcher.detect.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decideDriveStructure } from '../../src/services/image-matcher.js';

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: 'application/vnd.google-apps.folder',
});
const image = (id: string, name: string) => ({ id, name, mimeType: 'image/jpeg' });

describe('decideDriveStructure', () => {
  it('returns categorized when 2+ subfolders and no root-level images', () => {
    const result = decideDriveStructure([
      folder('f1', '一版全球焦點'),
      folder('f2', '二版上人開示'),
    ]);
    expect(result.mode).toBe('categorized');
    if (result.mode === 'categorized') {
      expect(result.subfolders).toHaveLength(2);
      expect(result.subfolders.map((s) => s.name)).toEqual(['一版全球焦點', '二版上人開示']);
    }
  });

  it('returns flat when subfolders < 2', () => {
    const result = decideDriveStructure([folder('f1', '只有一個資料夾')]);
    expect(result.mode).toBe('flat');
    if (result.mode === 'flat') expect(result.reason).toMatch(/子資料夾不足/);
  });

  it('returns flat when root has images mixed with subfolders', () => {
    const result = decideDriveStructure([
      folder('f1', '一版'),
      folder('f2', '二版'),
      image('i1', 'stray.jpg'),
    ]);
    expect(result.mode).toBe('flat');
    if (result.mode === 'flat') expect(result.reason).toMatch(/根目錄/);
  });

  it('returns flat when root has only images', () => {
    const result = decideDriveStructure([image('i1', 'a.jpg'), image('i2', 'b.jpg')]);
    expect(result.mode).toBe('flat');
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run:
```bash
cd worker && npm test -- detect
```
Expected: FAIL with "decideDriveStructure is not exported".

- [ ] **Step 3: Implement types and `decideDriveStructure`**

Append to `worker/src/services/image-matcher.ts`:
```ts
import { listFiles, type DriveFile, type DriveSubfolder, filterSubfolders } from './google-drive.js';

export type DriveStructure =
  | { mode: 'categorized'; subfolders: DriveSubfolder[] }
  | { mode: 'flat'; reason: string };

/**
 * 純函式：給 root 資料夾的直接子項清單，決定結構是 categorized 還是 flat。
 */
export function decideDriveStructure(files: DriveFile[]): DriveStructure {
  const subfolders = filterSubfolders(files);
  const rootImages = files.filter((f) => f.mimeType.startsWith('image/'));

  if (subfolders.length < 2) {
    return { mode: 'flat', reason: `子資料夾不足（${subfolders.length}）` };
  }
  if (rootImages.length > 0) {
    return { mode: 'flat', reason: `根目錄混有 ${rootImages.length} 張圖檔` };
  }
  return { mode: 'categorized', subfolders };
}

/**
 * IO 包裝：呼叫 Drive API 取得 root 子項，然後交給 decideDriveStructure 判斷。
 */
export async function detectDriveStructure(
  token: string,
  rootFolderId: string,
): Promise<DriveStructure> {
  const files = await listFiles(token, rootFolderId);
  return decideDriveStructure(files);
}
```

Note: the existing `image-matcher.ts` already imports from `./google-drive.js` — extend the existing import line instead of adding a new one. Existing has `import { downloadFile, listImagesRecursive, type DriveFile } from './google-drive.js';` — add `listFiles`, `filterSubfolders`, and `type DriveSubfolder` to it.

- [ ] **Step 4: Run, verify pass**

Run:
```bash
cd worker && npm test -- detect
```
Expected: `4 passed`.

- [ ] **Step 5: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/services/image-matcher.ts worker/tests/services/image-matcher.detect.test.ts
git commit -m "feat(image-matcher): add Drive structure detection (pure + wrapper)"
```

---

### Task 5: Add folder-mapping validator + prompt builder (pure)

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (append)
- Create: `worker/tests/services/image-matcher.mapping.test.ts`

**Interfaces:**
- Consumes: `DriveSubfolder` from `./google-drive.js`.
- Produces:
  - `interface FolderCategoryMapping { mappings: Map<string, number>; unmapped: string[] }`
  - `function buildFolderMappingPrompt(subfolders: DriveSubfolder[]): string` (pure)
  - `function validateFolderMappingResponse(raw: unknown, allFolderIds: string[]): FolderCategoryMapping` (pure)

Validation rules (matching spec §6.2):
- `category_id` must be integer in `[1, 8]`; out-of-range → push folder_id to `unmapped`
- duplicate `category_id` across mappings → all colliding folders go to `unmapped` (the safer choice — none win)
- folder_id appearing in `mappings` AND `unmapped` from AI → treat as unmapped (defensive)
- folder_id missing from AI response → unmapped

- [ ] **Step 1: Write failing tests**

Create `worker/tests/services/image-matcher.mapping.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  buildFolderMappingPrompt,
  validateFolderMappingResponse,
} from '../../src/services/image-matcher.js';

describe('buildFolderMappingPrompt', () => {
  it('embeds all subfolder ids+names and the 1-8 category table', () => {
    const prompt = buildFolderMappingPrompt([
      { id: 'fA', name: '一版全球焦點' },
      { id: 'fB', name: '二版 上人開示' },
    ]);
    expect(prompt).toContain('fA');
    expect(prompt).toContain('一版全球焦點');
    expect(prompt).toContain('fB');
    expect(prompt).toContain('證嚴上人開示'); // category 2 reference name
    expect(prompt).toMatch(/category_id/i);
  });
});

describe('validateFolderMappingResponse', () => {
  const ids = ['fA', 'fB', 'fC'];

  it('accepts valid response', () => {
    const raw = {
      mappings: [
        { folder_id: 'fA', category_id: 1 },
        { folder_id: 'fB', category_id: 2 },
      ],
      unmapped: ['fC'],
    };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.mappings.get('fA')).toBe(1);
    expect(result.mappings.get('fB')).toBe(2);
    expect(result.unmapped).toEqual(['fC']);
  });

  it('drops out-of-range category_id to unmapped', () => {
    const raw = {
      mappings: [
        { folder_id: 'fA', category_id: 1 },
        { folder_id: 'fB', category_id: 99 },
      ],
      unmapped: [],
    };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.mappings.has('fB')).toBe(false);
    expect(result.unmapped).toContain('fB');
  });

  it('drops duplicate category_id collisions (all losers)', () => {
    const raw = {
      mappings: [
        { folder_id: 'fA', category_id: 3 },
        { folder_id: 'fB', category_id: 3 },
        { folder_id: 'fC', category_id: 5 },
      ],
      unmapped: [],
    };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.mappings.has('fA')).toBe(false);
    expect(result.mappings.has('fB')).toBe(false);
    expect(result.mappings.get('fC')).toBe(5);
    expect(result.unmapped).toEqual(expect.arrayContaining(['fA', 'fB']));
  });

  it('treats folder_ids missing from AI response as unmapped', () => {
    const raw = { mappings: [{ folder_id: 'fA', category_id: 1 }], unmapped: [] };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.unmapped).toEqual(expect.arrayContaining(['fB', 'fC']));
  });

  it('treats non-object input as fully unmapped', () => {
    const result = validateFolderMappingResponse('not a mapping', ids);
    expect(result.mappings.size).toBe(0);
    expect(result.unmapped).toEqual(ids);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run:
```bash
cd worker && npm test -- mapping
```
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement validator + prompt builder**

Append to `worker/src/services/image-matcher.ts`:
```ts
export interface FolderCategoryMapping {
  mappings: Map<string, number>;
  unmapped: string[];
}

const CATEGORY_TABLE = [
  { id: 1, name: '全球焦點' },
  { id: 2, name: '證嚴上人開示' },
  { id: 3, name: '慈濟要聞' },
  { id: 4, name: '慈善志業要聞' },
  { id: 5, name: '里仁為美' },
  { id: 6, name: '大醫行願' },
  { id: 7, name: '春風化雨' },
  { id: 8, name: '人文馨香' },
];

/**
 * 純函式：根據子資料夾清單組出給 AI 的 prompt。
 */
export function buildFolderMappingPrompt(subfolders: DriveSubfolder[]): string {
  const tableLines = CATEGORY_TABLE.map((c) => `| ${c.id} | ${c.name} |`).join('\n');
  const folderLines = subfolders.map((f) => `- ${f.id}: "${f.name}"`).join('\n');

  return `你要把 Google Drive 子資料夾名稱對應到慈濟週報的 8 個固定 category_id。

對照表（必須使用其中之一，不可新建）：
| category_id | name |
|-------------|------|
${tableLines}

子資料夾命名可能包含版次（一版/二版/...）、分類名稱、狀態標記（完稿/定稿）等變體。請語意判斷，每個 folder_id 對應一個 category_id (1-8)；同一 category_id 不可被多個 folder 同時對到。無法判斷請列入 unmapped。

子資料夾清單：
${folderLines}

CRITICAL OUTPUT CONTRACT:
- 整段回應必須是單一 JSON 物件，第一個字元 \`{\`，最後一個字元 \`}\`。
- 不可有 prose、code fence、說明文字。

輸出格式：
{"mappings":[{"folder_id":"...","category_id":1},...],"unmapped":["folder_id_x",...]}`;
}

/**
 * 純函式：驗證 AI 回傳的 mapping，回傳安全的對應表。
 * - category_id 超出 1-8 → unmapped
 * - 重複的 category_id → 所有衝突 folder 全進 unmapped
 * - AI 漏掉的 folder_id → unmapped
 */
export function validateFolderMappingResponse(
  raw: unknown,
  allFolderIds: string[],
): FolderCategoryMapping {
  const empty: FolderCategoryMapping = { mappings: new Map(), unmapped: [...allFolderIds] };
  if (!raw || typeof raw !== 'object') return empty;
  const rawObj = raw as { mappings?: unknown; unmapped?: unknown };
  const rawMappings = Array.isArray(rawObj.mappings) ? rawObj.mappings : [];
  const rawUnmapped = Array.isArray(rawObj.unmapped) ? rawObj.unmapped : [];

  // Phase 1: collect valid (folder_id, category_id) pairs
  const candidates: Array<{ folder_id: string; category_id: number }> = [];
  const explicitlyUnmapped = new Set<string>();
  for (const u of rawUnmapped) {
    if (typeof u === 'string') explicitlyUnmapped.add(u);
  }

  for (const entry of rawMappings) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { folder_id?: unknown; category_id?: unknown };
    if (typeof e.folder_id !== 'string') continue;
    if (typeof e.category_id !== 'number' || !Number.isInteger(e.category_id)) continue;
    if (e.category_id < 1 || e.category_id > 8) continue;
    if (!allFolderIds.includes(e.folder_id)) continue;
    if (explicitlyUnmapped.has(e.folder_id)) continue;
    candidates.push({ folder_id: e.folder_id, category_id: e.category_id });
  }

  // Phase 2: detect category_id collisions; collisions exclude ALL involved folders
  const categoryCount = new Map<number, number>();
  for (const c of candidates) {
    categoryCount.set(c.category_id, (categoryCount.get(c.category_id) ?? 0) + 1);
  }
  const mappings = new Map<string, number>();
  const collisionFolders = new Set<string>();
  for (const c of candidates) {
    if ((categoryCount.get(c.category_id) ?? 0) > 1) {
      collisionFolders.add(c.folder_id);
    } else {
      mappings.set(c.folder_id, c.category_id);
    }
  }

  // Phase 3: build unmapped — every folder not in mappings
  const unmapped = allFolderIds.filter((id) => !mappings.has(id));

  return { mappings, unmapped };
}
```

- [ ] **Step 4: Run, verify pass**

Run:
```bash
cd worker && npm test -- mapping
```
Expected: `6 passed`.

- [ ] **Step 5: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/services/image-matcher.ts worker/tests/services/image-matcher.mapping.test.ts
git commit -m "feat(image-matcher): add folder mapping prompt + validator"
```

---

### Task 6: Add `mapDriveFoldersToCategories` AI wrapper

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (append)

**Interfaces:**
- Consumes: `runSessionWithStreaming` from `./session-streamer.js`; `buildFolderMappingPrompt`, `validateFolderMappingResponse` (Task 5); `DriveSubfolder` from `./google-drive.js`.
- Produces: `async function mapDriveFoldersToCategories(subfolders: DriveSubfolder[], weeklyId: number): Promise<FolderCategoryMapping>`

This task has no unit test — the function is glue between two already-tested pieces (prompt builder + validator) and the AI SDK. Verification happens in Task 11 (end-to-end with weekly #140).

- [ ] **Step 1: Reuse `extractJsonObject` from `ai-parser.ts` by exporting it**

The robust JSON extraction logic added in commit `a7dc3a9` lives in `ai-parser.ts`. Make it exportable so this task can reuse it (DRY):

In `worker/src/services/ai-parser.ts`, change the function signature from internal to `export`:
```ts
// Before:
function extractJsonObject(raw: string): string {

// After:
export function extractJsonObject(raw: string): string {
```

- [ ] **Step 2: Implement `mapDriveFoldersToCategories`**

Append to `worker/src/services/image-matcher.ts`:
```ts
import { runSessionWithStreaming } from './session-streamer.js';
import { extractJsonObject } from './ai-parser.js';

/**
 * 呼叫 AI 將 Drive 子資料夾名稱對應到 category_id (1-8)。
 * AI 回傳 JSON 後經 validateFolderMappingResponse 嚴格驗證。
 */
export async function mapDriveFoldersToCategories(
  subfolders: DriveSubfolder[],
  weeklyId: number,
): Promise<FolderCategoryMapping> {
  if (subfolders.length === 0) {
    return { mappings: new Map(), unmapped: [] };
  }

  const prompt = buildFolderMappingPrompt(subfolders);
  const resultText = await runSessionWithStreaming(prompt, {
    weeklyId,
    model: 'opus',
  });

  if (!resultText) {
    console.error('[image-matcher] folder mapping: empty AI response');
    return { mappings: new Map(), unmapped: subfolders.map((f) => f.id) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(resultText));
  } catch (err) {
    console.error('[image-matcher] folder mapping: JSON parse failed');
    console.error('AI response preview (first 500 chars):', resultText.substring(0, 500));
    return { mappings: new Map(), unmapped: subfolders.map((f) => f.id) };
  }

  return validateFolderMappingResponse(
    parsed,
    subfolders.map((f) => f.id),
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: zero new errors. Re-run test suite to ensure nothing broke:
```bash
cd worker && npm test
```
Expected: all earlier tests still pass.

- [ ] **Step 4: Commit**

```bash
git add worker/src/services/image-matcher.ts worker/src/services/ai-parser.ts
git commit -m "feat(image-matcher): add mapDriveFoldersToCategories AI wrapper"
```

---

### Task 7: Extract `runVisionMatchForCategory` from existing Vision logic

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (append; do NOT delete existing `matchAndReplaceImages` yet — Task 10 deletes it)

**Interfaces:**
- Consumes: existing infrastructure used by `matchAndReplaceImages` — `downloadFile`, `compressImage`, `uploadImage`, `runSessionWithStreaming`, `getSupabase`, `mkdirSync`/`writeFileSync`/`rmSync`, the existing `MatchResult` shape.
- Produces:
  - `interface CategoryMatchResult { replaced: number; skipped: number; driveFolderId: string }`
  - `async function runVisionMatchForCategory(args: { weeklyId: number; categoryId: number; lowFilenames: string[]; highFiles: DriveFile[]; providerToken: string; onProgress?: (msg: string) => void; }): Promise<CategoryMatchResult>`

Behaviour (translated from existing `matchAndReplaceImages` — same prompt, same confidence policy `high+medium` replace, `low` skip):
- Download low-res from Storage to `/tmp/image-match-{weeklyId}-cat{categoryId}/low/`
- Download high-res from Drive to `/tmp/image-match-{weeklyId}-cat{categoryId}/high/` (filename prefix `{driveFileId}_`)
- Call AI Vision with the same prompt as existing, but narrowed to this category
- Replace `high`+`medium` confidence matches; skip `low`
- Cleanup `/tmp` dir at end (try/finally)

- [ ] **Step 1: Implement `runVisionMatchForCategory`**

Append to `worker/src/services/image-matcher.ts`:
```ts
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { downloadFile } from './google-drive.js';
import { uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';

export interface CategoryMatchResult {
  replaced: number;
  skipped: number;
  driveFolderId: string;
}

interface VisionMatchEntry {
  storage_filename: string;
  drive_file_id: string;
  drive_file_name: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 對單一 category 進行 Vision 比對與替換。
 * lowFilenames：該 category 的低解析度檔名（已存在 Storage）
 * highFiles：該 category 對應的 Drive 子資料夾下的高解析度圖
 */
export async function runVisionMatchForCategory(args: {
  weeklyId: number;
  categoryId: number;
  lowFilenames: string[];
  highFiles: DriveFile[];
  providerToken: string;
  onProgress?: (msg: string) => void;
}): Promise<CategoryMatchResult> {
  const { weeklyId, categoryId, lowFilenames, highFiles, providerToken, onProgress } = args;

  if (lowFilenames.length === 0 || highFiles.length === 0) {
    return { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
  }

  const tmpDir = join('/tmp', `image-match-${weeklyId}-cat${categoryId}`);
  const lowDir = join(tmpDir, 'low');
  const highDir = join(tmpDir, 'high');

  try {
    mkdirSync(lowDir, { recursive: true });
    mkdirSync(highDir, { recursive: true });

    // Download low-res from Storage
    for (const filename of lowFilenames) {
      const path = `articles/${weeklyId}/images/${filename}`;
      const { data, error } = await getSupabase().storage.from('weekly').download(path);
      if (error) throw new Error(`Storage download error (${filename}): ${error.message}`);
      writeFileSync(join(lowDir, filename), Buffer.from(await data.arrayBuffer()));
    }

    // Download high-res from Drive
    const driveBufferMap = new Map<string, { file: DriveFile; buffer: Buffer }>();
    for (const file of highFiles) {
      const buffer = await downloadFile(providerToken, file.id);
      const safeFilename = `${file.id}_${file.name}`;
      writeFileSync(join(highDir, safeFilename), buffer);
      driveBufferMap.set(file.id, { file, buffer });
    }

    onProgress?.(`category ${categoryId}: AI 比對 ${lowFilenames.length} 張 vs ${highFiles.length} 張`);

    const lowList = lowFilenames.join(', ');
    const highList = highFiles.map((f) => `${f.id}_${f.name}`).join(', ');

    const prompt = `You are an image matching assistant. Match each low-resolution image with its high-resolution original.

## Directories

- Low-resolution images: ${lowDir}/
  Files: ${lowList}

- High-resolution images: ${highDir}/
  Files: ${highList}

## Instructions

CRITICAL: To minimize turns, issue MULTIPLE Read tool calls in parallel (up to 10 per response). Do NOT read images one at a time. After reading all images, output the final JSON in one response.

1. Use Read tool with parallel calls to view images in both directories.
2. Compare visually and match each low-res image to its high-res counterpart.
3. High-res filenames are formatted: {driveFileId}_{originalName}

Output ONLY a JSON array (no other text) when matching is complete:
[{"storage_filename":"image1.png","drive_file_id":"the-drive-id-part-before-underscore","drive_file_name":"originalName.jpg","confidence":"high"}]

Rules:
- confidence: "high" (clearly same image), "medium" (likely same), "low" (uncertain)
- If no match exists, omit that image
- Each high-res image can only match one low-res image`;

    const totalImages = lowFilenames.length + highFiles.length;
    const estimatedTurns = Math.max(20, Math.ceil(totalImages / 3) + 10);

    const result = await runSessionWithStreaming(prompt, {
      weeklyId,
      model: 'opus',
      maxTurns: estimatedTurns,
      allowedTools: ['Read', 'Glob'],
    });

    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.warn(`[image-matcher cat${categoryId}] No JSON in Vision response`);
      return { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
    }

    let mappings: VisionMatchEntry[];
    try {
      mappings = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`[image-matcher cat${categoryId}] JSON parse error`);
      return { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
    }

    let replaced = 0;
    for (const m of mappings) {
      if (m.confidence === 'low') continue;
      const driveImage = driveBufferMap.get(m.drive_file_id);
      if (!driveImage) continue;
      onProgress?.(`category ${categoryId}: 替換 ${m.storage_filename} → ${m.drive_file_name}`);
      const compressed = await compressImage(driveImage.buffer, driveImage.file.mimeType);
      await uploadImage(weeklyId, m.storage_filename, compressed.buffer, compressed.mimeType);
      replaced++;
    }

    return { replaced, skipped: lowFilenames.length - replaced, driveFolderId: '' };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[image-matcher cat${categoryId}] cleanup failed:`, err);
    }
  }
}
```

Notes:
- `getSupabase` import: extend the existing top-of-file import `import { getSupabase, uploadImage } from './supabase.js'` (or add it — check what `image-matcher.ts` currently has).
- Do NOT delete or modify `matchAndReplaceImages` in this task; coexistence is fine.

- [ ] **Step 2: Typecheck + existing tests**

Run:
```bash
cd worker && npx tsc --noEmit && npm test
```
Expected: zero new errors; all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add worker/src/services/image-matcher.ts
git commit -m "feat(image-matcher): add runVisionMatchForCategory"
```

---

### Task 8: Add `matchAndReplacePerCategory` orchestrator

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (append)

**Interfaces:**
- Consumes: `detectDriveStructure`, `mapDriveFoldersToCategories`, `deriveImageCategoryMap`, `runVisionMatchForCategory`, `listImagesRecursive`.
- Produces:
  - `interface PerCategoryMatchOutcome { totalReplaced: number; perCategory: Record<number, CategoryMatchResult>; strategy: 'per-category' | 'skipped-flat' | 'skipped-mapping-failed'; folderMapping: Record<string, number>; unmappedFolders: string[]; driveStructure: { mode: 'categorized'; subfoldersCount: number } | { mode: 'flat'; reason: string }; }`
  - `async function matchAndReplacePerCategory(options: { weeklyId: number; parsed: ParsedWeekly; providerToken: string; driveFolderId: string; onProgress?: (msg: string) => void; }): Promise<PerCategoryMatchOutcome>`

`perCategory` uses `Record<number, CategoryMatchResult>` (plain object) instead of `Map` so it serialises cleanly to JSON for the audit log.

- [ ] **Step 1: Implement orchestrator**

Append to `worker/src/services/image-matcher.ts`:
```ts
export interface PerCategoryMatchOutcome {
  totalReplaced: number;
  perCategory: Record<number, CategoryMatchResult>;
  strategy: 'per-category' | 'skipped-flat' | 'skipped-mapping-failed';
  folderMapping: Record<string, number>;
  unmappedFolders: string[];
  driveStructure:
    | { mode: 'categorized'; subfoldersCount: number }
    | { mode: 'flat'; reason: string };
}

/**
 * 主入口：分類別逐版比對。失敗時嚴格 fallback（跳過替換，保留低解析度）。
 */
export async function matchAndReplacePerCategory(options: {
  weeklyId: number;
  parsed: ParsedWeekly;
  providerToken: string;
  driveFolderId: string;
  onProgress?: (msg: string) => void;
}): Promise<PerCategoryMatchOutcome> {
  const { weeklyId, parsed, providerToken, driveFolderId, onProgress } = options;

  onProgress?.('偵測 Drive 結構...');
  const structure = await detectDriveStructure(providerToken, driveFolderId);

  if (structure.mode === 'flat') {
    onProgress?.(`Drive 為平鋪結構（${structure.reason}），跳過高解析度替換`);
    return {
      totalReplaced: 0,
      perCategory: {},
      strategy: 'skipped-flat',
      folderMapping: {},
      unmappedFolders: [],
      driveStructure: structure,
    };
  }

  onProgress?.(`AI 對應 ${structure.subfolders.length} 個子資料夾到分類...`);
  const mapping = await mapDriveFoldersToCategories(structure.subfolders, weeklyId);

  if (mapping.mappings.size === 0) {
    onProgress?.('AI 無法對應任何子資料夾到分類，跳過');
    return {
      totalReplaced: 0,
      perCategory: {},
      strategy: 'skipped-mapping-failed',
      folderMapping: {},
      unmappedFolders: mapping.unmapped,
      driveStructure: { mode: 'categorized', subfoldersCount: structure.subfolders.length },
    };
  }

  const imageToCategory = deriveImageCategoryMap(parsed);
  const categoryToImages = new Map<number, string[]>();
  for (const [filename, catId] of imageToCategory) {
    if (!categoryToImages.has(catId)) categoryToImages.set(catId, []);
    categoryToImages.get(catId)!.push(filename);
  }

  const folderByCategory = new Map<number, string>();
  for (const [folderId, catId] of mapping.mappings) {
    folderByCategory.set(catId, folderId);
  }

  const perCategory: Record<number, CategoryMatchResult> = {};
  let totalReplaced = 0;

  for (const [catId, lowFilenames] of categoryToImages) {
    const folderId = folderByCategory.get(catId);
    if (!folderId) {
      onProgress?.(`分類 ${catId} 無對應 Drive 子資料夾，跳過 ${lowFilenames.length} 張`);
      perCategory[catId] = { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
      continue;
    }

    onProgress?.(`分類 ${catId}: 列出 Drive 高解析度圖...`);
    const highFiles = await listImagesRecursive(providerToken, folderId);
    if (highFiles.length === 0) {
      onProgress?.(`分類 ${catId} 的 Drive 資料夾沒有圖片`);
      perCategory[catId] = { replaced: 0, skipped: lowFilenames.length, driveFolderId: folderId };
      continue;
    }

    const result = await runVisionMatchForCategory({
      weeklyId,
      categoryId: catId,
      lowFilenames,
      highFiles,
      providerToken,
      onProgress,
    });
    perCategory[catId] = { ...result, driveFolderId: folderId };
    totalReplaced += result.replaced;
  }

  const folderMapping: Record<string, number> = {};
  for (const [folderId, catId] of mapping.mappings) {
    folderMapping[folderId] = catId;
  }

  return {
    totalReplaced,
    perCategory,
    strategy: 'per-category',
    folderMapping,
    unmappedFolders: mapping.unmapped,
    driveStructure: { mode: 'categorized', subfoldersCount: structure.subfolders.length },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd worker && npx tsc --noEmit && npm test`
Expected: zero new errors; all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add worker/src/services/image-matcher.ts
git commit -m "feat(image-matcher): add matchAndReplacePerCategory orchestrator"
```

---

### Task 9: Reorder `worker.ts` pipeline + write audit log

**Files:**
- Modify: `worker/src/worker.ts`

**Interfaces:**
- Consumes: `matchAndReplacePerCategory`, `parseWeeklyMarkdown`, `writeAuditLog`.
- Produces: pipeline order — `replacing_images` runs after `ai_parsing`. Audit log entry with `action: 'image_match'` after each import.

Existing `worker.ts` has the replacing_images block at lines ~110–158 (between `processAllImages` and `uploadMarkdown(weeklyId, 'original.md', ...)`). It must be removed from that position and inserted after `parseWeeklyMarkdown` (around line 166), before `generateCleanMarkdown` (line 170).

Also: the `AuditLog['action']` union does NOT currently include `'image_match'`. Either extend it OR write the audit log without that specific action and put the strategy in metadata under an existing action. Cleanest: extend the union.

- [ ] **Step 1: Extend `AuditLog['action']` union**

In `worker/src/types/index.ts` line 53, add `'image_match'`:
```ts
action: 'login' | 'logout' | 'insert' | 'update' | 'delete' | 'import' | 'ai_transform' | 'create_book' | 'update_book_cover' | 'upload_pdf' | 'batch_generate_descriptions' | 'batch_generate_thumbnails' | 'send_push' | 'image_match';
```

- [ ] **Step 2: Remove existing replacing_images block from `worker.ts`**

In `worker/src/worker.ts`, delete lines 110–158 (the entire `// 2.5 替換高解析度圖片` block, from `if (options.driveFolderUrl) {` through its closing `}`). After deletion, step 3 (`uploadMarkdown(weeklyId, 'original.md', markdownWithUrls)`) immediately follows step 2 (`processAllImages`).

- [ ] **Step 3: Insert new replacing_images block after `parseWeeklyMarkdown`**

In `worker/src/worker.ts`, after the line that assigns `parsed` (now around line ~118 after the deletion):
```ts
const parsed: ParsedWeekly = await parseWeeklyMarkdown(markdownWithUrls, weeklyId);
```

Insert immediately after:
```ts
    // 4.5 替換高解析度圖片（per-category）
    if (options.driveFolderUrl) {
      const driveFolderId = extractFolderId(options.driveFolderUrl);
      if (driveFolderId) {
        await updateProgress('replacing_images', '準備替換高解析度圖片...');

        let driveToken: string | null = null;
        let driveTokenSource = '';
        try {
          if (isServiceAccountConfigured()) {
            driveToken = await getServiceAccessToken();
            driveTokenSource = 'service_account';
          }
        } catch (err) {
          console.warn('[replacing_images] Service account token failed, fallback to user token:', err);
        }
        if (!driveToken && options.providerToken) {
          driveToken = options.providerToken;
          driveTokenSource = 'user_oauth';
        }

        if (!driveToken) {
          await updateProgress('replacing_images', '無 Drive 認證，跳過替換');
        } else {
          console.log(`[replacing_images] Using ${driveTokenSource} for Drive auth`);
          try {
            const outcome = await matchAndReplacePerCategory({
              weeklyId,
              parsed,
              providerToken: driveToken,
              driveFolderId,
              onProgress: async (msg) => updateProgress('replacing_images', msg),
            });
            console.log(
              `[replacing_images] strategy=${outcome.strategy}, replaced=${outcome.totalReplaced}`,
            );
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
                drive_structure: outcome.driveStructure,
                folder_mapping: outcome.folderMapping,
                unmapped_folders: outcome.unmappedFolders,
                per_category: outcome.perCategory,
                total_replaced: outcome.totalReplaced,
              },
            });
          } catch (err) {
            console.error('[replacing_images] Error:', err);
            await updateProgress('replacing_images', '圖片替換失敗，繼續匯入...');
          }
        }
      }
    }
```

- [ ] **Step 4: Update imports at top of `worker.ts`**

Change:
```ts
import { matchAndReplaceImages } from './services/image-matcher.js';
```
to:
```ts
import { matchAndReplacePerCategory } from './services/image-matcher.js';
```

- [ ] **Step 5: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: zero new errors. (The old `matchAndReplaceImages` is still exported from `image-matcher.ts` at this point — unused export is fine, gets removed in Task 10.)

- [ ] **Step 6: Build sanity check**

Run: `cd worker && npm run build`
Expected: builds cleanly. Then revert any dist/ changes (`git checkout worker/dist/` if dist is tracked — confirm with `git status` first):
```bash
cd worker && git status dist/ 2>&1 | head -5
```
If `dist/` is gitignored (likely), no action needed.

- [ ] **Step 7: Commit**

```bash
git add worker/src/worker.ts worker/src/types/index.ts
git commit -m "feat(worker): move replacing_images after ai_parsing; per-category match"
```

---

### Task 10: Remove obsolete `matchAndReplaceImages`

**Files:**
- Modify: `worker/src/services/image-matcher.ts` (delete obsolete function)

**Interfaces:**
- Consumes: none.
- Produces: cleaner `image-matcher.ts` with only the new API surface.

The old `matchAndReplaceImages` function (the original export at the top of `image-matcher.ts`) is no longer called anywhere after Task 9. Plus the legacy `MatchResult` interface and `extractImageFilenames`/`downloadStorageImage` helpers IF they are not used by the new code. Verify before deleting.

- [ ] **Step 1: Confirm `matchAndReplaceImages` has no remaining callers**

Run:
```bash
cd worker && grep -rn "matchAndReplaceImages" src/ tests/
```
Expected: only its own definition in `image-matcher.ts`. If any other call exists, do NOT proceed — investigate.

- [ ] **Step 2: Delete `matchAndReplaceImages` and unused helpers**

In `worker/src/services/image-matcher.ts`, delete:
- `interface MatchResult` (the one at the top — used only by old function)
- `function extractImageFilenames` (only used by old function)
- `function downloadStorageImage` (only used by old function)
- `export async function matchAndReplaceImages` (the entire function body)

Keep:
- All the new exports from Tasks 3–8 (`deriveImageCategoryMap`, `DriveStructure`, `decideDriveStructure`, `detectDriveStructure`, `FolderCategoryMapping`, `buildFolderMappingPrompt`, `validateFolderMappingResponse`, `mapDriveFoldersToCategories`, `CategoryMatchResult`, `runVisionMatchForCategory`, `PerCategoryMatchOutcome`, `matchAndReplacePerCategory`)
- All necessary imports (some used by both old and new — only remove imports that become unused after the deletion)

- [ ] **Step 3: Typecheck + test**

Run: `cd worker && npx tsc --noEmit && npm test`
Expected: zero errors; all tests pass; no "declared but not used" warnings from removed-and-orphaned imports.

- [ ] **Step 4: Build**

Run: `cd worker && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add worker/src/services/image-matcher.ts
git commit -m "refactor(image-matcher): remove obsolete global matchAndReplaceImages"
```

---

### Task 11: End-to-end verification with weekly #140 (and #136 if available)

**Files:**
- No file changes. Manual verification + push.

**Interfaces:**
- Consumes: a deployed Drive folder for weekly #140 (or test weekly) with **8 subfolders** named per category, each containing the relevant high-res images.

This task is a checkpoint — it does not produce code but validates the whole feature works before deploy.

- [ ] **Step 1: Verify the build**

Run: `cd worker && npm run build && npm test`
Expected: clean build, all tests pass.

- [ ] **Step 2: Tail logs while triggering an import locally**

Have the editor prepare a test Drive folder with 8 properly-named subfolders. Run `worker` locally:
```bash
cd worker && npm run dev
```

In another terminal, trigger a re-import for weekly #140 via the Dashboard or:
```bash
curl -X POST http://localhost:3001/api/v1/weekly/import \
  -H 'content-type: application/json' \
  -d '{"docId":"<docId>","weeklyId":140,"driveFolderUrl":"<url-with-8-subfolders>"}'
```

Watch dev console for:
- `[replacing_images]` lines showing `strategy=per-category`
- `category N: 替換 imageX.jpg → ...` lines for each replacement
- No "global match" log lines (the old path should never run)

- [ ] **Step 3: Verify audit log entry**

In Supabase Studio (`http://localhost:8000/studio/`), query `audit_logs`:
```sql
SELECT created_at, action, metadata
FROM audit_logs
WHERE action = 'image_match' AND metadata->>'weekly_id' = '140'
ORDER BY created_at DESC
LIMIT 1;
```
Expected: one row with `strategy=per-category`, populated `folder_mapping`, `per_category` showing per-category replace counts.

- [ ] **Step 4: Visual spot-check**

Open weekly #140's article that previously had a wrong image (e.g. image14.jpg). Confirm:
- Storage path `articles/140/images/image14.jpg` now matches its caption
- No images replaced with cross-category content

- [ ] **Step 5: Negative case — flat Drive**

Trigger an import with a `driveFolderUrl` pointing at a folder that has no subfolders. Expected logs:
- `Drive 為平鋪結構（...），跳過高解析度替換`
- Audit log entry with `strategy=skipped-flat`
- Low-res images remain in Storage unchanged

- [ ] **Step 6: Push to main**

```bash
cd /Users/kaellim/Desktop/projects/library && git push
```

- [ ] **Step 7: Deploy to production (user runs this)**

User runs on their workstation:
```bash
ssh kaelsohappy1@192.168.2.235 'cd ~/library && git pull && cd supabase-docker && docker compose up -d --build worker'
```

Then re-trigger weekly #140 import from production Dashboard and re-verify steps 3–5 against the production audit log.

---

## Self-review checklist (informational — not part of execution)

- ✅ Each spec section (§4 goals, §5 pipeline, §6 architecture, §7 fallback, §8 worker.ts changes, §9 testing, §10 risks) has at least one task implementing it.
- ✅ Type names are consistent: `DriveSubfolder`, `DriveStructure`, `FolderCategoryMapping`, `CategoryMatchResult`, `PerCategoryMatchOutcome` defined once each and referenced by their exact name everywhere.
- ✅ Every code step contains complete code, not stubs.
- ✅ No "TBD" / "TODO" / "add appropriate handling" placeholders.
- ✅ Confidence policy explicitly preserved (`high`+`medium` replace, `low` skip) in Task 7's prompt + replacement loop.
- ✅ Strict fallback (no global match) enforced by Task 10 deleting `matchAndReplaceImages` outright.
- ✅ Audit log schema (§6.6) implemented in Task 9 with all listed fields.
