# PDF Reader Letterbox Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓混合寬高比 PDF 的 letterbox 區域變透明，消除疊在深藍書本背景上的白色矩形。

**Architecture:** 刪除 `books/src/app.ts` 中把 letterbox 畫布填白的兩行。out-canvas 保持透明，`ImagePage` 在 `canvasBgColor: 'transparent'` 下只做 `clearRect` + `drawImage`，因此透明區域會透出 `#1a1a2e` 書本背景。不動 StPageFlip fork，不改任何版面邏輯，只改 letterbox 區域的顏色。

**Tech Stack:** TypeScript（無 bundler，Rollup 打包）、Canvas 2D、PDF.js 5.6.205（CDN）、vitest（node 環境純函式測試）、PyMuPDF 1.27.2.2（僅用於產生測試素材）

## Global Constraints

- 設計文件：`docs/superpowers/specs/2026-07-20-pdf-reader-letterbox-fix-design.md`
- **不得修改 `books/lib/st-page-flip/` 內任何檔案。** 本次不碰 fork。
- **不得在 vitest 設定中加入 jsdom 或 `pdfjs-dist`。** 現有測試皆為 node 環境純函式測試（`books/tests/search.test.ts`、`toc.test.ts`、`curl.test.ts`），此約束來自 spec §5。
- **不得實作以下延後項目**：直式頁兩兩配對、手機不配對斷點、per-unit 尺寸、單元合成、probe 範圍改全文件掃描、閾值 1.3→1.0。延後理由見 spec §2、§3。
- **不得修改 B1（link overlay 頁寬）**。已確認 `boundsRect` 位於 canvas CSS 像素空間，且畫布可能因 curl room 而高於 `#book`（`Render.ts:227-228`、`CanvasUI.ts:41-43`），需另案調查。
- `books/tsconfig.json` 設有 `noUncheckedIndexedAccess: true`，陣列索引回傳 `T | undefined`。
- 驗證時**必須清除 IndexedDB 或使用無痕視窗**。`buildCacheKey` 已含 `WxH`，鍵值不變，既有快取仍含白邊，不清會誤判修改無效（spec §4）。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `books/tools/make-mixed-fixture.py` | 產生混合寬高比測試 PDF；自我驗證產出的頁面尺寸 | 建立 |
| `books/tests/fixtures/mixed-aspect.pdf` | 測試素材，6 頁 `L,P,P,L,P,P` A4，供瀏覽器目視驗證（單頁模式） | 建立（由上者產生） |
| `books/tests/fixtures/mixed-portrait.pdf` | 測試素材，6 頁全直式混合尺寸（A4 + Letter），維持對開模式，供驗證書口接縫 | 建立（由上者產生） |
| `books/app.js`、`books/app.js.map` | Rollup 產物，**已納入版控且為正式環境實際載入的檔案** | 隨 `src/app.ts` 一起 commit |
| `books/src/app.ts` | PDF 渲染與 viewer 主邏輯 | 修改 `:128-135` docstring、刪除 `:168-169` |

僅兩個任務。Task 1 產出可重現的測試素材（目前本地無混合寬高比 PDF，無法重現缺陷）；Task 2 施作修改並用 Task 1 的素材驗證。

---

## Task 1: 混合寬高比測試素材

**Files:**
- Create: `books/tools/make-mixed-fixture.py`
- Create: `books/tests/fixtures/mixed-aspect.pdf`（由腳本產生）

**Interfaces:**
- Consumes: 無
- Produces: `books/tests/fixtures/mixed-aspect.pdf` — 6 頁，順序為 landscape, portrait, portrait, landscape, portrait, portrait；landscape 頁為 841.89×595.276 pts、portrait 頁為 595.276×841.89 pts。Task 2 的目視驗證會載入此檔。

**背景：為什麼需要這個**

本地兩個既有 PDF（`books/sample.pdf` 69 頁 A4 直式、`慈濟週報第124期.pdf` 2 頁 A3 直式）都是**均勻直式**。均勻直式的 PDF 走 `app.ts:147` 的 fast path，一滴白色都不會畫，**無法重現本缺陷**。必須合成混合寬高比的素材。

此素材的頁面尺寸經過刻意挑選：`max(width) = 841.89`、`max(height) = 841.89`，因此 `app.ts:355-356` 會算出 842×842 的正方形目標，使**每一頁**都落入 letterbox slow path — 精確重現缺陷。

每頁填滿飽和色並加白色內框，讓白邊在深藍背景上一眼可辨（若頁面本身接近白色，白邊會混在一起看不出來）。

- [x] **Step 1: 確認 PyMuPDF 可用**

Run:
```bash
python3 -c "import fitz; print(fitz.__doc__)"
```

Expected: 輸出含 `PyMuPDF 1.27.2.2`。

若失敗，安裝：`python3 -m pip install --user PyMuPDF`。注意 `reportlab`、`pypdf`、`PyPDF2` 在此環境**不可用**，`qpdf`、`mutool` 也不在 PATH 上，所以不要改用它們。

- [x] **Step 2: 建立產生器腳本**

建立 `books/tools/make-mixed-fixture.py`：

```python
#!/usr/bin/env python3
"""產生混合寬高比的測試 PDF，用於驗證 letterbox 修正。

本地既有的 PDF 都是均勻直式，走 fast path，無法重現白邊缺陷。
本腳本產生 L,P,P,L,P,P 的 A4 混合檔，使 app.ts:355-356 的獨立
max() 算出 842x842 正方形目標，讓每一頁都落入 letterbox slow path。

每頁填飽和色 + 白色內框，讓白邊在 #1a1a2e 深藍背景上清晰可辨。

執行：
    python3 books/tools/make-mixed-fixture.py
輸出：
    books/tests/fixtures/mixed-aspect.pdf
"""

from pathlib import Path

import fitz

A4_W, A4_H = 595.276, 841.89

# (方向, RGB) — 順序刻意混合，且以 landscape 開頭，
# 使前 5 頁的 probe 窗口就能看到兩種方向。
PAGES = [
    ("landscape", (1.00, 0.35, 0.25)),
    ("portrait", (0.15, 0.45, 0.85)),
    ("portrait", (0.20, 0.65, 0.35)),
    ("landscape", (0.95, 0.70, 0.10)),
    ("portrait", (0.55, 0.30, 0.75)),
    ("portrait", (0.10, 0.60, 0.65)),
]

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "mixed-aspect.pdf"


def build() -> fitz.Document:
    doc = fitz.open()
    for i, (kind, rgb) in enumerate(PAGES, start=1):
        w, h = (A4_H, A4_W) if kind == "landscape" else (A4_W, A4_H)
        page = doc.new_page(width=w, height=h)
        page.draw_rect(fitz.Rect(0, 0, w, h), color=rgb, fill=rgb)
        page.draw_rect(fitz.Rect(12, 12, w - 12, h - 12), color=(1, 1, 1), width=6)
        page.insert_text(
            fitz.Point(w / 2 - 60, h / 2 + 40), str(i), fontsize=160, color=(1, 1, 1)
        )
        page.insert_text(
            fitz.Point(40, h - 40),
            f"{kind} {int(w)}x{int(h)}",
            fontsize=22,
            color=(1, 1, 1),
        )
    return doc


def verify(path: Path) -> None:
    """讀回產出的檔案，確認頁面尺寸與 PAGES 一致。"""
    doc = fitz.open(path)
    assert doc.page_count == len(PAGES), f"頁數 {doc.page_count} != {len(PAGES)}"

    widths, heights = [], []
    for i, (kind, _) in enumerate(PAGES):
        rect = doc[i].rect
        widths.append(rect.width)
        heights.append(rect.height)
        actual = "landscape" if rect.width > rect.height else "portrait"
        assert actual == kind, f"第 {i + 1} 頁應為 {kind}，實際 {actual}"
    doc.close()

    max_w, max_h = max(widths), max(heights)
    ratio = max_w / max_h
    assert abs(ratio - 1.0) < 0.01, (
        f"獨立 max() 應產生接近正方形的目標才能重現缺陷，實得 {max_w:.1f}x{max_h:.1f} "
        f"(ratio {ratio:.4f})"
    )
    print(f"驗證通過：{len(PAGES)} 頁，獨立 max() 目標 = {max_w:.1f}x{max_h:.1f}")


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = build()
    doc.save(OUT)
    doc.close()
    print(f"已產生 {OUT} ({OUT.stat().st_size} bytes)")
    verify(OUT)
```

- [x] **Step 3: 執行腳本產生素材**

Run:
```bash
cd /Users/kaellim/Desktop/projects/library && python3 books/tools/make-mixed-fixture.py
```

Expected：兩行輸出，形如
```
已產生 /Users/kaellim/Desktop/projects/library/books/tests/fixtures/mixed-aspect.pdf (5490 bytes)
驗證通過：6 頁，獨立 max() 目標 = 841.9x841.9
```

`verify()` 中的 assertion 就是本任務的測試：它確認產出的頁面方向與預期一致，且獨立 `max()` 確實會產生接近正方形的目標（否則素材無法重現缺陷）。

- [x] **Step 4: 用獨立工具交叉確認頁面尺寸**

Run:
```bash
pdfinfo -f 1 -l 9999 books/tests/fixtures/mixed-aspect.pdf | grep "size:"
```

Expected:
```
Page    1 size:  841.89 x 595.276 pts (A4)
Page    2 size:  595.276 x 841.89 pts (A4)
Page    3 size:  595.276 x 841.89 pts (A4)
Page    4 size:  841.89 x 595.276 pts (A4)
Page    5 size:  595.276 x 841.89 pts (A4)
Page    6 size:  595.276 x 841.89 pts (A4)
```

用 `pdfinfo`（poppler）而非再次用 PyMuPDF，是為了避免同一套函式庫自我驗證。

注意：本素材**不使用 `/Rotate`**。PDF.js 的 `getViewport()` 會套用 `/Rotate`，但 `pdfinfo` 會回報未旋轉的 MediaBox 加 `rot 90`，兩個工具判讀不一致（spec §5）。直接用不同的 MediaBox 尺寸可避開這個陷阱。

- [x] **Step 5: 確認未破壞既有測試**

Run:
```bash
cd books && npm test
```

Expected: 既有測試全數通過，輸出無新增警告。本任務未動任何 TypeScript，此步驟只是確認工作區乾淨。

- [x] **Step 6: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add books/tools/make-mixed-fixture.py books/tests/fixtures/mixed-aspect.pdf
git commit -m "test(books): add mixed-aspect PDF fixture generator

本地既有 PDF 都是均勻直式，走 app.ts:147 fast path，無法重現
letterbox 白邊缺陷。新增 PyMuPDF 產生器產出 L,P,P,L,P,P 的 A4
混合檔，使 app.ts:355-356 的獨立 max() 算出 842x842 正方形目標，
每一頁都落入 letterbox slow path。

腳本含自我驗證：確認頁面方向與預期一致，且獨立 max() 確實產生
接近正方形的目標。另以 pdfinfo 交叉確認。"
```

---

## Task 2: 移除 letterbox 白色填滿

**Files:**
- Modify: `books/src/app.ts:128-135`（docstring）、`books/src/app.ts:168-169`（刪除）

**Interfaces:**
- Consumes: `books/tests/fixtures/mixed-aspect.pdf`（Task 1 產出），供 Step 5 目視驗證
- Produces: 無新的程式介面。`renderPageToImage` 的簽章不變，仍為
  `(pdf: PDFDocumentProxy, pageNum: number, targetWidth: number, targetHeight: number) => Promise<PageRenderResult>`

**背景**

`app.ts:168-169` 把 letterbox 畫布填成白色，這片白被烤進頁面圖片本身。驗證鏈（spec §1）：

| 環節 | 位置 | 事實 |
|---|---|---|
| 白色填滿 | `app.ts:168-169` | 直接畫進 out-canvas |
| 畫布背景設定 | `app.ts:555` | `canvasBgColor: 'transparent'` |
| 頁面繪製 | `ImagePage.ts:53-59` | 透明模式下只 `clearRect` 再 `drawImage`，不會蓋掉白色 |
| 書本底色 | `style.css:11` | `background: #1a1a2e` |

刪除後 out-canvas 保持完全透明，letterbox 區域透出深藍書本背景。

**本任務無自動化測試**，理由見 spec §5：本修改刪除的是 canvas 繪圖呼叫，斷言需要真實 canvas 與像素比對；現有測試基礎設施是 node 環境純函式測試，為此引入 jsdom 或 canvas mock 成本遠高於價值，且 mock 出來的 canvas 無法驗證真正要驗證的東西（實際像素）。驗證方式為 Step 5 的目視檢查清單。

- [x] **Step 1: 刪除白色填滿並更新 docstring**

修改 `books/src/app.ts`。

Docstring（原 `:128-135`）—— 將 `white canvas` 改為 `transparent canvas` 並說明原因：

```ts
/**
 * Render one PDF page to a data URL sized (targetWidth, targetHeight).
 * If the page's native aspect matches the target within EPSILON, renders
 * directly at target dims. Otherwise renders at native and composites onto
 * a target-sized transparent canvas with aspect-fit (letterbox), so
 * mixed-aspect PDFs (e.g. portrait cover + landscape spreads) don't get
 * stretched by StPageFlip's uniform-size drawImage.
 *
 * The letterbox region is left transparent on purpose. ImagePage draws with
 * canvasBgColor 'transparent' (app.ts) so it clearRects then drawImages,
 * meaning anything painted here is visible against the #1a1a2e book
 * background. Filling it white produced the reported white bars.
 */
```

實作（原 `:164-170`）—— 刪除 `fillStyle` / `fillRect` 兩行：

```ts
  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetWidth;
  outCanvas.height = targetHeight;
  const outCtx = get2dContext(outCanvas);
```

其後的 `let dw: number, dh: number, dx: number, dy: number;` 及 `drawImage` 邏輯**完全不動**。

- [x] **Step 2: 型別檢查**

Run:
```bash
cd books && npm run typecheck
```

Expected: 無輸出、exit code 0。（`outCtx` 仍被後續的 `drawImage` 使用，不會產生 unused variable 錯誤。）

- [x] **Step 3: 執行既有測試**

Run:
```bash
cd books && npm test
```

Expected: 既有測試全數通過，輸出無新增警告。

- [x] **Step 4: 建置**

Run:
```bash
cd books && npm run build
```

Expected: Rollup 成功產出，無錯誤。（`npm run build` 只跑 `rollup -c`；**不要**跑 `build:all`，那會重建 StPageFlip fork，而本次不動 fork。）

- [ ] **Step 5: 瀏覽器目視驗證**（由 controller 於工作流程後執行，實作者未跑）

啟動本機伺服器：
```bash
cd books && npm run dev
```

在**無痕視窗**開啟（務必無痕 —— 既有 IndexedDB 快取仍含白邊，不清會誤判修改無效）：
```
http://localhost:8000/
```

頁面會自動載入 `./sample.pdf`（`DEFAULT_PDF`，`app.ts:27`）。靜態的 `books/index.html`
**不支援 `?src=` 參數** —— `viewerConfig` 來自 HTML 內的 `#viewer-config` JSON 元素
（`loadViewerConfig`，`app.ts:69-76`），由 worker 的 `/books/r/ext` 路由注入，本機開發時不存在。

改用公開 API 載入測試素材。在 DevTools console 執行：

```js
PDFViewer.load('/tests/fixtures/mixed-aspect.pdf')
```

（`window.PDFViewer.load` 定義於 `app.ts:1504-1508`，直接呼叫 `init(url)`。）

逐項確認：

1. 直式頁（第 2、3、5、6 頁）左右**不再有白色矩形**，該區域顯示為深藍書本背景 `#1a1a2e`
2. 橫式頁（第 1、4 頁）上下同樣**無白色矩形**
3. 頁面邊緣乾淨 —— 無半透明髒邊、無白色殘留線
4. 翻頁動畫期間無白色閃爍
5. 縮圖列的縮圖同樣無白邊
6. 頁面顯示尺寸與修改前相同（本修改**不應**改變尺寸，只改顏色）
7. `#book` 的 drop-shadow 現在會貼合真實頁面輪廓而非方形外框 —— 確認觀感可接受，
   不會顯得突兀或出現雙重陰影（spec RK-4，未經實測的判斷）

**接著必須另外載入第二個素材，檢查對開（spread）模式**：

```js
PDFViewer.load('/tests/fixtures/mixed-portrait.pdf')
```

`mixed-aspect.pdf` 的 landscape 頁 aspect 為 1.414，超過 `SPREAD_ASPECT_THRESHOLD`
1.3（`app.ts:368-369`），會觸發 `forceSinglePage`（`app.ts:548`）→ `Orientation.PORTRAIT`
→ `CanvasRender.drawEdges()` 在 `CanvasRender.ts:123` 直接 return。也就是說**單靠
`mixed-aspect.pdf` 無法驗證對開模式**。

`mixed-portrait.pdf` 為全直式但尺寸混合（A4 + US Letter），最大 aspect 0.773 未達
1.3，因此維持對開，同時每一頁仍落入 letterbox slow path。逐項確認：

8. 對開模式下左右兩頁的 letterbox 區域無白邊，顯示深藍背景
9. 頁面內容與 StPageFlip 書口（fore-edge，`CanvasRender.ts:152-161` 畫在
   `rect.left` / `rect.left + rect.width` 附近）之間的**接縫觀感可接受** ——
   該處先前被白色填滿遮住，改透明後頁面內容內縮而書口不動，兩者間會出現一道
   深色間隙。**這是本修改的已知副作用，非新缺陷**：根因是 `app.ts:358-359` 用兩個
   獨立 max() 算出不屬於任何真實頁面的目標尺寸（spec RK-2），修目標尺寸選取才是
   根治，屬延後項目。
10. 翻頁動畫期間，翻動頁的透明邊界不會出現白色閃爍

**若第 9 項觀感不佳**，停止並回報，不要自行改 fork 或調整尺寸邏輯 —— 那會踩到本
計畫明訂的延後項目，需另案處理。

第 3 項針對 lossy WebP 的 alpha 通道。`toDataUrl`（`app.ts:122-126`）在支援時用 `canvas.toDataURL('image/webp', 0.92)`。WebP 支援 alpha，但 0.92 lossy 的 alpha 邊緣品質未經實測。

**若第 3 項失敗**（邊緣出現髒邊或殘留白線），依序嘗試，每次只改一項並重新目視確認：

1. 提高品質：`canvas.toDataURL('image/webp', 0.98)`
2. 無損 WebP：`canvas.toDataURL('image/webp')`（省略品質參數）
3. 退回 PNG：把 `SUPPORTS_WEBP` 分支改為一律 `canvas.toDataURL('image/png')`

三者皆會增加資料量，故按此順序（影響由小到大）。若採用任一項，在 commit message 中記錄實測結果。

**若第 1、2 項失敗**（白邊仍在），最可能原因是快取未清。在 DevTools → Application → Storage 清除 IndexedDB 後重新載入。若清除後仍在，停止並回報 —— 表示 spec §1 的驗證鏈有誤，需重新診斷而非繼續修改。

**若第 7 項觀感不佳**，停止並回報，不要自行加 CSS 修飾陰影。那屬於設計決策，需使用者判斷。

- [ ] **Step 6: 以既有均勻直式 PDF 確認無回歸**（由 controller 於工作流程後執行，實作者未跑）

在同一個無痕視窗重新載入 `http://localhost:8000/`（會自動載入 `./sample.pdf`），
或在 console 執行 `PDFViewer.load('/sample.pdf')`。

Expected: 69 頁 A4 直式書的顯示與修改前**完全相同** —— 對開模式、封面單獨一頁、然後 2|3、4|5。

此步驟確認本修改未影響均勻直式文件。均勻直式的 PDF 走 fast path（`app.ts:147`）從不進入被修改的程式碼，因此預期零差異；本步驟是驗證該推論。

- [x] **Step 7: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add books/src/app.ts
git commit -m "fix(books): letterbox 區域改為透明，消除白邊

混合寬高比的 PDF 因 app.ts:355-356 用兩個獨立最大值算渲染目標，
會得到不屬於任何真實頁面的正方形目標，使每一頁都落入 letterbox
slow path。app.ts:168-169 再把 letterbox 區域填成白色並烤進頁面
圖片，疊在 style.css:11 的 #1a1a2e 深藍背景上，形成回報的白邊。

刪除該白色填滿後 out-canvas 保持透明。ImagePage.ts:53-59 在
canvasBgColor 'transparent' 下只做 clearRect + drawImage，因此
透明區域會透出書本背景。

不動 StPageFlip fork，不改任何版面邏輯，僅改 letterbox 區域顏色。
均勻直式的 PDF 走 fast path 從不進入此程式碼，行為不變（已用
sample.pdf 確認）。

設計：docs/superpowers/specs/2026-07-20-pdf-reader-letterbox-fix-design.md"
```

---

## 完成後

**部署**：`books/` 是靜態資源，由 worker 容器以唯讀 bind mount 直接提供
（`supabase-docker/docker-compose.yml:636` `- ../books:/app/books:ro`，`:630` `BOOKS_DIR`），
**部署時不會重新建置**。`books/index.html:163` 直接載入 `<script type="module" src="app.js">`。

> **因此 `books/app.js` 與 `books/app.js.map` 必須與 `books/src/app.ts` 同一批 commit。**
> 這兩個檔案已納入版控，是正式環境實際送到瀏覽器的檔案。只 commit `src/app.ts`
> 會讓 `git pull` 拉到舊的 bundle，修正完全不會生效。repo 既有慣例亦是如此
> （640599f、db2a513、3416e6e、19fa74c 皆同批 commit）。

```bash
# 正式機
cd supabase-docker
git pull
sudo docker compose up -d --build dashboard
```

**提醒使用者**：既有 IndexedDB 快取仍含白邊。`buildCacheKey`（`cache.ts:46`）只編入
`url::page::scale::WxH`，**不含渲染格式或修正版號**，所以鍵值不變、既有條目不會失效；
清除器（`cache.ts:91-99`）只淘汰超過 `MAX_AGE_MS`（30 天）的條目。

也就是說：**已看過的頁面最長會持續顯示白邊達 30 天**，除非使用者主動清除網站資料。
上線時應主動告知使用者清除瀏覽器快取（DevTools → Application → Storage），
不要只說「等自然汰換」。

**驗收問題**（spec §7 Q-A）：上線後請使用者確認是否滿意。

- 滿意 → 本案結案。直式頁配對（R2）與手機不配對（R6）改列功能需求另案評估。
- 不滿意，且原因是「手機上頁面太小」→ 下一步是修目標尺寸選取（spec RK-2），仍不需配對、不需動 fork。
- 不滿意，且原因是「想要兩張直式並排」→ 才進入配對模型，且必須先解決 spec 決策 3 的封面對位回歸與決策 4 的 Safari 18.05 MP 上限。

桌機寬螢幕上本修改應完全解決問題（尺寸不變，白邊消失）；手機直向上頁面仍比最佳尺寸小（spec §2 決策 1），這是預期中的部分解。
