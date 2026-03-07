# FCM Push Notification on Weekly Publish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When publishing a weekly report, automatically send FCM push notification to all subscribers, with a toggle to disable it.

**Architecture:** Frontend-triggered approach. Dashboard adds a toggle switch next to the publish button (default ON). On publish, after status update succeeds, calls worker `/push/send` endpoint. Also adds `push_subscriptions` table to DB init scripts and a send-push service function to the dashboard.

**Tech Stack:** Lit Web Components (dashboard), Fastify (worker), PostgreSQL (Supabase), Firebase Cloud Messaging

---

### Task 1: Add `push_subscriptions` table to DB init SQL

**Files:**
- Create: `supabase-docker/volumes/db/init/004_push_subscriptions.sql`

**Step 1: Create the init SQL file**

```sql
-- =============================================
-- Push Notification Subscriptions
-- =============================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id SERIAL NOT NULL,
  token TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
  ON public.push_subscriptions (active) WHERE active = true;

-- RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- anon can subscribe/unsubscribe (frontend users)
CREATE POLICY "push_subscriptions_anon_insert" ON public.push_subscriptions
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "push_subscriptions_anon_update" ON public.push_subscriptions
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- authenticated can read all + manage
CREATE POLICY "push_subscriptions_auth_all" ON public.push_subscriptions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- service_role bypasses RLS automatically
```

**Step 2: Verify SQL syntax**

Run: `docker exec supabase-db psql -U postgres -c "\i /dev/stdin" < supabase-docker/volumes/db/init/004_push_subscriptions.sql`

Expected: No errors (table already exists, so `IF NOT EXISTS` should pass cleanly)

**Step 3: Commit**

```bash
git add supabase-docker/volumes/db/init/004_push_subscriptions.sql
git commit -m "feat: add push_subscriptions table to DB init scripts"
```

---

### Task 2: Add `sendPushNotification` to dashboard worker service

**Files:**
- Modify: `dashboard/src/services/worker.ts`

**Step 1: Add the service function**

Append to `dashboard/src/services/worker.ts` after the existing exports:

```typescript
export interface PushNotificationRequest {
  title: string;
  body: string;
  url?: string;
}

export interface PushNotificationResponse {
  sent: number;
  failed: number;
}

export async function sendPushNotification(
  request: PushNotificationRequest
): Promise<PushNotificationResponse> {
  return fetchWorker<PushNotificationResponse>('/api/v1/push/send', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
```

Note: The worker `/push/send` route is under the `api-v1` plugin, so the path through Kong is `/worker/api/v1/push/send`. The `fetchWorker` function prepends `WORKER_URL` (which is `/worker`), so the endpoint parameter should be `/api/v1/push/send`.

**Step 2: Verify TypeScript compiles**

Run: `cd dashboard && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add dashboard/src/services/worker.ts
git commit -m "feat: add sendPushNotification to dashboard worker service"
```

---

### Task 3: Add push notification toggle and integrate with publish flow

**Files:**
- Modify: `dashboard/src/pages/page-weekly-detail.ts`

**Step 1: Add import**

Add `sendPushNotification` to the import from worker service:

```typescript
import { rewriteArticle, sendPushNotification } from '../services/worker.js';
```

**Step 2: Add state property**

Add to the class properties (near the other `@state()` declarations around line 220-230):

```typescript
@state()
private sendPushOnPublish = true;
```

**Step 3: Add toggle-switch CSS**

Add these styles to the component's `static styles` (reuse the existing pattern from `tc-book-upload-dialog.ts`):

```css
.publish-options {
  display: flex;
  align-items: center;
  gap: var(--spacing-3, 12px);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-2, 8px);
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
}

.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-accent);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}
```

**Step 4: Update render — replace publish button with publish-options group**

Find the draft status block (around line 347-356) and replace:

```typescript
${this.weekly?.status === 'draft'
  ? html`
      <div class="publish-options">
        <label class="toggle-label">
          <label class="toggle-switch">
            <input
              type="checkbox"
              ?checked=${this.sendPushOnPublish}
              @change=${(e: Event) => (this.sendPushOnPublish = (e.target as HTMLInputElement).checked)}
            />
            <span class="toggle-slider"></span>
          </label>
          推播通知
        </label>
        <tc-button variant="primary" @click=${this.handlePublish}>
          <svg slot="icon" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
          發布
        </tc-button>
      </div>
    `
  : ''}
```

**Step 5: Update `handlePublish` method**

Replace the existing `handlePublish` (line 513-528) with:

```typescript
private async handlePublish(): Promise<void> {
  if (!this.weekly) return;

  try {
    await updateWeeklyStatus(
      this.weekNumber,
      'published',
      new Date().toISOString().split('T')[0]
    );
    toastStore.success('週報已發布');

    // Send push notification if enabled
    if (this.sendPushOnPublish) {
      try {
        const result = await sendPushNotification({
          title: `慈濟週報 第 ${this.weekNumber} 期`,
          body: '最新一期週報已上線，立即閱讀！',
          url: `/weekly/${this.weekNumber}`,
        });
        toastStore.success(`推播已發送（${result.sent} 人）`);
      } catch (pushError) {
        console.error('Push notification error:', pushError);
        toastStore.error('週報已發布，但推播通知發送失敗');
      }
    }

    await this.loadData();
  } catch (error) {
    console.error('Publish error:', error);
    toastStore.error('發布失敗');
  }
}
```

**Step 6: Verify TypeScript compiles**

Run: `cd dashboard && npx tsc --noEmit`

Expected: No errors

**Step 7: Commit**

```bash
git add dashboard/src/pages/page-weekly-detail.ts
git commit -m "feat: add push notification toggle to weekly publish flow"
```

---

### Task 4: Build, deploy, and verify

**Step 1: Build dashboard**

Run: `cd dashboard && npm run build`

Expected: Build succeeds

**Step 2: Deploy to Docker**

Run: `cd supabase-docker && docker compose up -d --build dashboard`

Expected: Dashboard container rebuilt and running

**Step 3: Verify in browser**

1. Open `http://localhost:8000`
2. Navigate to a draft weekly report (`/weekly/{id}`)
3. Confirm toggle switch appears next to the publish button (default ON)
4. Confirm toggle can be switched OFF/ON
5. (Optional) Publish with toggle ON and verify push notification is sent

**Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: adjustments from manual verification"
```
