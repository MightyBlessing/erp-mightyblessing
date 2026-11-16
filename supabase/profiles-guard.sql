-- 프로필 사진은 본인만 바꿀 수 있게 한다.
-- 기본 규칙(docs_write)은 config 를 뺀 모든 문서를 누구나 쓸 수 있게 열어둔다.
-- 프로필은 남이 바꿀 수 있으면 곤란하므로 한 겹 더 건다.
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전하다.

drop policy if exists docs_write on public.docs;

create policy docs_write on public.docs
  for all to authenticated
  using      (collection <> 'config' and (collection <> 'profiles' or id = auth.uid()::text))
  with check (collection <> 'config' and (collection <> 'profiles' or id = auth.uid()::text));

-- 확인: 프로필은 읽기만 되고, 본인 것만 쓸 수 있어야 한다.
select collection, count(*) from public.docs group by collection order by 1;
