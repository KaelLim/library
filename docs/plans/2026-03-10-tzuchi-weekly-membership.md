# tzuchi-weekly 會員制設計

## 目的

在 tzuchi-weekly（Next.js 前端）加入會員登入機制，收集用戶資訊並追蹤使用行為。文稿內容需登入才能閱讀。

## 認證方式

- **Google OAuth**（主要）— 透過現有 Supabase Auth（GoTrue）
- **Phone OTP**（輔助）— every8D（台灣 +886）+ Twilio（海外）
- 共用現有 `supabase-docker` instance，與 dashboard 同一個 `auth.users`
- 登入即會員，無需審核

### SMS 雙 Provider

Supabase GoTrue 內建只支援單一 SMS provider，需自建 OTP 發送邏輯：

- Worker 新增 OTP 端點：產生驗證碼 → 依國碼選 provider 發送 → 驗證
- `+886` 開頭 → every8D API
- 其他國碼 → Twilio API

## 資料表變更

### push_subscriptions — 加 user_id

```sql
ALTER TABLE push_subscriptions
  ADD COLUMN user_id uuid REFERENCES auth.users(id);
```

未來可針對特定會員推播。

### 不新建的表

- **members** — 不建立，`auth.users` 已包含 email、phone、metadata 等用戶資訊
- **member_activity** — 不建立，行為追蹤由 GTM + GA4 處理

## 存取控制

### 角色區分

| 角色 | 認證方式 | 權限判斷 |
|------|---------|---------|
| Dashboard 管理員 | Google OAuth | `allowed_users` 表 |
| tzuchi-weekly 會員 | Google OAuth / Phone OTP | `auth.users` 存在即可 |

### Next.js Middleware

- 未登入 → 導向 `/login` 頁面
- 已登入 → 正常存取文稿頁面
- 使用 `@supabase/ssr` 處理 server-side session

### Worker API 認證

現有 `/api/v1/*` 為公開端點，加入會員制後：

- 文稿相關 API（articles、weekly）需驗證 Supabase access token
- Next.js SSR 呼叫 Worker 時需轉發使用者的 token
- Worker 用 `supabase.auth.getUser(token)` 驗證

### SEO 策略

- **標題、description** — Next.js 靜態輸出，搜尋引擎可索引
- **文稿內文** — 需登入才能取得，搜尋引擎不可見

## 行為追蹤

- **GTM + GA4** — 頁面瀏覽、停留時間、流量來源等通用分析
- **CDP + Looker Studio** — 已有廠商協助，可串接 GA4 資料
- 不自建 activity table

## 帳號合併（未來）

現階段 Google 和 Phone 分開註冊會產生兩個 UID，不做自動合併。

預留設計：
- 所有表用 `user_id` 關聯 `auth.users(id)`
- 未來需要合併時，使用者在帳號設定頁主動綁定
- 若目標 identity 已被另一帳號使用，後端執行：資料轉移 → 刪除舊帳號 → 綁定 identity
- 合併規則：以較早註冊的帳號為主

## 不做的事

- 不建 members 表
- 不建 member_activity 表
- 不做帳號自動合併
- 不做會員審核機制
- 不做會員等級/VIP 功能

## 影響範圍

| 專案 | 變更 |
|------|------|
| **tzuchi-weekly** | 加 Supabase Auth、login 頁面、middleware、API 呼叫帶 token |
| **worker** | `/api/v1/*` 文稿端點加 token 驗證、新增 OTP 端點 |
| **supabase-docker** | 啟用 Phone provider、設定 Google OAuth redirect URI |
| **dashboard** | 不變 |
