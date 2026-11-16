-- 장부와 통장은 회계·관리자만 쓸 수 있게 한다.
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번.
-- 여러 번 실행해도 안전하다.
--
-- ───────────────────────────────────────────────────────────
-- 왜 필요한가
-- ───────────────────────────────────────────────────────────
-- 지금 규칙(docs_write)은 config 와 profiles 를 뺀 모든 문서를
-- "로그인한 사람이면 누구나" 쓸 수 있게 열어 둔다. 행사·결재는
-- 승인 기록이 남으니 그래도 된다.
--
-- 그런데 장부(ledger)와 통장(banks)은 다르다. 통장 잔액 그 자체이고
-- 승인 단계가 없다. 화면에서는 회계·관리자에게만 고치는 단추를 보이지만,
-- 화면은 막아도 데이터베이스가 열려 있으면 막은 게 아니다.
--
-- ───────────────────────────────────────────────────────────
-- 돌리기 전에 알아둘 것
-- ───────────────────────────────────────────────────────────
-- 이걸 돌리면 '회계' 또는 '관리자'가 아닌 사람은
--   · 정산에서 「수입 받음」에 통장을 골라도 장부에 안 들어간다
--     (받은 수입 자체는 행사에 적히므로 기록은 남는다)
-- 읽기는 그대로 모두 열려 있다. 장부를 보는 건 누구나 된다.
--
-- 회계 역할은 docs/config/roles 문서에 담겨 있다. 역할 탭에서 지정한다.

-- ───────────────────────────────────────────────────────────
-- 1. 회계인가?
-- ───────────────────────────────────────────────────────────
create or replace function public.is_accounting()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select d.data -> 'map' ->> (auth.uid()::text)
       from public.docs d
      where d.collection = 'config' and d.id = 'roles') = 'accounting',
    false);
$$;

-- ───────────────────────────────────────────────────────────
-- 2. 쓰기 규칙을 다시 건다
-- ───────────────────────────────────────────────────────────
drop policy if exists docs_write on public.docs;

create policy docs_write on public.docs
  for all to authenticated
  using (
        collection <> 'config'
    and (collection <> 'profiles' or id = auth.uid()::text)
    and (collection not in ('ledger','banks')
         or public.is_admin() or public.is_accounting())
  )
  with check (
        collection <> 'config'
    and (collection <> 'profiles' or id = auth.uid()::text)
    and (collection not in ('ledger','banks')
         or public.is_admin() or public.is_accounting())
  );

-- ───────────────────────────────────────────────────────────
-- 3. 확인
-- ───────────────────────────────────────────────────────────
-- 본인이 회계/관리자로 잡히는지 본다. 둘 다 false 면 장부를 못 쓴다.
select public.is_admin() as 관리자, public.is_accounting() as 회계;

-- 어떤 컬렉션에 몇 줄이 있는지
select collection, count(*) from public.docs group by collection order by 1;
