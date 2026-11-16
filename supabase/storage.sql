-- 마블 ERP — 증빙 보관함
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번.
-- 여러 번 실행해도 안전하다.
--
-- 영수증·견적서·이체확인증 같은 증빙 파일이 여기 들어간다.
-- 문서(docs)에는 파일 이름과 경로, 그리고 아주 작은 미리보기만 남는다.
-- 파일 자체를 JSON 안에 넣으면 문서함을 열 때마다 전부 따라 내려와서 느려진다.

-- ───────────────────────────────────────────────────────────
-- 1. 비공개 버킷
--    public = false 이므로 주소를 알아도 로그인 없이는 못 연다.
--    여는 순간 10분짜리 서명 주소를 그때그때 만들어 쓴다.
-- ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 15728640)   -- 15MB
on conflict (id) do update set public = false, file_size_limit = 15728640;

-- ───────────────────────────────────────────────────────────
-- 2. 접근 규칙
--    읽기: 로그인한 사람 전원 (결재자가 증빙을 봐야 한다)
--    쓰기: 로그인한 사람 전원
--    삭제: 자기가 올린 파일만
-- ───────────────────────────────────────────────────────────
drop policy if exists evidence_read   on storage.objects;
drop policy if exists evidence_insert on storage.objects;
drop policy if exists evidence_delete on storage.objects;

create policy evidence_read on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence');

create policy evidence_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence' and owner = auth.uid());

create policy evidence_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'evidence' and owner = auth.uid());
