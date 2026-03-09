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
