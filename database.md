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

create table public.category (
  id bigserial not null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint category_pkey primary key (id),
  constraint category_name_key unique (name)
);

create table public.articles (
  id bigserial not null,
  weekly_id integer not null,
  category_id bigint not null,
  platform text not null default 'docs',
  title text not null,
  description text null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_pkey primary key (id),
  constraint articles_weekly_id_fkey foreign key (weekly_id) references weekly (week_number) on delete cascade,
  constraint articles_category_id_fkey foreign key (category_id) references category (id) on delete restrict,
  constraint articles_platform_check check (
    platform in ('docs', 'digital')
  )
);

create index idx_articles_weekly_id on public.articles using btree (weekly_id);
create index idx_articles_category_id on public.articles using btree (category_id);
create index idx_articles_platform on public.articles using btree (platform);

create table public.allowed_users (
  id bigserial not null,
  email text not null,
  name text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint allowed_users_pkey primary key (id),
  constraint allowed_users_email_key unique (email)
);

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
