# PDF Reader — 混合寬高比書籍的白邊修正

**日期**：2026-07-20
**狀態**：待實作
**範圍**：`books/src/app.ts`（不動 StPageFlip fork）

---

## 1. 問題

使用者回報：混合直式與橫式頁的電子書，**直式頁左右出現大片白邊**。

### 根因

`books/src/app.ts:355-356` 用**兩個獨立的最大值**決定渲染目標尺寸：

```ts
const pageWidth  = Math.round(Math.max(...probeVps.map(v => v.width)));
const pageHeight = Math.round(Math.max(...probeVps.map(v => v.height)));
```

寬取最大、高也取最大，彼此獨立。混合寬高比的 PDF 因此得到一個**不屬於任何真實頁面**的目標尺寸：

| PDF 實際內容 | probe 結果 | 算出的 target |
|---|---|---|
| 橫式 1600×900 + 直式 900×1600 | maxW=1600, maxH=1600 | **1600×1600（正方形）** |

`renderPageToImage`（`app.ts:136-188`）比對每頁原生 aspect 與目標 aspect，差距超過 `ASPECT_MATCH_EPSILON = 0.005`（`app.ts:115`）就走 slow path：原生渲染後 aspect-fit 貼到目標尺寸的畫布。對正方形目標而言，直式（0.5625）與橫式（1.778）**兩者都不符**，所以**每一頁都被 letterbox**。

### 白色從哪來（已驗證）

`app.ts:168-169`：

```ts
outCtx.fillStyle = '#ffffff';
outCtx.fillRect(0, 0, targetWidth, targetHeight);
```

這片白被**烤進頁面圖片本身**。驗證鏈：

| 環節 | 位置 | 事實 |
|---|---|---|
| 白色填滿 | `app.ts:168-169` | 直接畫進 out-canvas |
| 畫布背景設定 | `app.ts:555` | `canvasBgColor: 'transparent'` |
| 頁面繪製 | `ImagePage.ts:53-59` | 透明模式下只 `clearRect` 再 `drawImage` — **不會蓋掉白色** |
| 書本底色 | `style.css:11` | `background: #1a1a2e`（深藍） |

白色矩形疊在深藍底上 → 正是使用者看到的白邊。

### 兩個次要缺陷

- **Probe 範圍**：`PROBE_COUNT = Math.min(5, numPages)`（`app.ts:349`）只看前 5 頁。同一個窗口也決定 `hasLandscape`（`app.ts:366`）進而決定 `forceSinglePage`（`app.ts:545`）—— 也就是整份文件的版面模式。唯一的橫式頁在第 18 頁的 PDF 會被判為全直式，用對開模式硬塞。
- **閾值**：`SPREAD_ASPECT_THRESHOLD = 1.3` 用嚴格大於。US Letter 橫式是 11/8.5 = 1.294，落在門檻下。

### 適用範圍（已驗證）

**均勻直式的 PDF 完全不受影響** —— 原生 aspect 等於目標 aspect，走 `app.ts:147` 的 fast path，一滴白色都不會畫。本缺陷**只影響混合方向的文件**。

本地兩個 sample（`books/sample.pdf` 69 頁 A4 直式、`慈濟週報第124期.pdf` 2 頁 A3 直式）都是均勻直式，**不是問題案例**，不能用來重現。

---

## 2. 設計決策：為什麼範圍這麼小

原本考慮過完整的「顯示單元」模型：依每頁寬高比動態切換對開/單頁、連續直式頁兩兩配對、per-unit 尺寸。**經對抗性審查後大幅縮減**，理由如下。

### 決策 1：刪除白色填滿，而非重新計算目標尺寸

刪掉 `app.ts:168-169` 後，letterbox 區域變透明，頁面直接浮在深藍背景上。

顯示尺寸的影響（實際推算 `Render.ts:242-258` 的夾制鏈）：

| 視窗形狀 | 效果 |
|---|---|
| **寬螢幕（桌機 16:9）** | 直式頁顯示尺寸**完全不變**。頁面本來就受高度限制，白邊純屬裝飾。問題完全解決。 |
| **高螢幕（手機直向）** | 頁面比最佳尺寸小（例：787×1400 vs 675×1200）。視覺改善，但沒吃滿空間。 |

推算依據：正方形目標在 1200×700 書本區域中 → `pageHeight` 夾到 700，`pageWidth` 回推為 700，直式內容佔 700 × (900/1600) = 394px 寬。若目標改為直式自身 aspect → `pageWidth` = 394。**兩者相同**。

### 決策 2：不動 `Render.calculateBoundsRect()`

`Render.ts:262` 的置中計算與 `pageWidth` 無關：

```ts
left = middlePoint.x - pageWidth / 2 - pageWidth;   // middlePoint.x = blockWidth / 2
```

窄的頁面本來就自動置中。配上透明填滿，「較窄的頁面置中顯示、無白邊」已是現成行為。**不需要任何 fork 改動。**

### 決策 3：延後「連續直式頁兩兩配對」

**原因是它會造成回歸，不是因為做不到。**

`ImagePageCollection.ts:27` 無條件呼叫 `addBlankPages()`。`addBlankPages` 讀 `settings.rtl`，而 **app.ts 從未把 `rtl` 傳進 PageFlip constructor**（app.ts 只有區域變數 `isRtl`，見 `:497`、`:517`、`:567`、`:706`、`:938`），所以 library 設定維持預設 `false`，永遠走 LTR 分支：前端 `unshift` 一張空白頁。

69 頁的書因此排成 `[空白|p1] [p2|p3] [p4|p5] … [p68|p69]` —— **封面單獨、然後 2|3、4|5，正確的雜誌對位，現在就在正式環境跑**。

「連續直式頁兩兩配對」會排成 `1|2, 3|4, …` —— 每一本現有書的對位整個位移一格，封面被黏到第 2 頁旁邊。**這是移除現有正確行為，不是新增功能。**

若日後要做，必須改寫為「從第 2 頁開始配對」，並且 LTR/RTL 在奇數頁數時的對位規則要分別明確定義。

### 決策 4：延後 A3 合成

兩張 A3 直式頁合成的畫布是 5052×3572 = **18.05 MP**，超過 Safari 的 16,777,216 px 上限（單頁 9.02 MP 安全）。

且 `app.ts:431` 是裸 `catch {}` —— 超限時 `toDataURL` 回傳 `"data:,"`，`ImagePage.image` 永遠不觸發 `onload`，`isLoad` 保持 false，`drawLoader` **無限轉圈且沒有任何錯誤訊息**。

此上限未在真實 iPad/iPhone 上驗證過，是判斷而非實測。若日後要做合成，必須先在目標裝置實測，並加上明確的面積上限守衛。

---

## 3. 範圍

### 本次實作

**Step 0 — 刪除白色填滿**

刪除 `books/src/app.ts:168-169` 兩行。out-canvas 維持透明。

這是唯一直接針對回報症狀的修改，且不改變任何版面行為，只改變 letterbox 區域的顏色。

### 本次不做（明確延後）

| 項目 | 延後理由 |
|---|---|
| Probe 範圍改全文件掃描 | 是正確性修正，但會讓「第 60 頁有一張橫式」的書從對開模式翻轉為單頁模式。受影響的書比顯示異常的書更多。**應在 Step 0 驗證後單獨出貨**，先加 log 觀察影響範圍。 |
| 閾值 1.3 → 1.0 | 唯一的正當性來自配對模型，而配對已延後。單獨改只會讓更多文件進入單頁模式，無明確收益。 |
| 連續直式頁配對（R2） | 決策 3：破壞現有封面對位。 |
| 手機不配對（R6） | 只因 R2 存在而存在。且 app.ts 目前**完全沒有視窗寬度偵測**（無 `innerWidth` / `matchMedia` / `clientWidth`），需從零建立斷點。 |
| Per-unit 尺寸 | 決策 2：不需要。 |
| 單元合成 | 決策 4：Safari 上限未驗證。 |

### 過程中發現、與本案無關的既有缺陷

這些**不在本次範圍**，但記錄下來以免遺失：

| # | 缺陷 | 位置 | 嚴重度 |
|---|---|---|---|
| B1 | Link overlay 用 `bookRect.width` 當頁寬，但 PORTRAIT 下實際頁面較窄（`Render.ts:254-258` 夾高度再回推寬度）。實例：頁面 700px 置中於 1200px 容器，連結矩形按 1200px 計算 → 放大約 1.7 倍、偏移約 250px。修法是改讀 `pageFlip.getBoundsRect()`，但該方法未宣告於 `books/src/global.d.ts:65`，需補宣告。 | `app.ts:1149` | 中（現行錯誤） |
| B2 | `renderPageCached` cache hit 時無條件回傳 `{width: targetWidth, height: targetHeight}`，但 fast path 存的是 native 尺寸，兩者只保證 aspect 差距 <0.5%，不保證像素相等。目前無 consumer 讀這兩個欄位，屬潛伏。 | `app.ts:204` vs `:154` | 低（潛伏） |
| B3 | PORTRAIT 模式下書脊陰影畫在可見頁面的**左緣**而非中央（`shadowPos.x = rect.left + rect.width/2`，在 PORTRAIT 等於 `middlePoint.x - pageWidth/2`）。所有混合 PDF 現在就有此現象，未被回報。 | `CanvasRender.ts:294-297` | 低（外觀） |
| B4 | `PageFlip.turnToPage` 不呼叫 `finishAnimation()`。滑桿拖曳、目錄跳頁、搜尋跳頁若落在 450ms 翻頁動畫期間，動畫的 `onAnimateEnd` 會從新位置再翻一次，超衝一格。 | `PageFlip.ts:211-218` | 低 |
| B5 | 所有渲染錯誤被裸 `catch {}` 吞掉，無任何診斷輸出。 | `app.ts:431` | 中 |

---

## 4. 實作細節

### 修改

```diff
  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetWidth;
  outCanvas.height = targetHeight;
  const outCtx = get2dContext(outCanvas);
- outCtx.fillStyle = '#ffffff';
- outCtx.fillRect(0, 0, targetWidth, targetHeight);
```

同時更新 `renderPageToImage` 的 docstring（`app.ts:128-135`），目前寫「composites onto a target-sized **white** canvas」，需改為透明。

### 相依事實：輸出格式必須保留 alpha

`toDataUrl`（`app.ts:122-126`）：

```ts
return SUPPORTS_WEBP ? canvas.toDataURL('image/webp', 0.92) : canvas.toDataURL('image/png');
```

WebP 與 PNG 皆支援 alpha，因此透明區域可以正確保存。**但 lossy WebP（0.92）的 alpha 通道在頁面邊緣是否乾淨未經實測** —— 這是本次唯一需要目視確認的項目（見 §5）。

若邊緣出現半透明髒邊，處置順序：提高 WebP 品質 → 改用 `canvas.toDataURL('image/webp')` 無損 → 退回 PNG。

### 快取影響

`buildCacheKey`（`app.ts:201`、`cache.ts:46-58`）已包含 `WxH`，鍵值不變，因此**既有快取仍會命中，且仍含白邊**。使用者必須清除瀏覽器快取，或等 IndexedDB 條目自然汰換，才會看到修正結果。

驗證時務必用無痕視窗或先清 IndexedDB，否則會誤判修改無效。

---

## 5. 驗證

### 前置：取得可重現的素材

本地無混合寬高比 PDF。兩種取得方式：

1. 從正式環境取出實際出問題的那本書
2. 用 PyMuPDF（`import fitz`，環境中可用；`reportlab` / `pypdf` / `qpdf` / `mutool` 皆不可用）合成測試 PDF

合成時注意：PDF.js 的 `getViewport()` **會**套用 `/Rotate`（已對 `pdfjs-dist` 5.6.205 驗證，即 `pdfjs-loader.ts:33` 選用的版本；`/Rotate 90` 的 A4 頁回報 1683.8×1190.6，aspect 1.4143），但 `pdfinfo` 回報為 `595×842 rot 90` —— **兩個工具的判讀不一致**，任何依 `pdfinfo` 寫的斷言都會與 viewer 實際所見矛盾。

### 目視檢查清單

在混合寬高比的 PDF 上，**清除快取後**：

1. 直式頁左右不再有白色矩形，該區域顯示為書本背景色（`#1a1a2e`）
2. 橫式頁上下同樣無白色矩形
3. 頁面邊緣乾淨 —— 無半透明髒邊、無白色殘留線（此項針對 WebP alpha）
4. 翻頁動畫期間無白色閃爍
5. 縮圖列的縮圖同樣無白邊
6. 桌機寬螢幕：直式頁尺寸與修改前相同（本修改不應改變尺寸）
7. 手機直向：確認使用者對剩餘的尺寸問題是否仍有意見 —— **這決定要不要繼續做後續步驟**

### 自動化測試

本次修改**無法有意義地單元測試** —— 它刪除的是 canvas 繪圖呼叫，斷言需要真實 canvas 與影像比對。`books/tests/` 現有測試（`search.test.ts`、`toc.test.ts`、`curl.test.ts`）皆為 node 環境的純函式測試，無 jsdom、無 canvas。

**不應**為此修改引入 jsdom 或 canvas mock —— 成本遠高於價值，且 mock 出來的 canvas 無法驗證真正要驗證的東西（實際像素）。

驗證方式即上述目視檢查清單。

---

## 6. 風險

| # | 風險 | 評級 | 處置 |
|---|---|---|---|
| RK-1 | Lossy WebP 的 alpha 在頁面邊緣產生髒邊 | 中／未實測 | 目視檢查項 3；處置順序見 §4 |
| RK-2 | 使用者的不滿其實是「頁面太小」而非「白邊很醜」。若是如此，透明化不能解決，正確方向改為「目標尺寸取主要方向的 aspect 而非獨立最大值」（仍不需動 fork、仍不需配對） | 中 | 目視檢查項 7 直接問使用者 |
| RK-3 | 既有快取仍含白邊，驗證時誤判無效 | 低 | §4 已載明；用無痕視窗驗證 |
| RK-4 | 透明頁面使 `#book` 的 drop-shadow 貼合真實頁面輪廓而非方形，觀感可能反而突兀 | 低／未實測 | 目視檢查項 1、2 |

---

## 7. 尚待使用者決定

**Q-A（阻擋後續步驟，不阻擋本次）**：Step 0 上線後，使用者是否滿意？

- 滿意 → 本案結案。R2（配對）與 R6（手機）改列為功能需求另案評估，而非缺陷修正。
- 不滿意且原因是「手機上頁面太小」 → 下一步是修目標尺寸選取（RK-2），仍不需配對。
- 不滿意且原因是「想要兩張直式並排」 → 才進入配對模型，且必須先解決決策 3 的封面對位與決策 4 的 Safari 上限。

**Q-B（不阻擋）**：正式環境實際有多少本混合寬高比的書？`worker/scan-book-aspects.mjs`（commit `a368aa9`）可回答。此數字決定後續步驟是否值得投入 —— 若只有一兩本，投入配對模型的成本效益需重新評估。

---

## 附錄：本設計推翻的先前結論

記錄下來以免重蹈：

1. **「需要 per-unit 寬度邏輯」** —— 錯。`Render.ts:262` 的置中與 `pageWidth` 無關，透明填滿後窄頁面自動置中即滿足需求。
2. **「A 系列的 √2 特性讓兩張直式併排 = 一張橫式，所以合成方案完美」** —— 總寬確實相等，但幾何運算吃的是 `rect.pageWidth`（半寬），800 vs 1600，每個單元邊界都有 2× 不連續。此推論在「不做配對」的最終設計下已無關緊要。
3. **「fork 的 `flippingPage === bottomPage` 別名 bug 會被觸發」** —— `addBlankPages` 保證頁數為偶數，`createSpread` 的 landscape 迴圈因此永遠不會產生單張 spread，該分支在正式環境不可達。真正會觸發的是 PORTRAIT 返回翻頁的路徑，且該路徑現在就已被所有混合 PDF 執行。
4. **「量測 A 系列與否是設計的前置條件」** —— 不是。最終設計與紙張尺寸無關。
