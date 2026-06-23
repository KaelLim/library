# Per-category Image Matching — 設計 Spec

- **狀態**：草案，待 review
- **日期**：2026-06-23
- **背景 commit**：`a7dc3a9` (parser hardening + opus switch)
- **觸發案例**：weekly #140 / #136 高解析度圖片配對錯誤率約 10%（20 張錯 2 張）

## 1. 問題陳述

`matchAndReplaceImages`（`worker/src/services/image-matcher.ts`）目前的做法是：
1. 把週報 markdown 內所有低解析度圖片下載到 `/tmp/low/`
2. 把 Drive 資料夾遞迴列出的**全部**高解析度圖片下載到 `/tmp/high/`
3. 一次性餵給 Claude Vision，要求回傳完整 mapping
4. 對 `confidence` 為 `high` 或 `medium` 的結果直接覆蓋 Storage

當 Drive 內高解析度圖片量大（30+）且主題相近（多場法會、典禮、人物群像），Vision 容易把低解析度的 `imageN.jpg` 配到「視覺相近但語意無關」的高解析度檔案。一旦 `confidence ≥ medium` 就直接替換，造成 caption 與檔案內容不符。

## 2. 目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 圖片配對錯誤率 | ~10%（2/20） | <2% |
| AI 一次的候選數 | 全部高解析度（30+） | 同 category 內（3–5） |
| Drive 結構不符時的行為 | 全域比對（沿用有錯路徑） | 跳過替換，保留低解析度 |
| 替換決策可追溯 | 僅 stdout log | `audit_logs` 完整紀錄 |

## 3. 非目標（YAGNI）

- 歷史 weekly 的儲存路徑遷移
- Storage 改成 `images/{category_id}/{file}` 結構
- Confidence 門檻動態調整（先觀察新結果分布再說）
- Drive folder mapping 結果快取到 DB
- Per-article 級別的比對（per-category 已足夠）
- Manual override UI（未來若 audit log 顯示需要再加）

## 4. 解決方案概觀

縮小 AI 一次看到的候選集 —— 從「整個 Drive 的高解析度圖」降到「同一 category 子資料夾內的高解析度圖」。透過：

1. **Pipeline 重排**：把 `replacing_images` 從 `ai_parsing` 之前移到之後，這樣替換時已有權威的 image→category 對應
2. **Drive 結構約定**：根資料夾下要有 8 個子資料夾，命名涵蓋 8 個 category（命名格式不限，由 AI 判斷對應）
3. **嚴格 fallback 政策**：Drive 不符合約定 → 跳過替換（不退回全域比對，全域比對是現有 bug 來源）

`uploadImage()` 對相同檔名為覆蓋寫入，URL 不變 —— 替換高解析度不影響 `articles.content` 內嵌的圖片 URL，markdown 不需重寫。

## 5. Pipeline 改動

```diff
1. exporting_docs
2. converting_images
- 2.5. replacing_images       (移除：全域比對版本)
3. uploading_original
4. ai_parsing
+ 4.5. replacing_images        (新位置：per-category 比對)
5. uploading_clean
6. importing_docs
7. ai_rewriting
8. importing_digital
9. generating_audio
```

`worker.ts` 改動：移除原本 `step 2.5` 區塊，將 replacing_images 邏輯搬到 `parseWeeklyMarkdown()` 之後、`generateCleanMarkdown()` 之前；改傳 `parsed: ParsedWeekly` 進 matcher。

## 6. 架構

```
worker/src/services/
├── google-drive.ts
│   └── listSubfolders(token, parentId)        ← 新增
├── image-matcher.ts                            ← 重構
│   ├── detectDriveStructure()
│   ├── mapDriveFoldersToCategories()           (AI)
│   ├── deriveImageCategoryMap()                (parsed → Map)
│   ├── matchAndReplacePerCategory()            (主流程)
│   └── runVisionMatchForCategory()             (per-category Vision 呼叫)
└── worker.ts                                   ← Pipeline 順序調整
```

### 6.1 Drive 結構偵測

```typescript
type DriveStructure =
  | { mode: 'categorized'; subfolders: Array<{ id: string; name: string }> }
  | { mode: 'flat'; reason: string };

async function detectDriveStructure(
  token: string,
  rootFolderId: string,
): Promise<DriveStructure>;
```

判斷規則：
- 列 `rootFolderId` 直接子項
- 子資料夾 ≥ 2 個且根目錄無圖檔散落 → `categorized`
- 其他狀況（純圖檔、混合、單一子資料夾） → `flat`，附帶 `reason`

### 6.2 AI Folder→Category 映射

```typescript
async function mapDriveFoldersToCategories(
  subfolders: Array<{ id: string; name: string }>,
  weeklyId: number,
): Promise<{
  mappings: Map<string, number>;  // folder_id → category_id (1-8)
  unmapped: string[];              // 無法判斷的 folder_id
}>;
```

Prompt 結構（inline，不另開 skill 檔）：
- 載入 1–8 category 對照表（同 `parse-weekly` skill 用的）
- 列出子資料夾 id 與名稱
- 要求 JSON 輸出 `{ mappings: [...], unmapped: [...] }`
- 用 `runSessionWithStreaming` + `extractJsonObject` fallback（複用 `ai-parser.ts` 修好的工具）

驗證階段（程式端）：
- `category_id` 必須在 1..8
- 同一 `category_id` 不可被多個 folder 同時對到 → 重複者全退回 `unmapped`
- 全部 unmapped 視為「mapping 失敗」

### 6.3 Image→Category 推導

```typescript
function deriveImageCategoryMap(parsed: ParsedWeekly): Map<string, number>;
```

純程式邏輯，零 AI 成本：
- 走 `parsed.categories[].articles[].content`
- regex `/\/images\/(image\d+\.\w+)\)/g` 取出檔名
- 每張圖繼承所在 article 的 `category_id`
- 同檔名出現在多版時，第一次出現的 category 勝出

### 6.4 Per-category Matcher 主流程

```typescript
async function matchAndReplacePerCategory(options: {
  weeklyId: number;
  parsed: ParsedWeekly;
  providerToken: string;
  driveFolderId: string;
  onProgress?: (msg: string) => void;
}): Promise<{
  totalReplaced: number;
  perCategory: Map<number, { replaced: number; skipped: number }>;
  strategy: 'per-category' | 'skipped-flat' | 'skipped-mapping-failed';
}>;
```

流程：
1. `detectDriveStructure` → flat 直接 return `skipped-flat`
2. `mapDriveFoldersToCategories` → 全 unmapped 直接 return `skipped-mapping-failed`
3. `deriveImageCategoryMap` → 取得 `image_filename → category_id`
4. 反向索引 → `category_id → [image_filenames]`
5. 對每個 category：
   - 查對應 Drive 子資料夾的 `folder_id`
   - 沒對應 → skip 並記錄
   - `listImagesRecursive` 列出該 folder 下高解析度圖
   - 呼叫 `runVisionMatchForCategory` 做配對與替換
6. 聚合結果回傳

### 6.5 Per-category Vision 呼叫

沿用現有 prompt 結構（`matchAndReplaceImages` 內那段），差別只在：
- `/tmp/low/` 只放該 category 的低解析度圖
- `/tmp/high/` 只放該 Drive 子資料夾的高解析度圖
- `maxTurns` 重新估算（每 category 平均 ~5 張，`Math.max(20, ceil(total/3) + 10)`）
- Model 維持 `'opus'`（已於 commit `a7dc3a9` 切換）
- Confidence 政策維持 `high` + `medium` 替換、`low` 跳過

### 6.6 Audit Log 紀錄

每次 import 在 replacing_images 步驟結束時新增一筆：

```json
{
  "action": "image_match",
  "table_name": null,
  "record_id": null,
  "metadata": {
    "weekly_id": 140,
    "strategy": "per-category",
    "drive_structure": { "mode": "categorized", "subfolders_count": 8 },
    "folder_mapping": { "folder_abc": 1, "folder_def": 2 },
    "unmapped_folders": [],
    "per_category": {
      "1": { "replaced": 3, "skipped": 0, "drive_folder_id": "abc" },
      "2": { "replaced": 2, "skipped": 1, "drive_folder_id": "def" }
    },
    "total_replaced": 18,
    "total_skipped": 2
  }
}
```

用途：日後出現配錯，可從 audit log 直接定位是 folder mapping 階段出錯還是 Vision 比對階段出錯。

## 7. Fallback 政策

| 狀況 | 行為 | Log Level |
|------|------|----------|
| 未提供 driveFolderUrl | 不執行 replacing_images | info |
| Drive 為 flat | 跳過替換，保留低解析度 | warn + audit |
| Folder mapping 全部 unmapped | 跳過替換 | warn + audit |
| 部分 category 對應成功 | 對應的走 per-category；其餘該 category 不替換 | warn + audit |
| Category 對應到 Drive folder 但內部無圖 | 該 category 不替換 | info + audit |
| Category 有低解析度但 parse 未抓到 | 該圖不替換（不會出現在 imageToCategory） | info |
| Vision 在 category 內配不到任何圖 | 該 category 不替換 | warn + audit |
| ai_parsing 失敗 | 整個 import 失敗（行為同今天） | error |

**沒有任何情境會走「全域比對」舊路徑**。原 `matchAndReplaceImages` 函式整段刪除。

## 8. 對 worker.ts 的具體改動

當前 `worker.ts` 內 step 2.5 區塊（lines ~110–158）：
```ts
// 2.5 替換高解析度圖片
if (options.driveFolderUrl) {
  // ... matchAndReplaceImages ...
}
```

改為：
1. 移除原 step 2.5 區塊
2. 在 `parsed = await parseWeeklyMarkdown(...)` 之後新增：
```ts
if (options.driveFolderUrl) {
  await updateProgress('replacing_images', '準備替換高解析度圖片...');
  // ... 同樣的 Drive token 取得邏輯 ...
  if (driveToken) {
    try {
      const result = await matchAndReplacePerCategory({
        weeklyId, parsed, providerToken: driveToken,
        driveFolderId, onProgress: async (msg) => updateProgress('replacing_images', msg),
      });
      // 寫 audit log
      await writeAuditLog({ ..., action: 'image_match', metadata: { ...result } });
    } catch (err) {
      console.error('[replacing_images] Error:', err);
      await updateProgress('replacing_images', '圖片替換失敗，繼續匯入...');
    }
  }
}
```
3. `markdownWithUrls` 變數仍由 step 3 上傳 `original.md` 使用（順序不變）

## 9. 測試計畫

| 類型 | 測試 | 涵蓋 |
|------|------|------|
| Unit | `deriveImageCategoryMap` 對各種 markdown 圖片格式 | 邊界：alt 文字含括號、多層路徑、cross-category |
| Unit | `detectDriveStructure` 各種 Drive 排列 | categorized / flat / 半整理 / 單 subfolder |
| Unit | `mapDriveFoldersToCategories` JSON 驗證 | 重複 category、超出範圍、空 mappings |
| Integration | mock Drive API + dry-run 完整 pipeline | 用 weekly #140 真實 markdown |
| Manual | weekly #140 Drive 整理成 8 子資料夾後重跑 | 觀察 audit log + 視覺驗證替換結果 |

## 10. 風險與緩解

| 風險 | 緩解 |
|------|------|
| AI folder mapping 把兩個 folder 對到同 category | 程式端偵測重複 → 退回 unmapped → 該 category 不替換 |
| Drive 子資料夾命名實在太怪 AI 認不出 | audit log 記下 unmapped；未來可加 manual override（本次不做） |
| ai_parsing 抓不到某張圖 | 該圖留低解析度（不影響其他圖） |
| 同張圖出現在多版（編輯者誤放） | 第一次出現的 category 勝出（regex 順序） |
| `runVisionMatchForCategory` 同時跑多 category，AI 並發塞爆 | 順序處理（for-of），不並發；每 category 約 30–60 秒，可接受 |
| Drive folder ID 取得失敗（OAuth token 過期等） | 走現行錯誤處理路徑：失敗不擋整體 import |

## 11. 實作順序建議

1. `google-drive.ts` 加 `listSubfolders` + 寫 unit test
2. `image-matcher.ts` 加 `detectDriveStructure` + unit test
3. `image-matcher.ts` 加 `deriveImageCategoryMap` + unit test
4. `image-matcher.ts` 加 `mapDriveFoldersToCategories`（含 prompt 與驗證）+ unit test（mock AI）
5. `image-matcher.ts` 加 `matchAndReplacePerCategory` 主流程 + integration test（mock Drive + mock AI）
6. `worker.ts` pipeline 重排
7. 移除舊 `matchAndReplaceImages`
8. 手動跑 weekly #140 驗收
9. Commit + push + 部署

## 12. 開放問題

- **舊 Drive 結構的歷史 weekly 重跑**：用本次 design 跑時若 Drive 仍是 flat，會跳過替換。如需重跑取得高解析度，需先整理該期 Drive。**不在本次範圍**。
- **Folder mapping 信心度**：目前 prompt 沒讓 AI 標示信心度。若日後發現 mapping 出錯，可加 `confidence` 欄位並只接受 `high`。**未來功能**，不在本次範圍。
