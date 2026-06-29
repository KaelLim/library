# Prefix-Based Image Matching Design

**Date:** 2026-06-29
**Author:** Kael Lim + Claude
**Status:** Draft — pending implementation
**Supersedes:** [2026-06-23-per-category-image-matching-design.md](2026-06-23-per-category-image-matching-design.md) (Pass 2 borrows its per-category Vision logic)

---

## 1. Goal

把目前依賴 Claude Vision 比對的圖片替換流程，改為「**prefix deterministic 優先 + Vision fallback**」的兩段式架構。文邊命名 Drive 高解析度圖時會使用 `分類-文稿-圖序` 的前綴規則（例如 `3-2-3.jpg` = 第 3 分類第 2 篇第 3 張圖），絕大多數替換可以靠 regex 直接 JOIN 完成，零 AI 呼叫、零誤配。少數沒遵守命名規則的檔案才退化到 Vision 比對。

## 2. Non-goals

- 不改 Storage 目錄結構（仍是 `articles/{weekly_id}/images/image{N}.{ext}` 平鋪）
- 不改 `image-processor.ts`（base64 抽取與命名邏輯不變）
- 不改前端 UI（「從 Drive 補圖」按鈕、import 流程入口不變）
- 不重做 `ParsedWeekly` 型別（仍由 `ai-parser.ts` 產出，本流程只消費它）
- 不引入新的 storage bucket 或 schema migration

## 3. Why this beats per-category Vision

| 指標 | 舊（per-category Vision） | 新（prefix-first） |
|------|---------------------------|--------------------|
| AI 呼叫數（20 張典型週報） | 1 次 folder mapping + 8 次 Vision = 9 次 | 0 次（prefix 全中）～ 1-2 次 Vision（少數漏網） |
| 誤配風險 | 中（Vision 看相似法師照會錯） | 極低（deterministic JOIN）+ 漏網才走 Vision |
| Drive 結構要求 | 必須 8 個子資料夾，平鋪會跳過 | 平鋪 / 分版都可 |
| 退化路徑 | 結構不符 → 完全不替換 | 完全沒前綴 → 退化成現行 per-category Vision |

## 4. Pipeline change

```
舊 step 4.5：
  detectDriveStructure → mapDriveFoldersToCategories (AI) → per-category Vision

新 step 4.5：
  listImagesRecursive(driveRoot)
    → Pass 1: derive triples + parse prefixes + JOIN
    → Pass 2: Vision fallback on orphans (per category)
```

`worker.ts` 與 `routes/weekly.ts` 兩條入口呼叫的入口函式維持 `matchAndReplacePerCategory` 名稱（避免大規模 rename）— **但內部實作完全重寫**，只是函式名稱保留向後相容性以減少 churn。

> **Naming note:** 雖然函式名仍叫 `matchAndReplacePerCategory`，新行為已不是「per category」。本 spec 完成後可考慮改名為 `matchAndReplaceByPrefix` — 但這是 cosmetic，放到實作完成後再 follow-up。

## 5. Architecture

### 5.1 Pass 1 — Prefix Deterministic Match

**5.1.1 低解析度三元組推導（pure function）**

```typescript
type ImageTriple = { categoryId: number; articleIdx: number; imageIdx: number };

function deriveImageTripleMap(parsed: ParsedWeekly): Map<string, ImageTriple>
```

實作邏輯：
- 走訪 `parsed.categories[i]`（i 即 `categoryId` 對應索引，但實際取 `category.category_id`）
- 該 category 內 `category.articles[j]` 的 `articleIdx = j + 1`
- 對每篇 article 的 `content`，套用既有 `IMAGE_FILENAME_REGEX`，第 k 個 match 的 `imageIdx = k + 1`
- key = filename（e.g. `image14.jpg`），value = `{ categoryId, articleIdx, imageIdx }`
- 同檔名重複出現（跨版引用） → 第一次出現勝出（沿用現行 `deriveImageCategoryMap` 行為）

**5.1.2 高解析度 prefix 解析（pure function）**

```typescript
type DrivePrefix = { categoryId: number; articleIdx: number; imageIdx: number };

function parseDrivePrefix(filename: string): DrivePrefix | null
```

實作邏輯：
- Regex: `/^(\d+)-(\d+)-(\d+)/`
- 三個 capture 全為正整數，且 `categoryId ∈ [1, 8]` 才視為有效
- 不限制 `articleIdx` / `imageIdx` 的上限（容錯）
- 取不到 / 範圍不對 → 回傳 `null`（視為 unparseable，丟給 Pass 2 處理）

**寬鬆規則範例：**
| 檔名 | 結果 |
|------|------|
| `3-2-3.jpg` | `{3,2,3}` |
| `3-2-3-定稿.jpg` | `{3,2,3}` ✓ |
| `3-2-3 (1).png` | `{3,2,3}` ✓ |
| `03-02-03.jpg` | `{3,2,3}` ✓（前導 0 容忍） |
| `cover-3-2-3.jpg` | `null`（必須在開頭） |
| `9-1-1.jpg` | `null`（cat 超出 1-8） |

**5.1.3 三元組 JOIN（pure function）**

```typescript
interface PrefixMatchOutcome {
  matched: Array<{ lowFilename: string; driveFileId: string; driveFileName: string }>;
  orphanLow: Array<{ filename: string; triple: ImageTriple }>;
  orphanHigh: Array<{ file: DriveFile; prefix: DrivePrefix | null }>;
}

function joinByTriple(
  lowMap: Map<string, ImageTriple>,
  highFiles: DriveFile[],
): PrefixMatchOutcome
```

邏輯：
1. 對 `highFiles` 每個 file 跑 `parseDrivePrefix`，建 `highByTriple: Map<tripleKey, DriveFile[]>`（同 key 多檔以陣列存）
2. 對 `lowMap` 每個 entry：
   - 查 `highByTriple.get(key)`
   - 沒命中 → 加入 `orphanLow`
   - 命中 1 個 → 加入 `matched`，標記該 high file 為已用
   - 命中 ≥ 2 個（衝突） → 該 low 加入 `orphanLow`，這幾個 high 全標記為衝突丟入 `orphanHigh`
3. 所有未被認領的 high files → 加入 `orphanHigh`，附上 `prefix`（可能為 `null`）

`tripleKey` 字串格式：`${cat}-${art}-${img}`

**5.1.4 套用替換**

對 `matched` 中每筆：
- `downloadFile(token, driveFileId)` → buffer
- `compressImage(buffer, mimeType)` → compressed
- `uploadImage(weeklyId, lowFilename, compressed.buffer, compressed.mimeType)` → 覆蓋 Storage

並行控制：沿用現行 sequential 寫法，不引入新的並行池（避免 Drive rate limit）。

### 5.2 Pass 2 — Vision Fallback

只在 `orphanLow.length > 0 && orphanHigh.length > 0` 時啟動。

**5.2.1 按 category 分桶**
- `orphanLow` 依 `triple.categoryId` 分組
- `orphanHigh` 依 `prefix?.categoryId` 分組（`prefix === null` 的丟進 `unknown` 桶 → 不參與 Vision，直接記 audit）

**5.2.2 對齊呼叫**

每個 category 內若 `lowCount > 0 && highCount > 0`，呼叫**現有**的 `runVisionMatchForCategory`：

```typescript
const result = await runVisionMatchForCategory({
  weeklyId,
  categoryId: catId,
  lowFilenames: orphanLowInCat.map(o => o.filename),
  highFiles: orphanHighInCat.map(o => o.file),
  providerToken,
  onProgress,
});
```

`runVisionMatchForCategory` 維持不變（既已存在、已測試）。

### 5.3 主 orchestrator

`matchAndReplacePerCategory` 重寫為：

```typescript
async function matchAndReplacePerCategory(options): Promise<PerCategoryMatchOutcome> {
  // 1. List all Drive images (recursive, ignore folder structure)
  onProgress('列出 Drive 高解析度圖...');
  const highFiles = await listImagesRecursive(token, driveFolderId);
  if (highFiles.length === 0) return { strategy: 'skipped-no-drive-images', ... };

  // 2. Derive low-res triples from parsed markdown
  const lowMap = deriveImageTripleMap(parsed);
  if (lowMap.size === 0) return { strategy: 'skipped-no-low-res', ... };

  // 3. Pass 1: prefix JOIN
  onProgress('Prefix 比對中...');
  const passOne = joinByTriple(lowMap, highFiles);
  await applyPass1Replacements(passOne.matched, weeklyId, token, onProgress);

  // 4. Pass 2: Vision fallback (per category)
  let visionMatched = 0;
  if (passOne.orphanLow.length > 0 && passOne.orphanHigh.length > 0) {
    onProgress('Vision fallback：少數漏網圖檔...');
    visionMatched = await runVisionFallback(passOne, weeklyId, token, onProgress);
  }

  return computeStrategy(passOne, visionMatched);
}
```

`computeStrategy` 決定 `strategy` 欄位（見 §6）。

## 6. Audit log schema

`action: 'image_match'`（沿用），`metadata` 改為：

```typescript
{
  weekly_id: number,
  strategy: 'prefix-only' | 'prefix-with-fallback' | 'vision-only' | 'skipped-no-drive-images' | 'skipped-no-low-res',
  total_replaced: number,
  prefix_matched: number,
  vision_matched: number,
  drive_total: number,            // listImagesRecursive 回傳數
  low_res_total: number,          // lowMap.size
  orphan_low_after: string[],     // Pass 2 跑完仍沒配到的低解析度檔名
  unparseable_high_res: string[], // prefix 解不出來的 Drive 檔名
  conflict_triples: string[],     // Pass 1 衝突的 triple key（e.g. '3-2-3'）
}
```

`strategy` 判定規則（依序判斷，第一個命中者勝出）：

1. `drive_total === 0` → `skipped-no-drive-images`
2. `low_res_total === 0` → `skipped-no-low-res`
3. 以下依「Vision 是否被呼叫過」決定（記為 `visionAttempted`，即 Pass 1 後 orphanLow 與 orphanHigh 任一同 cat 桶皆 > 0 並實際呼叫了 `runVisionMatchForCategory`）：

   | prefix_matched | visionAttempted | strategy |
   |---|---|---|
   | > 0 | false | `prefix-only` |
   | > 0 | true | `prefix-with-fallback` |
   | 0 | false | `prefix-only`（Drive 上沒任何 prefix 解得出 + 同 cat orphan 不存在 → 等於沒動 AI） |
   | 0 | true | `vision-only` |

   `visionAttempted` 不等於 `vision_matched > 0` — Vision 跑過但 0 命中時仍算 attempted。

## 7. Files

### 7.1 Modify
- `worker/src/services/image-matcher.ts` — 重寫主邏輯，保留 `runVisionMatchForCategory`
- `worker/src/services/google-drive.ts` — 不動（`listImagesRecursive` 已能用）

### 7.2 Delete（完成後）
從 `image-matcher.ts` 移除：
- `DriveStructure` type、`decideDriveStructure`、`detectDriveStructure`
- `FolderCategoryMapping` type、`CATEGORY_TABLE`
- `buildFolderMappingPrompt`、`validateFolderMappingResponse`、`mapDriveFoldersToCategories`

對應測試檔：
- `worker/tests/services/image-matcher.detect.test.ts` — 刪除
- `worker/tests/services/image-matcher.mapping.test.ts` — 刪除
- `worker/tests/services/google-drive.test.ts` — 刪除（其唯一覆蓋對象 `filterSubfolders` 將一併移除）

從 `google-drive.ts` 移除（folder mapping 砍掉後完全沒 caller）：
- `filterSubfolders`、`listSubfolders`、`DriveSubfolder` interface

### 7.3 New tests
- `worker/tests/services/image-matcher.derive-triple.test.ts` — `deriveImageTripleMap`
- `worker/tests/services/image-matcher.parse-prefix.test.ts` — `parseDrivePrefix`
- `worker/tests/services/image-matcher.join.test.ts` — `joinByTriple`
- `worker/tests/services/image-matcher.strategy.test.ts` — `computeStrategy` 各種輸入組合

### 7.4 Callers — confirm signature compatibility
- `worker/src/worker.ts:144` — `matchAndReplacePerCategory(...)` 呼叫不動
- `worker/src/routes/weekly.ts:129` — 同上
- `PerCategoryMatchOutcome` 仍以 `totalReplaced` 為主欄位，audit log 寫入處改 metadata 對應

## 8. Edge cases & validation

| 情境 | 行為 |
|------|------|
| Drive 完全沒圖 | `strategy: 'skipped-no-drive-images'`，audit log 記錄 |
| Markdown 沒任何 `image\d+` reference | `strategy: 'skipped-no-low-res'` |
| 高解析度全無前綴 | Pass 1 命中 0；orphanHigh 全進 fallback；`strategy: 'vision-only'`（行為等同舊版） |
| 高解析度全有前綴且全命中 | `strategy: 'prefix-only'`，0 AI call |
| 一個 triple 對到兩個 Drive 檔 | 該 low 與兩個 high 全進 fallback；audit log `conflict_triples` 記錄該 key |
| Prefix 指向 markdown 不存在的 (cat,art,img) | 該 high 進 `orphanHigh`；若同 cat 有其他 orphan low 才會進 Vision |
| `parsed.categories` 為空陣列 | `lowMap.size === 0` → `skipped-no-low-res` |
| Pass 2 Vision 失敗（API error） | catch，記 audit `vision_error`，不阻斷流程 |

## 9. Risks

1. **檔名前綴計算依據差異** — 文邊命名時看到的 markdown 與 Worker 跑時看到的 markdown 若版本不同（例如中途文稿順序改動），prefix 對不上。緩解：Pass 2 Vision 接住。
2. **多版引用同一張圖** — markdown 中 `image14.jpg` 同時出現在 cat=3 與 cat=5 兩篇文稿 → 取第一次出現的 cat（既有行為）。文邊只需準備一份 `3-X-X.jpg`。Audit log 可額外列 `cross_category_refs` 供觀察（**v2 再加，本版不做**）。
3. **`articleIdx` 1-based 計算錯位** — 若 AI parsing 把某篇文稿漏掉，後續文稿的 `articleIdx` 會全部位移，造成 prefix 對不上 → Pass 2 接住。長期可在 `ParsedWeekly` 加 `originalOrderHint` 但**本版不做**。
4. **Drive 上有同名衝突檔** — `joinByTriple` 已處理（雙方丟 fallback）；audit log 記 `conflict_triples` 便於人工排查。

## 10. Test plan

### 10.1 Unit (vitest)
- `parseDrivePrefix`：正常、前導 0、後綴、cat 超出 1-8、不在開頭、副檔名變形
- `deriveImageTripleMap`：多版多篇、跨版同檔名、空 ParsedWeekly
- `joinByTriple`：全配、全 orphan、衝突、unparseable high res、重複 low
- `computeStrategy`：六種 strategy 輸出 × 邊界條件

### 10.2 Manual e2e（user-side）
1. 準備一個 Drive 資料夾，全部高解析度檔名都用 `x-x-x.jpg` 命名 → 跑匯入，audit log 應 `strategy: 'prefix-only'`
2. 故意把其中一張改成 `random.jpg` → audit log 應 `strategy: 'prefix-with-fallback'`，`unparseable_high_res` 含該檔
3. 把全部都改成 `random{N}.jpg` → audit log 應 `strategy: 'vision-only'`
4. 空 Drive 資料夾 → `strategy: 'skipped-no-drive-images'`
5. 「從 Drive 補圖」按鈕跑一次，行為應與匯入一致

## 11. Rollout

1. 實作 + 單元測試（TDD，per writing-plans）
2. 本機 dev 用真實 Drive 跑一次驗證
3. SCP 至 `kaelsohappy1@192.168.2.235`，rebuild worker container
4. 跑一次新週報匯入，查 audit log
5. 觀察兩週的 `strategy` 分佈：理想是 `prefix-only` > 90%

## 12. Migration / backwards compat

- 函式名 `matchAndReplacePerCategory` 暫不改名（避免 callers churn）
- Audit log `action: 'image_match'` 沿用；舊紀錄欄位 `drive_structure` / `folder_mapping` / `per_category` 不再寫入但歷史資料保留
- Storage 路徑與 base64 處理完全不變
