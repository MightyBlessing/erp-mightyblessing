-- 매일 아침 예약 알림을 깨운다.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
--
-- ───────────────────────────────────────────────────────────
-- 왜 필요한가
-- ───────────────────────────────────────────────────────────
-- ERP 는 브라우저에서 도는 화면 한 장이다. 아무도 안 켜면 아무 일도
-- 안 일어난다. 「내일이 지급 예정일입니다」를 보낼 주체가 없다.
-- 그래서 데이터베이스가 매일 한 번 함수를 깨운다.
--
-- ───────────────────────────────────────────────────────────
-- 돌리기 전에
-- ───────────────────────────────────────────────────────────
-- 1. Edge Function 을 먼저 올린다
--      supabase functions deploy erp-slack
-- 2. 환경변수를 넣는다
--      supabase secrets set SLACK_WEBHOOK_URL=https://hooks.slack.com/...
--      supabase secrets set SLACK_WEBHOOK_MONEY=https://hooks.slack.com/...
--      supabase secrets set APP_BASE_URL=https://erp-mightyblessing.vercel.app/
--      supabase secrets set CRON_SECRET=아무도-모를-긴-문자열
-- 3. 아래 <프로젝트>와 <CRON_SECRET>을 바꾼다

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 한국 시간 아침 9시 = UTC 0시
select cron.unschedule('erp-digest') where exists (
  select 1 from cron.job where jobname = 'erp-digest');

select cron.schedule(
  'erp-digest',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://ykyuhuhhxnlhbfjiuihv.supabase.co/functions/v1/erp-slack',
    headers := '{"content-type":"application/json"}'::jsonb,
    body    := '{"action":"digest","key":"<CRON_SECRET>"}'::jsonb
  );
  $$
);

-- ───────────────────────────────────────────────────────────
-- 확인
-- ───────────────────────────────────────────────────────────
select jobid, jobname, schedule, active from cron.job where jobname = 'erp-digest';

-- 지난 실행 기록 (돌린 다음 날 확인)
-- select * from cron.job_run_details order by start_time desc limit 5;

-- 당장 한 번 돌려보고 싶으면 (슬랙에 바로 뜬다)
-- select net.http_post(
--   url     := 'https://ykyuhuhhxnlhbfjiuihv.supabase.co/functions/v1/erp-slack',
--   headers := '{"content-type":"application/json"}'::jsonb,
--   body    := '{"action":"digest","key":"<CRON_SECRET>"}'::jsonb);
