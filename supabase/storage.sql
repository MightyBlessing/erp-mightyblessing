-- 마이티블레싱 업무관리시스템 — 증빙 보관함
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번.
-- 여러 번 실행해도 안전하다.
--
-- 영수증·견적서·이체확인증 같은 증빙 파일이 여기 들어간다.
-- 문서(docs)에는 파일 경로와 아주 작은 미리보기만 남는다.
-- 파일 자체를 JSON 안에 넣으면 문서함을 열 때마다 전부 따라 내려와서 느려진다.

-- ───────────────────────────────────────────────────────────
-- 1. 비공개 버킷
--    public = false 이므로 주소를 알아도 로그인 없이는 못 연다.
--    열 때마다 10분짜리 서명 주소를 그때그때 만들어 쓴다.
-- ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 15728640)   -- 15MB
on conflict (id) do update set public = false, file_size_limit = 15728640;

-- ───────────────────────────────────────────────────────────
-- 2. 접근 규칙
--    읽기  : 로그인한 사람 전원 (결재자가 증빙을 봐야 한다)
--    올리기: 로그인한 사람 전원
--    지우기: 자기가 올린 파일만
--
--    ※ 올릴 때 owner 를 검사하면 안 된다.
--      요즘 Supabase 는 올린 사람을 owner_id(text)에 적고 owner(uuid)는 비워 둔다.
--      NULL = auth.uid() 는 거짓이 아니라 NULL 이라 규칙을 통과하지 못하고,
--      업로드가 그대로 거절된다. 올리는 사람은 어차피 로그인한 사람이다.
-- ───────────────────────────────────────────────────────────
drop policy if exists evidence_read   on storage.objects;
drop policy if exists evidence_insert on storage.objects;
drop policy if exists evidence_update on storage.objects;
drop policy if exists evidence_delete on storage.objects;

create policy evidence_read on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence');

create policy evidence_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence');

create policy evidence_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'evidence')
  with check (bucket_id = 'evidence');

-- 지울 때만 올린 사람을 본다. 두 칸 중 어느 쪽에 적혀 있어도 맞게 본다.
create policy evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidence'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
  );

-- ───────────────────────────────────────────────────────────
-- 3. 확인
--    여기까지 같이 실행하면 버킷과 규칙이 제대로 들어갔는지 눈으로 보인다.
-- ───────────────────────────────────────────────────────────
select id, public, file_size_limit from storage.buckets where id = 'evidence';

select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'evidence%'
order by policyname;
