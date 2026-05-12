-- ============================================================
-- EDM API: 取得最新一期週報（含 digital 文稿與圖片）
-- ============================================================
-- 呼叫方式（PostgREST RPC）：
--   GET /rest/v1/rpc/get_latest_weekly_for_edm
--   Header: apikey: <anon_key>
--
-- 判定規則：
--   status = 'published' 中 week_number 最大
--   只回傳 platform = 'digital' 文稿
--   每篇文章附 images 陣列（從 content markdown 抽出）
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_latest_weekly_for_edm()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT week_number, status, publish_date, created_at, updated_at
    FROM public.weekly
    WHERE status = 'published'
    ORDER BY week_number DESC
    LIMIT 1
  ),
  arts AS (
    SELECT
      a.id,
      a.weekly_id,
      a.category_id,
      a.title,
      a.description,
      a.content,
      a.created_at,
      a.updated_at,
      c.name AS category_name,
      c.sort_order AS category_sort_order,
      COALESCE(
        (SELECT jsonb_agg(m[1] ORDER BY ord)
         FROM regexp_matches(
           a.content,
           '!\[[^\]]*\]\(([^[:space:])]+)\)',
           'g'
         ) WITH ORDINALITY AS t(m, ord)),
        '[]'::jsonb
      ) AS images
    FROM public.articles a
    JOIN public.category c ON c.id = a.category_id
    WHERE a.weekly_id = (SELECT week_number FROM latest)
      AND a.platform = 'digital'
  ),
  cats AS (
    SELECT
      category_id,
      MAX(category_name) AS name,
      MAX(category_sort_order) AS sort_order,
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'title', title,
          'description', description,
          'content', content,
          'images', images,
          'created_at', created_at,
          'updated_at', updated_at
        ) ORDER BY id ASC
      ) AS articles
    FROM arts
    GROUP BY category_id
  )
  SELECT jsonb_build_object(
    'week_number', l.week_number,
    'status', l.status,
    'publish_date', l.publish_date,
    'created_at', l.created_at,
    'updated_at', l.updated_at,
    'article_count', (SELECT COUNT(*) FROM arts),
    'categories', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', category_id,
          'name', name,
          'sort_order', sort_order,
          'articles', articles
        ) ORDER BY sort_order ASC, category_id ASC
      ) FROM cats),
      '[]'::jsonb
    )
  )
  FROM latest l;
$$;

COMMENT ON FUNCTION public.get_latest_weekly_for_edm() IS
  'EDM 用：回傳最新一期已發佈週報（含 digital 文稿與圖片陣列）。';

GRANT EXECUTE ON FUNCTION public.get_latest_weekly_for_edm() TO anon, authenticated;
