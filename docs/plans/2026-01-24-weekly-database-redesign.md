# Weekly System Database Redesign

## Background

Redesign the weekly publication system database schema, optimizing the import flow from Google Docs to structured data.

## Old Flow (Problems)

1. Editors write in Google Docs (8 tabs = 8 categories)
2. Manually download `.md` from each tab (8 times)
3. Pre-create `weekly` record
4. Import each category `.md` → `articles` table
5. AI transforms `articles` → `digital` table

Issues: manual repetitive downloads, dual tables with identical structure, complex rule-based parsing.

## New Flow

1. Google Docs `export?format=md` → single `.md` file (H1 separates categories)
2. Convert base64 images → store in Supabase bucket
3. Store `original.md` (with image URLs) in bucket
4. AI (Claude Code SDK TS, Max account) parses and splits content → JSON
5. User confirms JSON structure
6. Import → `articles` table (`platform = 'docs'`)
7. AI rewrites for web → `articles` table (`platform = 'digital'`)
8. All operations → `audit_logs`

## Bucket Structure

```
bucket: weekly

articles/
  {weekly_id}/
    images/
      image1.jpg
      image2.jpg
      ...
    original.md
```

## Database Schema

### weekly

Manages publication issues and their lifecycle.

```sql
create table public.weekly (
  week_number integer not null,
  status text not null default 'draft',
  publish_date date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_pkey primary key (week_number),
  constraint weekly_status_check check (
    status in ('draft', 'published', 'archived')
  )
);
```

### category

8 fixed categories corresponding to newspaper sections.

```sql
create table public.category (
  id bigserial not null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint category_pkey primary key (id),
  constraint category_name_key unique (name)
);
```

### articles

Merged table (previously `articles` + `digital`). Uses `platform` field to distinguish docs original vs AI-rewritten web version.

```sql
create table public.articles (
  id bigserial not null,
  weekly_id integer not null,
  category_id bigint not null,
  platform text not null default 'docs',
  title text not null,
  content text not null,
  order_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_pkey primary key (id),
  constraint articles_unique_entry unique (weekly_id, category_id, platform, order_number),
  constraint articles_weekly_id_fkey foreign key (weekly_id) references weekly (week_number) on delete cascade,
  constraint articles_category_id_fkey foreign key (category_id) references category (id) on delete restrict,
  constraint articles_platform_check check (
    platform in ('docs', 'digital')
  )
);

create index idx_articles_weekly_id on public.articles using btree (weekly_id);
create index idx_articles_category_id on public.articles using btree (category_id);
create index idx_articles_platform on public.articles using btree (platform);
```

### allowed_users

Google OAuth whitelist. Only listed accounts can log in. No roles.

```sql
create table public.allowed_users (
  id bigserial not null,
  email text not null,
  name text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint allowed_users_pkey primary key (id),
  constraint allowed_users_email_key unique (email)
);
```

### audit_logs

Complete audit trail for all operations including login, CRUD, import, and AI transforms. Stores full before/after data.

```sql
create table public.audit_logs (
  id bigserial not null,
  user_email text null,
  action text not null,
  table_name text null,
  record_id bigint null,
  old_data jsonb null,
  new_data jsonb null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  constraint audit_logs_pkey primary key (id),
  constraint audit_logs_action_check check (
    action in ('login', 'logout', 'insert', 'update', 'delete', 'import', 'ai_transform')
  )
);

create index idx_audit_logs_action on public.audit_logs using btree (action);
create index idx_audit_logs_table_record on public.audit_logs using btree (table_name, record_id);
create index idx_audit_logs_created_at on public.audit_logs using btree (created_at desc);
create index idx_audit_logs_user_email on public.audit_logs using btree (user_email);
```

## Key Design Decisions

1. **Merged articles + digital** → single table with `platform` field (print vs digital content versions)
2. **Content stored as Markdown** → API converts to HTML at response time
3. **Removed `images` jsonb field** → image URLs embedded in markdown content
4. **Removed `featured` field** → no longer used
5. **No triggers** → `updated_at` managed by application layer
6. **AI parsing via Claude Code SDK** → replaces fragile rule-based parsing
7. **Audit logs cover all operations** → including import progress and AI transforms
8. **Google OAuth whitelist** → simple auth, no roles needed

## API Output

- Default: returns HTML (converted from markdown)
- `?format=md`: returns raw markdown (for editing/reprocessing)
