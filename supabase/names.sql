-- 구성원 이름을 실명(한글)으로 맞춘다.
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번.
-- 여러 번 실행해도 안전하다.
--
-- 메일 링크로 처음 들어온 사람은 이름이 메일 앞글자(hyunyoung 같은)로 들어가 있다.
-- 구글 계정으로 들어오면 구글에 적힌 이름이 그대로 들어오지만,
-- 이미 만들어진 행은 덮어쓰지 않으므로 여기서 한 번 맞춰 준다.
--
-- 이름 출처: 슬랙 #dev-erp 구성원 명단 (2026-11-16 기준)

-- ───────────────────────────────────────────────────────────
-- 1. 이미 들어와 있는 사람들
-- ───────────────────────────────────────────────────────────
update public.members m
set name = v.name
from (values
  ('hyunyoung@mightyblessing.com', '최현영'),
  ('hyeonbin@mightyblessing.com',  '성현빈'),
  ('juncheol@mightyblessing.com',  '김준철'),
  ('sehun@mightyblessing.com',     '정세훈'),
  ('nayeun@mightyblessing.com',    '고나연'),
  ('subin@mightyblessing.com',     '양수빈'),
  ('yeonhun@mightyblessing.com',   '최연훈'),
  ('jinho@mightyblessing.com',     '옥진호'),
  ('jaehoon@mightyblessing.com',   '재훈'),
  ('auhjin@mightyblessing.com',    '어진'),
  ('hyunbae@mightyblessing.com',   '현배')
) as v(email, name)
where lower(m.email) = v.email
  and coalesce(m.name, '') is distinct from v.name;

-- 재훈·어진·현배 는 슬랙에도 성 없이 올라와 있다.
-- 성까지 넣으려면 위 세 줄만 고쳐서 다시 실행하면 된다.

-- ───────────────────────────────────────────────────────────
-- 2. 앞으로 들어오는 사람
--    구글 계정으로 들어오면 구글에 적힌 이름을 쓴다.
--    그게 없을 때만 메일 앞글자를 쓴다.
-- ───────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.members (uid, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (uid) do nothing;
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 3. 확인
-- ───────────────────────────────────────────────────────────
select email, name, role, created_at
from public.members
order by name;
