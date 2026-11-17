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
//   SLACK_SIGNING_SECRET     /지출 이 슬랙에서 온 게 맞는지 보는 열쇠
//   SLACK_BOT_TOKEN          채널 목록을 읽을 때만 쓴다 (xoxb-…)
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

/* ───────── 슬랙에서 문서 초안 ─────────
   「/지출 교촌치킨 52000 스태프 야식」 한 줄로 지출결의서 초안이 생긴다.
   영수증을 손에 든 그 자리에서 치라는 것이다. 자리에 돌아와 ERP 를 켤
   즈음엔 이미 금액을 잊는다.

   기안자는 비워 둔다. 슬랙 사용자가 ERP 의 누구인지 알려면 봇 토큰과
   이메일 조회 권한이 더 필요한데, 그 권한을 더 받느니 ERP 에서 「내 것으로」
   한 번 누르는 편이 낫다. 누가 쳤는지는 적어 둔다. */

/* 슬랙이 보낸 게 맞는지 본다. 이 함수는 문지기를 꺼 둬서 주소만 알면
   누구나 두드릴 수 있다. 서명이 유일한 자물쇠다. */
async function slackSigned(raw: string, ts: string, sig: string) {
  const secret = env("SLACK_SIGNING_SECRET");
  if (!secret || !ts || !sig) return false;
  /* 다섯 달 전에 가로챈 요청을 오늘 다시 보내는 걸 막는다. */
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${ts}:${raw}`),
  );
  const mine = "v0=" +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (mine.length !== sig.length) return false;
  /* 글자를 하나씩 비교하되 틀려도 끝까지 간다. 빨리 포기하면 그 시간차로
     정답을 한 글자씩 알아낼 수 있다. */
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const ephemeral = (text: string) =>
  J({ response_type: "ephemeral", text });

function docNoPrefix(y: number) {
  if (y <= 2026) return "마블 제2024/2026";
  const b = 2027 + Math.floor((y - 2027) / 2) * 2;
  return `마블 제${b}/${b + 1}`;
}
/* ERP 의 nextNo 와 같은 규칙이어야 한다. 번호가 겹치면 종이로 나간
   문서와 대조가 안 된다. */
function nextExpenseNo(rows: { data: Record<string, any> }[]) {
  const y = new Date().getFullYear();
  const pre = "마블 지출 " + docNoPrefix(y).replace("마블 제", "");
  const re = new RegExp(
    "^" + pre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)호$",
  );
  let mx = 0;
  for (const r of rows) {
    if (r.data?.type !== "expense") continue;
    const m = re.exec(String(r.data?.no || ""));
    if (m) mx = Math.max(mx, parseInt(m[1], 10));
  }
  return `${pre}-${String(mx + 1).padStart(3, "0")}호`;
}

/* 「교촌치킨 52000 스태프 야식」 → 거래처 / 금액 / 내역.
   금액은 처음 나오는 숫자 덩어리로 본다. 쉼표는 빼고 읽는다. */
function parseExpense(text: string) {
  const w = text.trim().split(/\s+/).filter(Boolean);
  let i = w.findIndex((x) => /^[0-9][0-9,]*원?$/.test(x));
  if (i < 0) return null;
  const amt = Number(w[i].replace(/[,원]/g, ""));
  if (!amt) return null;
  return {
    payee: w.slice(0, i).join(" "),
    amt,
    what: w.slice(i + 1).join(" "),
  };
}

/* 채널이 곧 사업이다. #campus-worship 에서 친 지출은 캠퍼스워십 것이다.
   매번 행사를 골라 넣으라고 하면 결국 안 고르고, 행사별 수지가 빈다.
   정산 화면의 「슬랙 채널」 칸에 적어 두면 여기서 찾는다. */
async function eventOfChannel(chId: string, chName: string) {
  const norm = (x: string) => String(x || "").trim().replace(/^#/, "").toLowerCase();
  const id = norm(chId), nm = norm(chName);
  if (!id && !nm) return null;
  let rows;
  try {
    rows = await docs("events");
  } catch {
    return null;
  }
  for (const r of rows) {
    const tag = norm(String((r.data as any)?.slackCh || ""));
    if (tag && (tag === id || tag === nm)) {
      return { id: r.id, name: String((r.data as any)?.name || "") };
    }
  }
  return null;
}

async function slashExpense(text: string, who: string, chId = "", chName = "") {
  const got = parseExpense(text);
  if (!got || !got.payee) {
    return ephemeral(
      "이렇게 쳐주세요 — `/지출 교촌치킨 52000 스태프 야식`\n" +
        "`거래처 금액 내역` 순서입니다. 내역은 없어도 됩니다.",
    );
  }
  const ev = await eventOfChannel(chId, chName);
  const rows = await docs("docs");
  const now = new Date().toISOString();
  const id = "d" + Date.now() + Math.floor(Math.random() * 1000);
  const body = {
    type: "expense",
    title: "지출결의서",
    no: nextExpenseNo(rows),
    date: todayKST(),
    eventId: ev?.id || "",
    account: "기타",
    method: "bank",
    payee: got.payee,
    payeeBank: "",
    payeeAcct: "",
    dueDate: "",
    note: `슬랙에서 ${who} 님이 올린 초안입니다. 내용을 확인하고 올려주세요.`,
    items: [{ name: got.what || got.payee, qty: 1, price: got.amt, note: "" }],
    pay: { state: "pending", at: "", by: "", memo: "" },
    /* 기안자와 결재선은 비워 둔다. ERP 에서 집는 사람이 1차 결재자가 된다. */
    steps: [],
    status: "draft",
    drafter: "",
    fromSlack: { user: who, at: now },
    createdAt: now,
    updatedAt: now,
  };
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/docs`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      collection: "docs",
      id,
      data: body,
      updated_at: now,
    }),
  });
  if (!r.ok) {
    return ephemeral(`초안을 못 만들었습니다 (${r.status}). 잠시 뒤 다시 해보세요.`);
  }
  return ephemeral(
    `:memo: *지출결의서 초안* — ${got.payee} ${won(got.amt)}` +
      (got.what ? `\n${got.what}` : "") +
      (ev
        ? `\n*행사* ${ev.name}`
        : chName
        ? `\n_이 채널에 묶인 행사가 없습니다. 행사 없이 들어왔습니다._`
        : "") +
      `\n:arrow_upper_right: <${base()}#docs/${id}|ERP에서 열어 올리기>` +
      `\n_아직 올라가지 않았습니다. 열어서 확인하고 상신해 주세요._`,
  );
}

/* 명령 이름이 무엇으로 등록됐든 받는다. 슬랙이 한글 이름을 받아주면
   /지출 로, 아니면 /erp 지출 … 로 쓸 수 있게. */
function kindOf(w: string) {
  const x = (w || "").replace(/^\//, "").trim();
  if (/^(지출|expense|exp)$/i.test(x)) return "expense";
  return "";
}

async function slash(raw: string) {
  const f = new URLSearchParams(raw);
  const who = f.get("user_name") || "누군가";
  const chId = f.get("channel_id") || "";
  const chName = f.get("channel_name") || "";
  let text = (f.get("text") || "").trim();
  let kind = kindOf(f.get("command") || "");
  if (!kind) {
    const [first, ...rest] = text.split(/\s+/);
    kind = kindOf(first);
    text = rest.join(" ");
  }
  if (kind === "expense") return await slashExpense(text, who, chId, chName);
  return ephemeral(
    "쓸 수 있는 것 — `지출`\n예) `/지출 교촌치킨 52000 스태프 야식`",
  );
}

/* 채널 목록. 행사에 채널을 손으로 받아 적게 하면 오타가 나고, 오타가
   나면 조용히 안 걸린다 — 「행사 없음」으로 들어와 버린다. 골라서 넣게 한다.
   봇 토큰은 여기 서버에만 둔다. 브라우저에 실으면 그 토큰으로 워크스페이스
   전체를 읽을 수 있다. */
async function slackChannels() {
  const tok = env("SLACK_BOT_TOKEN");
  if (!tok) {
    return { ok: false, error: "SLACK_BOT_TOKEN 이 없습니다" };
  }
  const rows: { id: string; name: string }[] = [];
  let cursor = "";
  /* 채널이 많으면 한 번에 다 안 준다. 커서를 따라간다. 다섯 바퀴면 충분하고,
     그래도 안 끝나면 거기서 멈춘다 — 끝없이 도는 것보다 낫다. */
  for (let i = 0; i < 5; i++) {
    const u = new URL("https://slack.com/api/conversations.list");
    u.searchParams.set("types", "public_channel,private_channel");
    u.searchParams.set("exclude_archived", "true");
    u.searchParams.set("limit", "200");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: { authorization: `Bearer ${tok}` } });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) {
      return { ok: false, error: `슬랙이 거부했습니다 (${j?.error || r.status})` };
    }
    for (const c of j.channels || []) {
      if (c?.name) rows.push({ id: String(c.id), name: String(c.name) });
    }
    cursor = j.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, rows };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);

    /* 슬랙 슬래시 명령은 JSON 이 아니라 폼으로 온다. 그리고 서명을 보려면
       본문을 손대기 전의 날것 그대로 읽어야 한다. */
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/x-www-form-urlencoded")) {
      const raw = await req.text();
      const ok = await slackSigned(
        raw,
        req.headers.get("x-slack-request-timestamp") || "",
        req.headers.get("x-slack-signature") || "",
      );
      if (!ok) return J({ ok: false, error: "서명이 맞지 않습니다" }, 401);
      return await slash(raw);
    }

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

    if (action === "test") {
      /* 「보낼 게 없습니다」 로는 웹후크 주소가 맞는지 알 수 없다.
         주소가 틀려도 조용히 ok 가 나온다. 그래서 한 줄을 실제로 쏴 본다. */
      const key = body.key || url.searchParams.get("key") || "";
      if (!env("CRON_SECRET") || key !== env("CRON_SECRET")) {
        return J({ ok: false, error: "허가되지 않은 요청입니다" }, 401);
      }
      return J(await postSlack(
        [
          ":satellite_antenna: *연결 시험* — 알림이 이 채널로 옵니다",
          "매일 아침 9시에 그날 챙길 것을 묶어서 보내드립니다.",
          `:arrow_upper_right: <${base()}|ERP 열기>`,
          foot(),
        ].join("\n"),
        !!body.money,
      ));
    }

    if (action === "channels") {
      /* 로그인한 사람만. notify 와 같은 자물쇠다. */
      const auth = req.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) {
        return J({ ok: false, error: "로그인이 필요합니다" }, 401);
      }
      const who = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
        headers: { authorization: auth, apikey: env("SUPABASE_SERVICE_ROLE_KEY") },
      });
      if (!who.ok) return J({ ok: false, error: "로그인이 만료되었습니다" }, 401);
      return J(await slackChannels());
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
