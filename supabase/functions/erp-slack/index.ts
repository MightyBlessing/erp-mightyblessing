// 마이티블레싱 ERP — 슬랙 알림 중계 + 예약 알림
//
// 왜 서버를 두는가
//   지금은 브라우저가 슬랙 웹후크로 직접 쏜다. 그래서 세 가지가 안 된다.
//     1. 아무도 ERP를 안 켜면 아무것도 안 나간다 — 「내일이 지급 예정일입니다」를
//        보낼 방법이 없다
//     2. 웹후크 주소가 로그인한 모든 사람에게 보인다. 그 주소를 아는 사람은
//        그 채널에 아무 글이나 쓸 수 있다
//     3. no-cors 라 보냈는지 확인이 안 된다. 주소를 틀려도 모른다
//   이 함수가 셋 다 푼다. 주소는 여기 환경변수에만 있고, 결과를 돌려주고,
//   크론이 매일 깨운다.
//
// 환경변수 (supabase secrets set)
//   SLACK_WEBHOOK_URL        결재 알림 채널
//   SLACK_WEBHOOK_MONEY      돈 알림 채널 (없으면 위와 같은 곳)
//   APP_BASE_URL             알림 링크에 쓸 ERP 주소
//   CRON_SECRET              예약 알림을 부를 때 쓰는 암호
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (대시보드가 자동으로 넣어준다)

const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", ...CORS },
  });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};

const env = (k: string) => Deno.env.get(k) ?? "";
const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR") + "원";

/* 한국 시간 기준 오늘. UTC 로 끊으면 새벽에 하루가 밀린다. */
function todayKST(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function postSlack(text: string, money = false) {
  const url = money
    ? env("SLACK_WEBHOOK_MONEY") || env("SLACK_WEBHOOK_URL")
    : env("SLACK_WEBHOOK_URL");
  if (!url) return { ok: false, error: "웹후크 주소가 설정되어 있지 않습니다" };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await r.text();
  /* 슬랙은 성공하면 ok 한 줄만 준다. 실패는 invalid_token 같은 글자가 온다. */
  return r.ok && body.trim() === "ok"
    ? { ok: true }
    : { ok: false, error: `슬랙이 거부했습니다 (${r.status} ${body.slice(0, 120)})` };
}

/* 서비스 키로 읽는다. 읽기만 한다 — 이 함수는 아무것도 고치지 않는다. */
async function docs(collection: string) {
  const r = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/docs?collection=eq.${collection}&select=id,data`,
    {
      headers: {
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
    },
  );
  if (!r.ok) throw new Error(`${collection} 읽기 실패 ${r.status}`);
  return (await r.json()) as { id: string; data: Record<string, unknown> }[];
}

const base = () => (env("APP_BASE_URL") || "").replace(/\/+$/, "") + "/";
const foot = () => {
  const b = base();
  const h = b.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `:large_purple_circle: *마이티블레싱 ERP* · <${b}|${h}>`;
};

/* ───────── 예약 알림 ─────────
   매일 아침 한 번. 오늘 줄 돈, 늦은 돈, 묵은 결재를 한 장으로 묶는다.
   보낼 게 없으면 안 보낸다. 빈 알림이 매일 오면 다음부터 안 읽는다. */
async function digest() {
  const t = todayKST();
  const soon = addDays(t, 1);
  const all = await docs("docs");

  type D = Record<string, any>;
  const exp = all.filter((x) => (x.data as D)?.type === "expense");

  const total = (d: D) =>
    (d.items || []).reduce(
      (a: number, it: D) => a + (+it.qty || 0) * (+it.price || 0),
      0,
    );
  const approved = (d: D) => {
    const st = d.status;
    if (st === "rejected" || st === "canceled" || st === "draft") return false;
    const steps = d.steps || [];
    return steps.length > 0 &&
      steps.every((s: D) => s.state === "approved");
  };
  const paid = (d: D) => (d.pay || {}).state === "paid";
  const sched = (d: D) => String((d.pay || {}).schedOn || "").slice(0, 10);

  const live = exp.map((x) => ({ id: x.id, d: x.data as D }))
    .filter((x) => approved(x.d) && !paid(x.d));

  const dueToday = live.filter((x) => sched(x.d) === t);
  const dueSoon = live.filter((x) => sched(x.d) === soon);
  const late = live.filter((x) => sched(x.d) && sched(x.d) < t);
  const noPlan = live.filter((x) => !sched(x.d));

  /* 결재가 멈춰 있는 것 — 올린 지 사흘이 지났는데 아직 도는 중 */
  const stuck = all.map((x) => ({ id: x.id, d: x.data as D }))
    .filter((x) => {
      const st = x.d.status;
      if (st !== "submitted" && st !== "progress") return false;
      const at = String(x.d.updatedAt || "").slice(0, 10);
      return at && at < addDays(t, -3);
    });

  if (!dueToday.length && !dueSoon.length && !late.length && !stuck.length) {
    return { ok: true, skipped: "알릴 것이 없습니다" };
  }

  const line = (x: { id: string; d: D }) =>
    `• <${base()}#docs/${x.id}|${x.d.title || "지출결의서"}> ${won(total(x.d))}` +
    (x.d.payee ? ` · ${x.d.payee}` : "");

  const L: string[] = [`:alarm_clock: 오늘 챙길 것`, t];
  if (late.length) {
    L.push(`*예정일이 지났습니다 — ${late.length}건*`);
    late.forEach((x) => L.push(line(x) + ` · 예정 ${sched(x.d)}`));
  }
  if (dueToday.length) {
    L.push(`*오늘 지급 예정 — ${dueToday.length}건*`);
    dueToday.forEach((x) => L.push(line(x)));
  }
  if (dueSoon.length) {
    L.push(`*내일 지급 예정 — ${dueSoon.length}건*`);
    dueSoon.forEach((x) => L.push(line(x)));
  }
  if (noPlan.length) {
    L.push(
      `*예정일을 안 잡은 승인 건 — ${noPlan.length}건 · ${
        won(noPlan.reduce((a, x) => a + total(x.d), 0))
      }*`,
    );
  }
  if (stuck.length) {
    L.push(`*사흘 넘게 결재가 멈춰 있습니다 — ${stuck.length}건*`);
    stuck.slice(0, 5).forEach((x) =>
      L.push(`• <${base()}#docs/${x.id}|${x.d.title || "문서"}>`)
    );
  }
  L.push(`:arrow_upper_right: <${base()}#acct|지출 현황 보기>`);
  L.push(foot());

  return await postSlack(L.join("\n"), true);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    const action = body.action || url.searchParams.get("action") || "notify";

    if (action === "digest") {
      /* 크론만 부를 수 있다. 아무나 부르면 하루에 백 번 울린다. */
      const key = body.key || url.searchParams.get("key") || "";
      if (!env("CRON_SECRET") || key !== env("CRON_SECRET")) {
        return J({ ok: false, error: "허가되지 않은 요청입니다" }, 401);
      }
      return J(await digest());
    }

    if (action === "notify") {
      /* 로그인한 사람만. 토큰은 ERP 가 그대로 넘겨준다. */
      const auth = req.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) {
        return J({ ok: false, error: "로그인이 필요합니다" }, 401);
      }
      const who = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
        headers: { authorization: auth, apikey: env("SUPABASE_SERVICE_ROLE_KEY") },
      });
      if (!who.ok) return J({ ok: false, error: "로그인이 만료되었습니다" }, 401);

      const text = String(body.text || "").slice(0, 3500);
      if (!text) return J({ ok: false, error: "보낼 내용이 없습니다" }, 400);
      return J(await postSlack(text, !!body.money));
    }

    return J({ ok: false, error: `모르는 요청입니다: ${action}` }, 400);
  } catch (e) {
    return J({ ok: false, error: String(e?.message || e) }, 500);
  }
});
