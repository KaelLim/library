# Codebase Optimization Plan

基於程式碼審查結果，列出所有可優化項目及實作方向。

## 已完成

- [x] AI 改寫圖片驗證 — `ensureImagesPreserved()` 程式化補回遺漏圖片
- [x] 圖片自動壓縮 — `sharp` resize ≤1920px + JPG 品質 80%
- [x] Phase 1-1: requireAuth middleware 提取至 `middleware/auth.ts`
- [x] Phase 1-2: XSS 修復 — markdown preview URL 白名單 + escape
- [x] Phase 1-3: Dialog 記憶體洩漏 — 審查後確認 arrow function 無此問題，跳過
- [x] Phase 1-4: 輸入驗證 — `parsePagination()` 安全解析 + NaN 防護
- [x] Phase 1-5: 背景任務失敗回報 — batch 完成後寫入 audit_log（success/failed 計數）
- [x] Phase 2-6: 圖片上傳平行化 — `Promise.all()` 壓縮+上傳
- [x] Phase 2-7: server.ts 拆分 — 876→339 行，提取 `routes/articles.ts` + `routes/books.ts`
- [x] Phase 2-8: page-article-edit.ts 拆分 — 提取 `utils/markdown.ts`，876→842 行
- [x] Phase 2-9: Toggle 元件提取 — `tc-toggle.ts` 共用元件，替換 weekly-detail + weekly-list
- [x] Phase 2-10: Markdown preview debounce — 300ms 延遲預覽
- [x] Phase 2-11: `any` 型別清理 — paginate generic + categoryMap 修正
- [x] Phase 3-12: Accessibility — back-btn aria-label, dialog aria-labelledby
- [x] Phase 3-13: Loading/error 狀態 — 確認所有頁面已有 loading + toastStore.error 處理
- [x] Phase 3-14: 日期格式化統一 — `utils/formatting.ts` 共用
- [x] Phase 3-15: CSS 硬編碼顏色 — Google 品牌色為規範要求，其餘已無問題，跳過

---

## Phase 1：高優先（安全/穩定性）

### 1. requireAuth middleware 重複
**位置**：`worker/src/server.ts` + `worker/src/routes/api-v1.ts`
**問題**：完全相同的 auth middleware 寫了兩份
**做法**：
- 建立 `worker/src/middleware/auth.ts`，提取 `requireAuth`
- 兩個檔案改為 `import { requireAuth } from '../middleware/auth.js'`

### 2. XSS 風險 — markdown preview
**位置**：`dashboard/src/pages/page-article-edit.ts` L439
**問題**：`<a href="${url}">` 未 escape，可注入 `javascript:` URL
**做法**：
- 在 `renderMarkdown()` 中，對 URL 使用 `encodeURI()` 處理
- 加入 protocol 白名單驗證（只允許 `http:`, `https:`, `/`）
- 現有的 `javascript|data|vbscript` 過濾改為白名單制

### 3. Dialog 記憶體洩漏
**位置**：`dashboard/src/components/ui/tc-dialog.ts`
**問題**：`handleKeydown` 是 arrow function，`removeEventListener` 無法正確移除
**做法**：
- 將 `handleKeydown` 改為 bound method：`this.handleKeydown = this.handleKeydown.bind(this)` 在 constructor 中
- 或改為在 `connectedCallback` 中建立 reference 並存起來

### 4. 缺少輸入驗證
**位置**：`worker/src/server.ts` 多處、`worker/src/routes/api-v1.ts`
**問題**：`folder_url`、pagination params 未驗證格式
**做法**：
- pagination：`parseInt` 後加 `isNaN` 檢查，給預設值
- `folder_url`：用 `URL` constructor 驗證，`extractFolderId` 回傳 null 時 400
- `folderId`：加正規表達式驗證格式 `/^[a-zA-Z0-9_-]+$/`
- `skillName`：白名單驗證（只允許 `parse-weekly`、`rewrite-for-digital`）

### 5. 背景任務失敗無回報
**位置**：`worker/src/server.ts` 多個 `().catch(console.error)`
**問題**：batch operations 錯誤只 console.log，前端不知道
**做法**：
- 建立 `worker/src/services/task-tracker.ts`
- 背景任務開始時寫入 `audit_logs`（action: `task_start`）
- 完成/失敗時更新（action: `task_complete` / `task_error`）
- Dashboard 可透過 audit_logs 查看任務狀態

---

## Phase 2：中優先（效能/維護性）

### 6. 圖片上傳串行改平行
**位置**：`worker/src/services/image-processor.ts`
**問題**：每張圖片依序上傳，20 張圖要等很久
**做法**：
- 用 `Promise.all()` 平行上傳，但設 concurrency limit（5 並發）
- 注意：檔名是 `image${i+1}`，需先收集所有壓縮結果再平行上傳
- 可用簡單的 chunk 方式：每 5 張一批

### 7. worker/src/server.ts 拆分（900 行）
**位置**：`worker/src/server.ts`
**做法**：
- `routes/books.ts` — Book CRUD、SSR、thumbnails（L100-190, L610-890）
- `routes/import.ts` — 匯入相關 endpoints（L230-370）
- `routes/articles.ts` — 文稿改寫、description 生成（L370-560）
- `server.ts` 只保留 Fastify setup、middleware、route 註冊

### 8. dashboard page-article-edit.ts 拆分（876 行）
**位置**：`dashboard/src/pages/page-article-edit.ts`
**做法**：
- `components/article/tc-markdown-preview.ts` — markdown 渲染邏輯
- `components/article/tc-editor-toolbar.ts` — toolbar 按鈕和 handlers
- `page-article-edit.ts` — 組合上述元件 + 資料載入/儲存

### 9. Toggle / Dialog 元件重複
**位置**：dashboard 多處
**問題**：toggle switch CSS+HTML 寫了 3 份，confirm dialog 寫了 2 份
**做法**：
- 建立 `components/ui/tc-toggle.ts` — 可重用的 toggle switch
- 建立 `components/ui/tc-confirm-dialog.ts` — 確認對話框（title, message, onConfirm, onCancel）
- 建立 `components/ui/tc-push-form.ts` — 推播表單（title, body 欄位）
- 各頁面改用共用元件

### 10. Markdown preview 無 debounce
**位置**：`dashboard/src/pages/page-article-edit.ts`
**問題**：每次按鍵都重新 render markdown，大文件會卡
**做法**：
- 編輯區 `@input` 加 300ms debounce
- 或改為手動切換「編輯/預覽」模式，不即時 render

### 11. `any` 型別清理
**位置**：`worker/src/routes/api-v1.ts`、`dashboard` 多處
**問題**：約 10 處用了 `any` 繞過型別檢查
**做法**：
- `api-v1.ts` 的 `paginate(data: any[])` → 改為 `<T>(data: T[])`
- `(article as any).category` → 定義 `ArticleWithCategory` interface
- `updates as any` → 驗證 input 結構後使用正確型別
- Dashboard 的 `result: any` → 定義回傳型別

---

## Phase 3：低優先（改善體驗）

### 12. Accessibility
**位置**：dashboard 多處
**做法**：
- icon 按鈕加 `aria-label`（back、edit、delete 等）
- `tc-dialog.ts` 加 `aria-labelledby`、`aria-describedby`
- dialog 開啟時 focus trap（可用 `focus-trap` 套件）

### 13. 缺少 loading/error 狀態
**位置**：dashboard 部分頁面
**做法**：
- audit logs loadMore 加 loading spinner
- batch operations 加進度回報

### 14. 日期格式化重複
**位置**：dashboard `tc-article-card.ts`、`page-logs.ts`
**做法**：
- 建立 `utils/formatting.ts`，統一 `formatDate()`、`formatDateTime()`

### 15. CSS 硬編碼顏色
**位置**：dashboard `tc-button.ts` 等
**做法**：
- Google login button 的 `white`、`#1f1f1f`、`#dadce0` 改用 CSS variables
- `page-logs.ts` 的 `#22c55e` 改用 `var(--color-success)`
