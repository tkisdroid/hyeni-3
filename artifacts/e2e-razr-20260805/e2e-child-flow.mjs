// razr 아이모드 사용자 흐름 E2E — CDP로 세션·라우트·콘솔 에러를 검증한다.
// 사용법: node e2e-child-flow.mjs <round> [port]
const ROUND = process.argv[2] ?? "1";
const PORT = Number(process.argv[3] ?? 9223);
const fs = await import("node:fs");
const outDir = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const ROUTES = [
  { hash: "#/child/home", sel: ".kd-root", name: "아이 홈" },
  { hash: "#/child/sticker", sel: ".sb-body", name: "스티커북" },
  { hash: "#/child/memo", sel: ".mc-header", name: "대화" },
  { hash: "#/supplies", sel: ".sup-screen", name: "준비물" },
  { hash: "#/child/ai-friend", sel: ".afc-header", name: "AI 친구" },
  { hash: "#/child/location-status", sel: ".cls-header", name: "내 위치" },
  { hash: "#/child/settings", sel: ".ks-root", name: "내 정보" },
  { hash: "#/feedback", sel: ".fb-screen", name: "피드백" },
  { hash: "#/child/sos", sel: ".cs-root", name: "SOS 화면(진입만)" },
  { hash: "#/route", sel: ".rv-screen", name: "길찾기" },
];

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("localhost"));
if (!page) throw new Error("page 대상 없음");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const events = [];
const consoleErrors = [];
const exceptions = [];
const netFailures = [];
const netHttpErrors = [];
const requestUrls = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000);
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}`));
    else resolve(msg.result);
    return;
  }
  if (!msg.method) return;
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    const text = (msg.params.args ?? []).map((a) => a.description ?? a.value ?? a.unserializableValue ?? "").join(" ");
    consoleErrors.push(text.slice(0, 500));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    exceptions.push((d.exception?.description ?? d.text ?? "").slice(0, 500));
  }
  if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
    events.push({ level: msg.params.entry.level, text: (msg.params.entry.text ?? "").slice(0, 300), url: msg.params.entry.url ?? "" });
  }
  if (msg.method === "Network.requestWillBeSent") {
    requestUrls.set(msg.params.requestId, msg.params.request.url);
  }
  if (msg.method === "Network.loadingFailed") {
    netFailures.push({ url: requestUrls.get(msg.params.requestId) ?? msg.params.requestId, error: msg.params.errorText });
  }
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
    netHttpErrors.push({ url: msg.params.response.url, status: msg.params.response.status });
  }
};

await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Log.clear");
consoleErrors.length = 0;
exceptions.length = 0;
events.length = 0;
netFailures.length = 0;
netHttpErrors.length = 0;

const evalJs = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (res.exceptionDetails) throw new Error(`evaluate 예외: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  return res.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 세션 스냅샷(토큰 제외, 역할·식별자만) — 영속 형태는 {access, refresh, user}
const session = await evalJs(`(() => {
  try {
    const raw = localStorage.getItem("hyeni-api-session-v1");
    if (!raw) return { present: false };
    const s = JSON.parse(raw);
    return { present: true, role: s.user?.role ?? null, familyId: s.user?.family_id ?? null, userId: s.user?.id ?? null, hasAccess: Boolean(s.access), hasRefresh: Boolean(s.refresh) };
  } catch { return { present: false }; }
})()`);

// 2) 새로고침 후 아이 홈 로드 대기
await evalJs("location.reload()");
await sleep(1500);
let homeVisible = false;
for (let i = 0; i < 25; i++) {
  homeVisible = await evalJs(`Boolean(document.querySelector(".kd-root") && document.querySelector(".kd-root").offsetParent !== null)`).catch(() => false);
  if (homeVisible) break;
  await sleep(600);
}
await sleep(2500); // 데이터 정착 여유

// 3) /api/family/mine 교차 확인(토큰은 페이지 안에서만 사용, id만 반환).
// awaitPromise 없이 시작만 동기 실행하고 window 변수로 결과를 폴링한다.
await evalJs(`(() => {
  window.__e2eFamilyCheck = null;
  (async () => {
    try {
      const raw = localStorage.getItem("hyeni-api-session-v1");
      if (!raw) { window.__e2eFamilyCheck = { ok: false, reason: "no-session" }; return; }
      const s = JSON.parse(raw);
      const base = "https://hyeni-calendar-api.tkisdroid.workers.dev";
      const res = await fetch(base + "/api/family/mine", { headers: { Authorization: "Bearer " + s.access } });
      if (!res.ok) { window.__e2eFamilyCheck = { ok: false, status: res.status }; return; }
      const data = await res.json();
      const mineFamilyId = data?.familyId ?? null;
      window.__e2eFamilyCheck = { ok: true, mineFamilyId, localFamilyId: s.user?.family_id ?? null, match: mineFamilyId != null && mineFamilyId === s.user?.family_id };
    } catch (e) { window.__e2eFamilyCheck = { ok: false, reason: String(e).slice(0, 120) }; }
  })();
  return "started";
})()`);
let familyCheck = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  familyCheck = await evalJs("window.__e2eFamilyCheck").catch(() => null);
  if (familyCheck) break;
}
if (!familyCheck) familyCheck = { ok: false, reason: "timeout" };

// 3-b) 아이 홈 실제 데이터 로드 지표(모험 노드·티커·인사 등 렌더된 텍스트)
const homeData = await evalJs(`(() => {
  const root = document.querySelector(".kd-root");
  if (!root) return { present: false };
  const text = (root.textContent ?? "").replace(/\\s+/g, " ").trim();
  return { present: true, nodes: document.querySelectorAll(".kd-node").length, textLen: text.length, textHead: text.slice(0, 160) };
})()`).catch((e) => ({ present: false, reason: String(e).slice(0, 120) }));

// 4) 라우트 순회
const routeResults = [];
for (const route of ROUTES) {
  const before = consoleErrors.length + exceptions.length;
  await evalJs(`location.hash = ${JSON.stringify(route.hash)}`);
  let visible = false;
  for (let i = 0; i < 16; i++) {
    visible = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(route.sel)}); return Boolean(el && el.offsetParent !== null); })()`).catch(() => false);
    if (visible) break;
    await sleep(500);
  }
  await sleep(1200);
  const newErrors = (consoleErrors.length + exceptions.length) - before;
  const textLen = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(route.sel)}); return el ? ((el.closest(".hy-screen") ?? el.parentElement ?? el).textContent ?? "").trim().length : 0; })()`).catch(() => 0);
  routeResults.push({
    route: route.hash,
    name: route.name,
    visible,
    newConsoleErrors: newErrors,
    textLen,
  });
}

// 5) 마무리 — 아이 홈 복귀
await evalJs(`location.hash = "#/child/home"`);
await sleep(1500);

const summary = {
  round: ROUND,
  at: new Date().toISOString(),
  target: { url: page.url, title: page.title },
  session,
  homeAfterReload: homeVisible,
  homeData,
  familyCheck,
  routes: routeResults,
  consoleErrors,
  exceptions,
  logEntries: events.filter((e) => e.level === "error"),
  netFailures,
  netHttpErrors,
  verdict: undefined,
};
const failReasons = [];
if (!session.present || session.role !== "child") failReasons.push("세션 없음/역할 불일치");
if (!homeVisible) failReasons.push("아이 홈 미렌더");
if (!familyCheck.ok || !familyCheck.match) failReasons.push("family/mine 불일치");
for (const r of routeResults) if (!r.visible) failReasons.push(`${r.name} 미렌더`);
summary.verdict = failReasons.length === 0 ? "PASS" : `FAIL: ${failReasons.join("; ")}`;

fs.writeFileSync(`${outDir}round${ROUND}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
ws.close();
process.exit(failReasons.length === 0 ? 0 : 1);
