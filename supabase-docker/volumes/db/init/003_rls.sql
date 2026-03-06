-- =============================================
-- RLS Policies for all tables
-- =============================================

-- 週報系統
ALTER TABLE public.weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_users ENABLE ROW LEVEL SECURITY;

-- =============================================
-- weekly (公開可讀，寫入需驗證)
-- =============================================
CREATE POLICY "anon_read_weekly" ON public.weekly
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_weekly" ON public.weekly
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_weekly" ON public.weekly
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true));

CREATE POLICY "service_role_all_weekly" ON public.weekly
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- articles (公開可讀，寫入需驗證)
-- =============================================
CREATE POLICY "anon_read_articles" ON public.articles
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_articles" ON public.articles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_articles" ON public.articles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true));

CREATE POLICY "service_role_all_articles" ON public.articles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- category (公開可讀，僅 service_role 可寫)
-- =============================================
CREATE POLICY "anon_read_category" ON public.category
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_category" ON public.category
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_category" ON public.category
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- audit_logs (僅 authenticated + service_role 可讀寫)
-- =============================================
CREATE POLICY "authenticated_read_audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true));

CREATE POLICY "service_role_all_audit_logs" ON public.audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- allowed_users (僅 service_role)
-- =============================================
CREATE POLICY "service_role_all_allowed_users" ON public.allowed_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- books_category (公開可讀，寫入需驗證)
-- =============================================
CREATE POLICY "anon_read_books_category" ON public.books_category
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_write_books_category" ON public.books_category
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true));

-- =============================================
-- books (公開可讀，寫入需驗證)
-- =============================================
CREATE POLICY "anon_read_books" ON public.books
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_write_books" ON public.books
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.allowed_users WHERE email = auth.jwt() ->> 'email' AND is_active = true));
