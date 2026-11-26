-- 결재 독촉 — 한 시간에 한 번, 차례인 사람에게만.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
--
-- ───────────────────────────────────────────────────────────
-- 왜 필요한가
-- ───────────────────────────────────────────────────────────
-- 상신하는 순간 쪽지가 한 통 간다. 그걸 못 보면 그걸로 끝이었다.
-- 멈춘 결재가 일주일을 가는 이유가 그것이다. 채널에 뿌리는 것으로는
-- 안 된다 — 남의 일이 섞여 흐르면 자기 차례도 같이 흘려보낸다.
--
-- 차례인 사람에게만 쪽지로 간다. 할 일이 없는 사람에게는 아무것도
-- 안 간다. 매시간 빈 알림이 울리면 다음부터 안 보게 된다.
--
-- ───────────────────────────────────────────────────────────
-- 언제 도는가
-- ───────────────────────────────────────────────────────────
-- 한국 시간 평일 9시~19시, 매시 정각. UTC 로는 0시~10시.
-- 밤과 주말은 함수가 한 번 더 걸러낸다 — 크론 시간대가 어긋나도
-- 새벽 3시에 울리는 일은 없다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('erp-nag') where exists (
  select 1 from cron.job where jobname = 'erp-nag');

select cron.schedule(
  'erp-nag',
  '0 0-10 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://ykyuhuhhxnlhbfjiuihv.supabase.co/functions/v1/erp-slack',
    headers := '{"content-type":"application/json"}'::jsonb,
    body    := '{"action":"nag","key":"<CRON_SECRET>"}'::jsonb
  );
  $$
);

-- ───────────────────────────────────────────────────────────
-- 확인
-- ───────────────────────────────────────────────────────────
select jobid, jobname, schedule, active from cron.job where jobname = 'erp-nag';

-- 당장 한 번 돌려보고 싶으면 (차례인 사람에게 바로 쪽지가 간다)
-- select net.http_post(
--   url     := 'https://ykyuhuhhxnlhbfjiuihv.supabase.co/functions/v1/erp-slack',
--   headers := '{"content-type":"application/json"}'::jsonb,
--   body    := '{"action":"nag","key":"<CRON_SECRET>"}'::jsonb);

-- 끄고 싶으면
-- select cron.unschedule('erp-nag');
