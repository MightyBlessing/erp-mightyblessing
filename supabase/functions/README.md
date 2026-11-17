# Edge Function 올리기

## 한 번만 하면 되는 것

```bash
npm i -g supabase            # 또는 brew install supabase/tap/supabase
supabase login               # 브라우저가 열린다
cd ~/dev/erp-mightyblessing
supabase link --project-ref ykyuhuhhxnlhbfjiuihv
```

## 함수 올리기

```bash
supabase functions deploy erp-slack
```

## 환경변수 넣기

슬랙 웹후크 주소를 **여기에만** 둔다. 브라우저에는 안 실린다.

```bash
supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
supabase secrets set SLACK_WEBHOOK_MONEY="https://hooks.slack.com/services/..."
supabase secrets set APP_BASE_URL="https://erp-mightyblessing.vercel.app/"
supabase secrets set CRON_SECRET="$(openssl rand -hex 24)"
```

마지막 줄이 찍어주는 값을 `cron-digest.sql` 의 `<CRON_SECRET>` 자리에 넣는다.
`supabase secrets list` 로 들어갔는지 볼 수 있다 (값은 안 보인다).

## 잘 올라갔는지

```bash
curl -s -X POST "https://ykyuhuhhxnlhbfjiuihv.supabase.co/functions/v1/erp-slack" \
  -H "content-type: application/json" \
  -d '{"action":"digest","key":"방금-만든-CRON_SECRET"}'
```

`{"ok":true}` 또는 `{"ok":true,"skipped":"알릴 것이 없습니다"}` 가 나오면 된 것이다.
`{"ok":false,...}` 면 그 문구가 원인을 말해준다.

## 그다음

`supabase/cron-digest.sql` 을 SQL Editor 에서 Run 한다. 매일 아침 9시에 깨운다.
