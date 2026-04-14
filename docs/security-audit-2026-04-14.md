# Library 系統資安稽核報告

- **日期**：2026-04-14
- **範圍**：`worker/`（Fastify API）、`dashboard/`（Lit + Vite）、`supabase-docker/`（Kong + Supabase）
- **稽核依據**：ISO/IEC 27001:2022 Annex A、ISO/IEC 27034（應用程式安全）、OWASP Top 10 (2021)
- **工具**：npm audit、人工程式碼審查
- **限制**：本機未安裝 Trivy／Semgrep，故容器 CVE 掃描與 SAST 以人工方式補強

---

## 摘要

| 嚴重度 | 數量 | 代表項目 |
|:--|:--:|:--|
| 🔴 高 | 4 | 無 TLS／helmet、Kong 缺 rate-limit 全域 plugin、audit log 無保留政策、high 級 CVE（node-forge、fast-xml-parser、vite、rollup） |
| 🟠 中 | 7 | email-only 授權、錯誤全域處理缺失、sessionStorage 存 token、Firebase JSON 未驗證、容器以 root 執行、部分寫入 API 無 rate limit |
| 🟡 低 | 5 | CORS 本機 hardcode、caret 版本鎖定、PostgREST `.or()` 過濾可再強化、無密鑰輪替流程、npm audit 低級 CVE |

整體姿態：**及格但仍有提升空間**。無致命弱點，沒有 SQL Injection、未授權資料庫存取、或密鑰外洩。主要 gap 在 **縱深防禦（defense in depth）** 與 **合規化流程（政策、稽核、事件回應）**。

---

## 第一部分：ISO/IEC 27001:2022 Annex A 差異分析

### A.5 資訊安全政策（Organizational）

| 控制項 | 現狀 | 差距 |
|:--|:--|:--|
| A.5.1 政策 | 無書面政策 | ❌ 缺政策文件（密碼、可接受使用、存取、事件回應） |
| A.5.15 存取控制 | 僅 email allowlist（`allowed_users` 表） | 🟠 無 RBAC（admin/editor/viewer），單一 `is_active` 旗標 |
| A.5.19 供應商關係 | 依賴 Supabase、FlipHTML5、Firebase、Qwen3-TTS | 🟠 無供應商風險評估紀錄 |
| A.5.29 中斷期間 | Docker `restart: unless-stopped` | 🟠 無 DR/BCP 計畫、無 RTO/RPO 目標 |
| A.5.30 ICT 持續營運 | Docker named volume 備份（手動 `docker cp`） | 🟠 無定期備份排程與還原演練 |

**建議：** 建立 `/docs/security/` 資料夾，置入「資安政策」、「事件回應流程」、「備份與還原 SOP」三份文件。

### A.6 人員（People）

| 控制項 | 現狀 | 差距 |
|:--|:--|:--|
| A.6.3 資安教育 | — | 🟡 單人開發為主，低風險 |
| A.6.6 保密協議 | — | 🟡 N/A |

### A.7 實體（Physical）

| 控制項 | 現狀 | 差距 |
|:--|:--|:--|
| A.7.x | 雲端＋地端混合（Cloud Run、192.168.2.235） | 🟠 地端主機實體安全未記錄（鎖、監控、授權進出） |

### A.8 技術（Technological）— **重點**

| 控制項 | 現狀 | 差距 |
|:--|:--|:--|
| A.8.2 特權存取 | `service_role` key 僅存在 worker 容器環境變數 | 🟢 OK |
| A.8.3 資訊存取限制 | Dashboard 用 anon key + RLS；worker 用 service role | 🟢 OK，但 **未確認所有表都有 RLS policy** |
| A.8.5 安全驗證 | Supabase OAuth + email allowlist | 🟠 無 MFA；Supabase Studio 僅 Basic Auth |
| A.8.9 組態管理 | docker-compose + `.env`，無 IaC 工具 | 🟠 組態變更無審核紀錄 |
| A.8.10 資訊刪除 | — | ❌ 無「帳號刪除」、「書籍刪除後 PDF 清除」流程驗證 |
| A.8.12 資料外洩防護 | ❌ | ❌ 無 DLP；錯誤訊息可能外洩（詳見第二部分） |
| A.8.13 備份 | Docker volume 手動備份 | 🟠 無加密、無異地、無週期檢驗 |
| A.8.15 記錄 | `audit_logs` 表 | 🟠 欄位齊全但 **無保留政策**、**無異常告警** |
| A.8.16 監控 | console.log 為主 | ❌ 無集中式 log、無 SIEM、無 uptime 告警 |
| A.8.20 網路安全 | Kong API Gateway | 🟠 **8000/8443 綁 0.0.0.0**，雖有 Kong 保護但建議前置 Cloudflare／WAF |
| A.8.21 網路服務安全 | Kong key-auth + ACL | 🟢 OK |
| A.8.23 Web 過濾 | — | N/A |
| A.8.24 加密 | Supabase 預設 TLS | 🟠 **Kong YAML 內未見 HTTPS 強制轉向** |
| A.8.25 安全開發生命週期 | 無 SDLC 文件 | 🟠 無 code review 規範、無安全需求檢核 |
| A.8.26 應用程式安全需求 | — | 🟠 無威脅建模、無安全驗收測試 |
| A.8.27 安全架構 | — | 🟠 無架構安全審查 |
| A.8.28 安全編碼 | 有 OWASP 意識（見 CLAUDE.md） | 🟢 OK |
| A.8.29 測試 | 無自動化資安測試 | ❌ 無 SAST/DAST 在 CI |
| A.8.31 開發測試正式環境分離 | localhost vs librarypj.tzuchi-org.tw | 🟢 OK |
| A.8.32 變更管理 | Git commit | 🟠 無正式 CR/CAB 流程 |
| A.8.33 測試資訊 | — | 🟠 無測試資料遮蔽規範 |

### A.9 ～ A.18（舊版對照）

主要落差彙整：

- **事件管理（A.16）**：無事件通報管道、分類標準、RCA 模板。
- **營運持續（A.17）**：無 BCP 演練、無替代站點、無 service level objective。
- **合規（A.18）**：未對照個資法（PDPA）、書籍版權標註（`copyright` 欄位）但無使用追蹤。

---

## 第二部分：ISO/IEC 27034 + OWASP Top 10 程式碼審查

### A01：Broken Access Control（存取控制）

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 1 | 僅 email allowlist，無 role 分離 | `worker/src/middleware/auth.ts:18-22` | 🟠 中 |
| 2 | `requireAuth` 每次打 Supabase `auth.getUser()`，無快取與 timeout；若 Supabase 慢會卡住所有寫入 | `auth.ts:4-27` | 🟠 中 |
| 3 | Dashboard 存 session 於 `sessionStorage` | `dashboard/src/services/supabase.ts:6-12` | 🟠 中（XSS 可竊取） |
| 4 | Supabase RLS 未在本稽核中逐表確認 | `supabase-docker/volumes/*` | 🟠 中 |

**建議：**
- `allowed_users` 新增 `role` 欄位（`admin | editor | viewer`），在 `requireAuth` 後加 `requireRole('admin')` 守衛。
- 快取 token 驗證 30 秒；`auth.getUser()` 加 `AbortController` 2 秒 timeout。
- 確認所有表皆設 RLS；service_role 僅在 worker 使用。

### A02：Cryptographic Failures（加密失敗）

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 5 | Kong 未強制 HTTP→HTTPS 轉向 | `supabase-docker/volumes/api/kong.yml` | 🔴 高 |
| 6 | 無 HSTS、CSP、X-Frame-Options、X-Content-Type-Options | 全域缺 `@fastify/helmet` | 🔴 高 |
| 7 | Supabase session 存 `sessionStorage`（非 `HttpOnly` cookie） | dashboard | 🟠 中 |

**建議：**
- 安裝 `@fastify/helmet`，啟用 CSP（`default-src 'self'`、`connect-src` 加 Supabase 網域）、HSTS、`X-Frame-Options: DENY`。
- 前置 nginx 加 301：`http://` → `https://`。

### A03：Injection（注入）

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 8 | PostgREST `.or()` 過濾僅移除 `,()\\%` | `worker/src/routes/api-v1.ts:428` | 🟡 低 |
| 9 | 無 SQL raw query（Supabase client 參數化） | 全系統 | 🟢 OK |
| 10 | 子程序呼叫 `spawn('qpdf',[...])`、`spawn('pdftoppm',[...])` **argv 陣列形式**，非 shell；不過 quality 參數未 runtime 驗證 | `worker/src/services/pdf-compressor.ts:77,174` | 🟡 低 |

**建議：**
- `.or()` 關鍵字改為白名單：`keyword.replace(/[^\p{L}\p{N}\s\-_.@]/gu, '')`（保留中英文、數字、常見符號）。
- `compressPdf` 進入時 `if (!['screen','ebook','printer','prepress'].includes(quality)) quality='ebook'`。

### A04：Insecure Design（不安全設計）

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 11 | 無全域 `fastify.setErrorHandler()`，預設錯誤可能外洩 schema／內部路徑 | `worker/src/server.ts` | 🟠 中 |
| 12 | `/claude/status` 回傳 `detail: subprocess_stderr` 可能含路徑 | `server.ts:179-181` | 🟠 中 |
| 13 | `Book Reader SSR` 使用自訂 `escapeHtml`／`escapeAttr`／`safeJsonForScript` | `server.ts:99-138` | 🟢 OK |

**建議：**
```ts
fastify.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  const status = err.statusCode ?? 500;
  reply.status(status).send({
    error: err.name ?? 'INTERNAL_ERROR',
    message: status >= 500 ? 'Internal server error' : err.message,
  });
});
```

### A05：Security Misconfiguration（錯誤組態）

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 14 | Dockerfile 無 `USER` 指令，容器以 root 執行 | `worker/Dockerfile` | 🟠 中 |
| 15 | CORS 硬編 `localhost` 三個埠 | `worker/src/server.ts:28-35` | 🟡 低（正式環境需確認） |
| 16 | `KONG_PLUGINS` 清單未含 `rate-limiting` | `docker-compose.yml:88` | 🔴 高（Kong 層無法 rate limit） |
| 17 | Supabase Studio 僅 Basic Auth | `kong.yml:281-283` | 🟠 中 |

**建議：**
- Dockerfile 最後加 `USER node`，並 `chown` /app。
- `KONG_PLUGINS` 加入 `rate-limiting`，並在 `/auth/v1/token` 加每 IP 10 req/min。
- Studio 改綁 VPN 或 IP 白名單。

### A06：Vulnerable & Outdated Components（已知弱點）

見第三部分自動化掃描結果。

### A07：Identification & Authentication（認證）

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 18 | `/auth/v1/token` 無 rate limit（仰賴 Supabase） | `kong.yml:77-85` | 🟠 中 |
| 19 | `JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)` 未 try/catch | `push-notification.ts` | 🟡 低 |
| 20 | 無 MFA | 全系統 | 🟠 中（管理員帳號建議強制） |

### A08：Software & Data Integrity

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 21 | `curl ... \| bash` 安裝 Claude Code CLI | `Dockerfile:16` | 🟡 低（信任 anthropic.com，但無 checksum pin） |
| 22 | `package.json` 使用 caret（`^`）範圍 | `worker`、`dashboard` | 🟡 低（有 lockfile 保護） |

**建議：** Dockerfile 可鎖 Claude CLI 版本或 hash；CI 中執行 `npm ci`（非 `npm install`）。

### A09：Security Logging & Monitoring

| # | 發現 | 檔案 | 風險 |
|:--|:--|:--|:--|
| 23 | `audit_logs` 無 retention／歸檔 | DB | 🔴 高（無限成長） |
| 24 | 無集中式監控、無異常告警 | — | 🟠 中 |
| 25 | `console.log` 記錄儲存路徑、檔案大小（可接受） | 多處 | 🟢 OK |
| 26 | `/claude/status` 可能記錄 email 於 log | `server.ts:172-177` | 🟡 低 |

**建議：**
- Postgres 排程：每月將 6 個月以上的 audit_logs 匯出至 Storage cold bucket 後刪除。
- 寫入 audit 失敗時不應失敗整個請求，但要告警。

### A10：SSRF / XXE

- **JSON-only API**，無 XML 解析（除了依賴 `fast-xml-parser` — 見下方 CVE）。
- Worker 的 `fetch` 呼叫對象為硬編網域（FlipHTML5、Qwen3-TTS），無 SSRF 暴露面。
- 🟢 OK。

---

## 第三部分：自動化掃描結果

### npm audit — Worker

```
total: 14  |  critical: 0  |  high: 2  |  moderate: 4  |  low: 8
```

| 套件 | 版本範圍 | 嚴重度 | CVE 主題 |
|:--|:--|:--:|:--|
| **node-forge** | `<=1.3.3` | 🔴 high | Certificate chain `basicConstraints` bypass（GHSA-2328-f5f3-gj25） |
| **fast-xml-parser** | `>=5.0.0 <5.5.6` | 🔴 high | Numeric entity expansion DoS（GHSA-8gc5-j5rx-235r） |
| ajv | `<8.18.0` | 🟠 mod | ReDoS via `$data` |
| brace-expansion | `2.0.0 ~ 2.0.3` | 🟠 mod | Process hang |
| fastify | `<=5.7.2` | 🟠 mod | DoS via `sendWebStream` |
| yaml | `2.0.0 ~ 2.8.3` | 🟠 mod | Stack overflow |
| @tootallnate/once, http-proxy-agent, teeny-request, retry-request, google-gax, firebase-admin, @google-cloud/* | — | 🟡 low | 傳遞依賴 |

**備註：** `node-forge` 與 `fast-xml-parser` 都來自 `firebase-admin` 依賴鏈，實際使用路徑需要 Firebase 流程（推播）才觸發。建議 `npm update firebase-admin` 至最新 major。

### npm audit — Dashboard

```
total: 10  |  critical: 0  |  high: 7  |  moderate: 3  |  low: 0
```

| 套件 | 嚴重度 | CVE 主題 |
|:--|:--:|:--|
| **vite** | 🔴 high | Path Traversal in optimized deps `.map` |
| **rollup** | 🔴 high | Arbitrary File Write via Path Traversal |
| **path-to-regexp** (via @vaadin/router) | 🔴 high | Backtracking regex (ReDoS) |
| **minimatch** | 🔴 high | ReDoS |
| **@isaacs/brace-expansion** | 🔴 high | Uncontrolled resource |
| **picomatch** | 🔴 high | Method injection POSIX classes |
| esbuild | 🟠 mod | Dev server 任意網站可讀 response |

**備註：**
- Vite／Rollup／esbuild 皆為 **build-time dependency**，正式環境（已 build）不會曝露；但開發者本機仍有風險。
- `@vaadin/router` 的 `path-to-regexp` 為 runtime，需評估是否換掉 router 或等修補。
- 建議 `npm update` 並測試；若有 breaking change 再個案處理。

### 容器 CVE（Trivy）

- 本機未安裝，**建議補跑**：
  ```bash
  brew install trivy
  trivy image library-worker:latest
  trivy image supabase/storage-api:latest
  trivy image kong:2.8.1
  ```

### SAST（Semgrep）

- 本機未安裝，**建議補跑**：
  ```bash
  brew install semgrep
  semgrep --config=p/owasp-top-ten --config=p/typescript --config=p/nodejs worker/ dashboard/
  ```

---

## 優先修復路線圖

### 🔴 Week 1（高風險、低改動量）

1. **加 `@fastify/helmet`**：CSP、HSTS、X-Frame-Options（2 小時）
2. **加全域 `setErrorHandler`**：避免錯誤外洩（1 小時）
3. **Kong 啟用 `rate-limiting` plugin**：全域 + `/auth/v1/token` 嚴格（2 小時）
4. **升級 `firebase-admin`**：解 node-forge / fast-xml-parser（0.5 小時 + 測試）
5. **Dashboard `npm update` + 重 build 驗收**：解 7 個 high CVE（半天）

### 🟠 Week 2～3（中風險）

6. `allowed_users` 加 `role` 欄位 + `requireRole()` middleware
7. `requireAuth` 加 token cache（30s）與 timeout
8. `audit_logs` 歸檔排程（pg_cron 或 scheduler）
9. Dockerfile 改用 non-root user
10. PostgREST `.or()` 關鍵字改白名單
11. `compressPdf` 輸入參數 runtime 驗證

### 🟡 Week 4+（持續改善）

12. 建立 `/docs/security/` 政策三件套（政策、事件回應、備份 SOP）
13. CI 整合 `npm audit --production --audit-level=high` fail gate
14. 新增 Trivy、Semgrep 到 CI
15. Supabase RLS 全表盤點
16. 管理員 MFA（至少 Supabase Studio 改走 OAuth／VPN）
17. 集中式 log：worker logs → Loki／Grafana 或 Supabase logs_ingester

---

## ISO 27001 認證成熟度評估

若目標是取得 ISO 27001 認證：

| 面向 | 當前 | 目標 | Gap |
|:--|:--:|:--:|:--:|
| 政策文件 | 0% | 100% | ⬛⬛⬛⬛⬛ |
| 技術控制 | 60% | 90% | ⬛⬛ |
| 監控告警 | 20% | 80% | ⬛⬛⬛ |
| 事件回應 | 0% | 80% | ⬛⬛⬛⬛ |
| 持續營運 | 30% | 80% | ⬛⬛⬛ |

**時程估計：** 若全職推動，最快 4～6 個月可達 Stage 1 稽核；兼職下建議以「定期補強」心態 6～12 個月達標。

---

## 附錄 A：不納入風險清單

下列項目經人工審查判斷風險可接受，不列入修復範圍：

- PDF magic bytes 驗證 + qpdf／pdftoppm argv 陣列注入 → 安全
- SSR 模板 HTML escape → 安全
- Service role key 僅存 worker 環境變數 → 安全
- Supabase Storage 上傳路徑伺服端產生（`randomUUID`）→ 安全

## 附錄 B：相關檔案索引

- `worker/src/middleware/auth.ts`
- `worker/src/routes/books.ts`、`api-v1.ts`、`articles.ts`
- `worker/src/services/supabase.ts`、`pdf-compressor.ts`、`push-notification.ts`
- `worker/Dockerfile`
- `supabase-docker/docker-compose.yml`
- `supabase-docker/volumes/api/kong.yml`
- `dashboard/src/services/supabase.ts`、`stores/auth-store.ts`

---

_本報告以 ISO/IEC 27001:2022 與 OWASP Top 10 (2021) 為基礎，結合 npm audit 結果撰寫。實際認證需由第三方驗證機構確認。_
