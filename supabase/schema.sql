-- 마블 ERP — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번.
-- 여러 번 실행해도 안전하다.

-- ───────────────────────────────────────────────────────────
-- 1. 문서 저장소
--    Artifact의 db와 같은 모양으로 둔다. collection/id/JSON 한 장.
--    events · approvals · docs · txns · config
-- ───────────────────────────────────────────────────────────
create table if not exists public.docs (
  collection  text        not null,
  id          text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users(id),
  primary key (collection, id)
);

create index if not exists docs_collection_idx on public.docs (collection);

-- ───────────────────────────────────────────────────────────
-- 2. 구성원과 역할
--    role: member | accounting | ceo | admin
--    admin 은 역할을 바꿀 수 있는 사람 (관리자)
-- ───────────────────────────────────────────────────────────
create table if not exists public.members (
  uid        uuid        primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text        not null default 'member',
  created_at timestamptz not null default now()
);

-- 로그인하면 본인 행이 자동으로 생긴다
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.members (uid, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (uid) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────────────────────────────────────
-- 3. 접근 규칙 (RLS)
--    로그인한 사람만 들어온다. 로그인하면 전부 읽을 수 있다.
--    쓰기는 config 만 관리자로 제한한다.
-- ───────────────────────────────────────────────────────────
alter table public.docs    enable row level security;
alter table public.members enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.members m where m.uid = auth.uid() and m.role = 'admin');
$$;

drop policy if exists docs_read        on public.docs;
drop policy if exists docs_write       on public.docs;
drop policy if exists docs_write_admin on public.docs;

create policy docs_read on public.docs
  for select to authenticated using (true);

-- config 를 제외한 모든 문서는 로그인한 사람이 쓸 수 있다
create policy docs_write on public.docs
  for all to authenticated
  using      (collection <> 'config')
  with check (collection <> 'config');

-- config(역할 지정 등)는 관리자만
create policy docs_write_admin on public.docs
  for all to authenticated
  using      (collection = 'config' and public.is_admin())
  with check (collection = 'config' and public.is_admin());

drop policy if exists members_read         on public.members;
drop policy if exists members_self_insert  on public.members;
drop policy if exists members_admin_manage on public.members;

create policy members_read on public.members
  for select to authenticated using (true);

-- 본인 행은 본인이 만들 수 있다. 단 역할은 member 로만.
create policy members_self_insert on public.members
  for insert to authenticated
  with check (uid = auth.uid() and role = 'member');

-- 역할 변경은 관리자만
create policy members_admin_manage on public.members
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 4. 실시간 동기화
--    한 사람이 바꾸면 다른 사람 화면이 바로 따라간다
-- ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────
-- 5. 첫 관리자 지정
--    맨 처음 로그인한 뒤, 아래 줄의 주소를 본인 것으로 바꿔 한 번 실행한다.
--    (로그인 전에 실행하면 대상 행이 없어 아무 일도 일어나지 않는다)
-- ───────────────────────────────────────────────────────────
-- update public.members set role = 'admin' where email = '여기에@본인주소.com';
