-- 로그인 가능한 주소를 제한한다.
-- 회사 도메인(@mightyblessing.com)은 자동 허용, 그 밖의 주소는 명단에 있어야 한다.
-- SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.

-- ───────────────────────────────────────────────────────────
-- 1. 예외 명단 (외부 인력 · 지메일 등)
-- ───────────────────────────────────────────────────────────
create table if not exists public.allowed_emails (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

drop policy if exists allowed_read  on public.allowed_emails;
drop policy if exists allowed_admin on public.allowed_emails;

create policy allowed_read on public.allowed_emails
  for select to authenticated using (true);

create policy allowed_admin on public.allowed_emails
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 2. 가입 차단
--    회사 도메인이 아니고 명단에도 없으면 계정이 만들어지지 않는다.
--    계정이 안 만들어지므로 로그인 메일도 발송되지 않는다.
-- ───────────────────────────────────────────────────────────
create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if lower(new.email) like '%@mightyblessing.com' then
    return new;
  end if;
  if exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    return new;
  end if;
  raise exception '허용되지 않은 이메일 주소입니다: %', new.email;
end;
$$;

drop trigger if exists on_auth_user_domain on auth.users;
create trigger on_auth_user_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();

-- ───────────────────────────────────────────────────────────
-- 3. 외부 인력을 들일 때
--    아래 한 줄을 주소만 바꿔 실행하면 그 사람도 로그인할 수 있다.
-- ───────────────────────────────────────────────────────────
-- insert into public.allowed_emails (email, note)
-- values ('someone@gmail.com', '외부 공연팀 OOO')
-- on conflict (email) do nothing;

-- 이미 들어와 있는 계정 확인
select email, created_at from auth.users order by created_at;
