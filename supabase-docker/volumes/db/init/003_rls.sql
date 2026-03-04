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
-- weekly
-- =============================================
CREATE POLICY "anon_read_weekly" ON public.weekly
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_weekly" ON public.weekly
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_weekly" ON public.weekly
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_weekly" ON public.weekly
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- articles
-- =============================================
CREATE POLICY "anon_read_articles" ON public.articles
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_articles" ON public.articles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_articles" ON public.articles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_articles" ON public.articles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- category
-- =============================================
CREATE POLICY "anon_read_category" ON public.category
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_category" ON public.category
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_category" ON public.category
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- audit_logs
-- =============================================
CREATE POLICY "anon_read_audit_logs" ON public.audit_logs
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read_audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_audit_logs" ON public.audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- allowed_users
-- =============================================
CREATE POLICY "service_role_all_allowed_users" ON public.allowed_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- books (補上 anon 讀取，原本只有 authenticated)
-- =============================================
CREATE POLICY "anon_read_books_category" ON public.books_category
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_write_books_category" ON public.books_category
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_books" ON public.books
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_write_books" ON public.books
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
