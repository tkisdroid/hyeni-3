const cdpPort = Number.parseInt(process.env.CDP_PORT ?? "9222", 10);
if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) {
  throw new Error("CDP_PORT가 올바르지 않습니다.");
}

const routeWaitMs = Number.parseInt(process.env.ROUTE_WAIT_MS ?? "2500", 10);
const baseUrl = `http://127.0.0.1:${cdpPort}`;
const targetsResponse = await fetch(`${baseUrl}/json/list`);
if (!targetsResponse.ok) {
  throw new Error(`CDP 대상 조회 실패: HTTP ${targetsResponse.status}`);
}

const targets = await targetsResponse.json();
const target = targets.find((item) => (
  item?.type === "page"
  && typeof item.webSocketDebuggerUrl === "string"
  && (String(item.url).startsWith("https://localhost/") || String(item.url).startsWith("http://localhost/"))
));
if (!target) {
  throw new Error("혜니캘린더 WebView CDP 대상을 찾지 못했습니다.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP WebSocket 연결 실패")), { once: true });
});

let nextId = 1;
const pending = new Map();
const runtimeErrors = [];
const consoleErrors = [];

function safeMessage(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [숨김]")
    .replace(/([?&](?:token|access_token|refresh_token|code)=)[^&#\s]+/gi, "$1[숨김]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[긴 값 숨김]")
    .slice(0, 240);
}

socket.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    return;
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(safeMessage(message.error.message)));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(safeMessage(message.params?.exceptionDetails?.text ?? "Runtime exception"));
  }
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params?.entry?.level)) {
    consoleErrors.push(safeMessage(message.params.entry.text));
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
    const text = (message.params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(" ");
    consoleErrors.push(safeMessage(text));
  }
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    throw new Error(safeMessage(result.exceptionDetails.text ?? "평가 실패"));
  }
  return result.result?.value;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Runtime.enable");
await send("Log.enable");

const sessionCheck = await evaluate(`(async () => {
  const raw = localStorage.getItem("hyeni-api-session-v1");
  let session = null;
  try { session = raw ? JSON.parse(raw) : null; } catch { session = null; }
  const accessToken = session?.access;
  const localFamilyId = session?.user?.app_metadata?.family_id
    ?? session?.user?.user_metadata?.family_id
    ?? null;
  const localRole = session?.user?.app_metadata?.role
    ?? session?.user?.user_metadata?.role
    ?? null;
  if (!accessToken) {
    return { hasSession: false, localRole, familyMineStatus: null, familyMatches: false };
  }
  try {
    const response = await fetch("https://hyeni-calendar-api.tkisdroid.workers.dev/api/family/mine", {
      headers: { Authorization: "Bearer " + accessToken },
      cache: "no-store",
    });
    const body = response.ok ? await response.json() : null;
    const serverFamilyId = body?.familyId ?? body?.family?.id ?? body?.family_id ?? null;
    return {
      hasSession: true,
      localRole,
      familyMineStatus: response.status,
      familyMatches: Boolean(localFamilyId && serverFamilyId && localFamilyId === serverFamilyId),
    };
  } catch {
    return { hasSession: true, localRole, familyMineStatus: 0, familyMatches: false };
  }
})()`);

const routes = [
  { name: "부모 홈", hash: "#/parent/home", selector: ".ph-hero" },
  { name: "일정", hash: "#/parent/calendar", selector: ".pc-body" },
  { name: "위치", hash: "#/parent/location", selector: ".pl-root", requiresMap: true },
  { name: "오늘 경로", hash: "#/parent/location?view=history", selector: ".pl-root", requiresMap: true },
  { name: "메시지", hash: "#/parent/memo", selector: ".mc-root" },
  { name: "알림함", hash: "#/notifications", selector: ".nc-root" },
  { name: "알림 설정", hash: "#/notification-settings", selector: ".nst-screen" },
  { name: "설정", hash: "#/parent/settings", selector: ".ps-content" },
];

const routeResults = [];
for (const route of routes) {
  const errorOffset = runtimeErrors.length + consoleErrors.length;
  await evaluate(`location.hash = ${JSON.stringify(route.hash)}; true`);
  await delay(routeWaitMs);
  const view = await evaluate(`(() => {
    const text = document.body?.innerText ?? "";
    const required = document.querySelector(${JSON.stringify(route.selector)});
    const mapCanvas = document.querySelector(".km-canvas");
    const visible = [...document.querySelectorAll("main, section, article, [role='main']")]
      .some((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const phrases = [
      "지도를 불러오지 못했어요",
      "문제가 발생했어요",
      "오류가 발생했어요",
      "페이지를 표시할 수 없어요",
      "다시 로그인해 주세요",
      "일정을 불러오지 못했어요",
      "위치 갱신에 실패했어요",
      "대화를 불러오지 못했어요",
      "알림을 불러오지 못했어요",
      "설정을 불러오지 못했어요"
    ].filter((phrase) => text.includes(phrase));
    return {
      hash: location.hash,
      visible,
      requiredSelectorVisible: Boolean(required && required.getClientRects().length > 0),
      mapReady: ${route.requiresMap === true}
        ? Boolean(mapCanvas && mapCanvas.childElementCount > 0 && !document.querySelector(".km-error"))
        : null,
      textLength: text.trim().length,
      errorPhrases: phrases,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      viewport: { width: innerWidth, height: innerHeight },
      busyCount: document.querySelectorAll("[aria-busy='true']").length,
      buttonCount: document.querySelectorAll("button").length,
    };
  })()`);
  routeResults.push({
    name: route.name,
    expectedHash: route.hash,
    ...view,
    newConsoleOrRuntimeErrors: runtimeErrors.length + consoleErrors.length - errorOffset,
  });
}

const result = {
  checkedAt: new Date().toISOString(),
  targetUrl: String(target.url).replace(/[?#].*$/, ""),
  session: sessionCheck,
  routes: routeResults,
  runtimeErrors: [...new Set(runtimeErrors)],
  consoleErrors: [...new Set(consoleErrors)],
};

console.log(JSON.stringify(result, null, 2));
socket.close();

const failed = (
  !sessionCheck?.hasSession
  || sessionCheck?.localRole !== "parent"
  || sessionCheck?.familyMineStatus !== 200
  || !sessionCheck?.familyMatches
  || routeResults.some((route) => (
    route.hash !== route.expectedHash
    || !route.visible
    || !route.requiredSelectorVisible
    || (route.mapReady === false)
    || route.textLength === 0
    || route.errorPhrases.length > 0
    || route.horizontalOverflowPx > 1
    || route.newConsoleOrRuntimeErrors > 0
  ))
  || runtimeErrors.length > 0
  || consoleErrors.length > 0
);

if (failed) process.exitCode = 1;
