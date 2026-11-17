# Edge Function 올리기 — 처음부터 끝까지

ERP 는 브라우저에서 도는 화면 한 장이다. 아무도 안 켜면 아무 일도 안 일어난다.
「내일이 지급 예정일입니다」를 보낼 주체가 없다.

Edge Function 은 **아무도 안 켜도 도는 작은 서버**다. 두 가지를 한다.

| 하는 일 | 누가 부르나 | 왜 ERP 가 직접 안 하나 |
|---|---|---|
| `digest` — 아침에 챙길 것 묶어서 보내기 | 매일 9시 pg_cron | 브라우저가 꺼져 있다 |
| `notify` — 결재 알림 보내기 | ERP 화면 | 웹후크 주소를 브라우저에 안 싣기 위해 |

`notify` 가 중요한 이유: 지금은 웹후크 주소가 `config/slack` 문서에 있고,
**로그인한 사람이면 누구나 읽을 수 있다**. 그 주소만 있으면 누구든 우리
슬랙에 아무 말이나 쏠 수 있다. 함수로 옮기면 주소는 서버에만 남는다.

---

## 0. 준비물

- 터미널
- Supabase 계정 (ERP 만들 때 쓰신 그 계정)
- `#service-alert-erp` 채널로 가는 **새 슬랙 웹후크 주소**

웹후크는 api.slack.com/apps → 마이티블레싱 ERP → Incoming Webhooks →
**Add New Webhook to Workspace** → 채널 `#service-alert-erp` 선택.
`https://hooks.slack.com/services/...` 로 시작하는 줄이 나온다. 복사해 두신다.

> 기존 웹후크는 캡처에 노출됐습니다. 같은 화면에서 **Remove** 하세요.

---

## 1. CLI 깔고 로그인 — 한 번만

```bash
brew install supabase/tap/supabase
```

brew 가 없으면:

```bash
npm i -g supabase
```

깔렸는지:

```bash
supabase --version
```

로그인. 브라우저가 열리고, 「Authorize」 누르면 터미널로 돌아온다.

```bash
supabase login
```

---

## 2. 프로젝트에 붙이기

```bash
cd ~/dev/erp-mightyblessing && supabase link --project-ref ykyuhuhhxnlhbfjiuihv
```

데이터베이스 비밀번호를 물어본다. **그냥 Enter** 치셔도 된다.
함수 올리는 데는 필요 없다.

---

## 3. 함수 올리기

```bash
cd ~/dev/erp-mightyblessing && supabase functions deploy erp-slack
```

`Deployed Functions on project ykyuhuhhxnlhbfjiuihv: erp-slack` 이 나오면 됐다.

> `supabase/config.toml` 에 `verify_jwt = false` 를 넣어 뒀다.
> 안 그러면 Supabase 문지기가 **토큰 없는 요청을 함수에 닿기도 전에** 막는다.
> 크론은 토큰이 없으니 매일 아침 아무 일도 안 일어난다.
> 문을 연 게 아니라 문지기를 함수 안으로 옮긴 것이다 —
> `digest` 는 CRON_SECRET 을, `notify` 는 로그인 토큰을 직접 확인한다.

---

## 4. 환경변수

**웹후크 주소는 여기에만 둔다.** 브라우저에는 안 실린다.

```bash
cd ~/dev/erp-mightyblessing && supabase secrets set SLACK_WEBHOOK_URL="여기에_새_웹후크_주소"
```

알림 링크가 가리킬 주소:

```bash
cd ~/dev/erp-mightyblessing && supabase secrets set APP_BASE_URL="https://erp-mightyblessing.vercel.app/"
```

크론만 아는 암호. **이 줄은 출력된 값을 적어두셔야 한다. 다시 못 본다.**

```bash
openssl rand -hex 24
```

나온 값을 아래 `붙여넣기` 자리에 넣는다:

```bash
cd ~/dev/erp-mightyblessing && supabase secrets set CRON_SECRET="붙여넣기"
```

돈 얘기만 다른 채널로 보내고 싶으시면 (선택):

```bash
cd ~/dev/erp-mightyblessing && supabase secrets set SLACK_WEBHOOK_MONEY="두번째_웹후크_주소"
```

안 넣으면 전부 `SLACK_WEBHOOK_URL` 한 곳으로 간다.

들어갔는지 확인 (이름만 보이고 값은 안 보인다):

```bash
supabase secrets list
```

> `SUPABASE_URL` 과 `SUPABASE_SERVICE_ROLE_KEY` 는 **넣지 않는다.**
> Supabase 가 알아서 함수에 꽂아준다. 넣으려 하면 거부당한다.

---

## 5. 되는지 확인

`CRON_SECRET` 자리에 4번에서 만든 값을 넣고:

```bash
curl -s -X POST "https://ykyuhuhhxnlhbfjiuihv.supabase.co/functions/v1/erp-slack" -H "content-type: application/json" -d '{"action":"digest","key":"붙여넣기"}'
```

| 나온 것 | 뜻 | 할 일 |
|---|---|---|
| `{"ok":true}` | 슬랙에 떴다 | 끝 |
| `{"ok":true,"skipped":"알릴 것이 없습니다"}` | 잘 돌았다. 오늘 챙길 게 없을 뿐 | 끝 |
| `{"ok":false,"error":"허가되지 않은 요청입니다"}` | CRON_SECRET 이 다르다 | 4번 다시 |
| `{"ok":false,"error":"웹후크 주소가 설정되어 있지 않습니다"}` | 웹후크를 안 넣었다 | 4번 다시 |
| `{"code":401,"message":"Missing authorization header"}` | `verify_jwt` 가 아직 켜져 있다 | 3번 다시 (config.toml 이 올라갔는지) |

무슨 일이 있었는지 더 보고 싶으시면:

```bash
supabase functions logs erp-slack
```

---

## 6. 매일 아침 깨우기

Supabase 대시보드 → **SQL Editor** → `supabase/cron-digest.sql` 내용을 붙여넣는다.
파일 안의 `<CRON_SECRET>` 두 군데를 4번에서 만든 값으로 바꾸고 **Run**.

`0 0 * * *` 는 UTC 0시, 곧 **한국 아침 9시**다.

돌아가는지:

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'erp-digest';
```

다음 날 아침에 실제로 돌았는지:

```sql
select * from cron.job_run_details order by start_time desc limit 5;
```

---

## 7. ERP 가 이 함수를 쓰게 하기

지금 ERP 는 브라우저에서 슬랙으로 **직접** 쏜다. 함수가 올라간 뒤에
ERP 쪽을 바꿔서 함수를 거치게 한다 — 그래야 웹후크 주소가 브라우저에서 사라진다.

**6번까지 끝내고 알려주시면 그때 ERP 를 고치겠습니다.** 순서가 중요하다.
먼저 ERP 를 바꾸면 함수가 없는 동안 알림이 아예 안 간다.

---

## 막히면

| 증상 | 원인 |
|---|---|
| `supabase: command not found` | 1번이 안 됐다. `npm i -g supabase` 를 sudo 없이 썼다면 권한 문제일 수 있다 |
| `Cannot find project ref` | 2번의 `link` 를 안 했거나 다른 폴더에서 돌렸다. `cd ~/dev/erp-mightyblessing` 먼저 |
| `Access token not provided` | `supabase login` 다시 |
| 슬랙에 아무것도 안 뜸, 그런데 `ok:true` | 웹후크가 다른 채널을 보고 있다. 슬랙 앱 설정에서 채널 확인 |
