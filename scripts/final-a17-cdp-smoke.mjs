const cdpPort = Number.parseInt(process.env.CDP_PORT ?? "9222", 10);
if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) {
  throw new Error("CDP_PORT가 올바르지 않습니다.");
}

const routeWaitMs = Number.parseInt(process.env.ROUTE_WAIT_MS ?? "2500", 10);
if (!Number.isInteger(routeWaitMs) || routeWaitMs < 0) {
  throw new Error("ROUTE_WAIT_MS는 0ms 이상이어야 합니다.");
}
const routeSettleTimeoutMs = Number.parseInt(process.env.ROUTE_SETTLE_TIMEOUT_MS ?? "10000", 10);
if (!Number.isInteger(routeSettleTimeoutMs) || routeSettleTimeoutMs < 0) {
  throw new Error("ROUTE_SETTLE_TIMEOUT_MS는 0ms 이상이어야 합니다.");
}
const cdpCommandTimeoutMs = Number.parseInt(process.env.CDP_COMMAND_TIMEOUT_MS ?? "15000", 10);
if (!Number.isInteger(cdpCommandTimeoutMs) || cdpCommandTimeoutMs < 1000) {
  throw new Error("CDP_COMMAND_TIMEOUT_MS는 1000ms 이상이어야 합니다.");
}
const expectedRole = (process.env.EXPECTED_ROLE ?? "parent").trim();
if (expectedRole !== "parent" && expectedRole !== "child") {
  throw new Error("EXPECTED_ROLE은 parent 또는 child여야 합니다.");
}
const routeScope = (process.env.ROUTE_SCOPE ?? "all").trim();
if (routeScope !== "all" && routeScope !== "core") {
  throw new Error("ROUTE_SCOPE은 all 또는 core여야 합니다.");
}
const baseUrl = `http://127.0.0.1:${cdpPort}`;
const targetsController = new AbortController();
const targetsTimeoutId = setTimeout(() => targetsController.abort(), cdpCommandTimeoutMs);
let targetsResponse;
let targets;
try {
  targetsResponse = await fetch(`${baseUrl}/json/list`, { signal: targetsController.signal });
  if (!targetsResponse.ok) {
    throw new Error(`CDP 대상 조회 실패: HTTP ${targetsResponse.status}`);
  }
  targets = await targetsResponse.json();
} catch (error) {
  if (targetsController.signal.aborted) {
    throw new Error("CDP 대상 조회 응답 시간 초과");
  }
  throw error;
} finally {
  clearTimeout(targetsTimeoutId);
}
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
  const cleanup = () => {
    clearTimeout(timeoutId);
    socket.removeEventListener("open", handleOpen);
    socket.removeEventListener("error", handleError);
  };
  const handleOpen = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error("CDP WebSocket 연결 실패"));
  };
  const timeoutId = setTimeout(() => {
    cleanup();
    socket.close();
    reject(new Error("CDP WebSocket 연결 응답 시간 초과"));
  }, cdpCommandTimeoutMs);
  socket.addEventListener("open", handleOpen, { once: true });
  socket.addEventListener("error", handleError, { once: true });
});

let nextId = 1;
const pending = new Map();
const runtimeErrors = [];
const consoleErrors = [];
const networkRequests = new Map();
const networkErrors = [];
const networkFailures = [];

const UUID_VALUE_PATTERN = /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const KOREAN_PHONE_VALUE_PATTERN = /(?<!\d)(?:(?:\+82|82)[ .-]?)?0?1[016789][ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/g;
const UUID_PATH_SEGMENT_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const EMAIL_PATH_SEGMENT_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const KOREAN_PHONE_PATH_SEGMENT_PATTERN = /^(?:(?:\+82|82)[ .-]?)?0?1[016789][ .-]?\d{3,4}[ .-]?\d{4}$/;
const OPAQUE_PATH_SEGMENT_PATTERN = /^(?=.{16,128}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._~-]+$/;

function maskSensitiveText(value) {
  return String(value ?? "")
    .replace(UUID_VALUE_PATTERN, "[UUID 숨김]")
    .replace(EMAIL_VALUE_PATTERN, "[이메일 숨김]")
    .replace(KOREAN_PHONE_VALUE_PATTERN, "[전화번호 숨김]");
}

function safeMessage(value) {
  return maskSensitiveText(String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [숨김]")
    .replace(/([?&](?:token|access_token|refresh_token|code)=)[^&#\s]+/gi, "$1[숨김]"))
    .replace(/[A-Za-z0-9_-]{80,}/g, "[긴 값 숨김]")
    .slice(0, 240);
}

function maskSensitivePathname(pathname) {
  return String(pathname ?? "")
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // 잘못 인코딩된 경로는 원문을 진단용으로 쓰되 아래 패턴 검사를 그대로 적용한다.
      }
      if (
        UUID_PATH_SEGMENT_PATTERN.test(decoded)
        || EMAIL_PATH_SEGMENT_PATTERN.test(decoded)
        || KOREAN_PHONE_PATH_SEGMENT_PATTERN.test(decoded)
        || OPAQUE_PATH_SEGMENT_PATTERN.test(decoded)
      ) {
        return "[경로 식별자 숨김]";
      }
      return segment;
    })
    .join("/");
}

function safeNetworkPath(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "[비 HTTP 요청]";
    }
    return `${parsed.origin}${maskSensitivePathname(parsed.pathname)}`;
  } catch {
    return "[잘못된 URL]";
  }
}

socket.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    return;
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timeoutId } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timeoutId);
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
  if (message.method === "Network.requestWillBeSent") {
    networkRequests.set(message.params?.requestId, {
      method: String(message.params?.request?.method ?? "GET"),
      path: safeNetworkPath(message.params?.request?.url),
    });
  }
  if (message.method === "Network.responseReceived") {
    const status = Number(message.params?.response?.status ?? 0);
    if (status >= 400) {
      const request = networkRequests.get(message.params?.requestId);
      networkErrors.push({
        status,
        method: request?.method ?? "GET",
        path: request?.path ?? safeNetworkPath(message.params?.response?.url),
        resourceType: String(message.params?.type ?? "Other"),
      });
    }
    networkRequests.delete(message.params?.requestId);
  }
  if (message.method === "Network.loadingFailed") {
    const request = networkRequests.get(message.params?.requestId);
    const failure = {
      status: 0,
      method: request?.method ?? "GET",
      path: request?.path ?? "[요청 경로 확인 불가]",
      resourceType: String(message.params?.type ?? "Other"),
      errorText: safeMessage(message.params?.errorText ?? "Network loading failed"),
      canceled: message.params?.canceled === true,
      blockedReason: safeMessage(message.params?.blockedReason ?? ""),
    };
    networkFailures.push(failure);
    if (!failure.canceled) {
      networkErrors.push(failure);
    }
    networkRequests.delete(message.params?.requestId);
  }
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(id);
      socket.close();
      reject(new Error(`CDP ${method} 응답 시간 초과`));
    }, cdpCommandTimeoutMs);
    pending.set(id, { resolve, reject, timeoutId });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timeoutId);
      pending.delete(id);
      reject(error);
    }
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
await send("Network.enable");
await delay(250);

const initialRenderContext = await evaluate(`(() => ({
  visibilityState: document.visibilityState,
  hidden: document.hidden,
  hasFocus: document.hasFocus(),
}))()`);
if (
  initialRenderContext?.visibilityState !== "visible"
  || initialRenderContext?.hidden !== false
  || initialRenderContext?.hasFocus !== true
) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    expectedRole,
    environmentBlocked: true,
    reason: "webview_not_foreground",
    renderContext: initialRenderContext,
  }, null, 2));
  socket.close();
  process.exit(2);
}

await send("Log.clear");
runtimeErrors.length = 0;
consoleErrors.length = 0;
networkErrors.length = 0;
networkRequests.clear();
await evaluate(`setTimeout(() => location.reload(), 0); true`);
await delay(Math.max(routeWaitMs, 4000));

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
    return {
      hasSession: false,
      localRole,
      serverRole: null,
      familyMineStatus: null,
      familyMatches: false,
      roleMatches: false,
    };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://hyeni-calendar-api.tkisdroid.workers.dev/api/family/mine", {
      headers: { Authorization: "Bearer " + accessToken },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = response.ok ? await response.json() : null;
    const serverFamilyId = body?.familyId ?? body?.family?.id ?? body?.family_id ?? null;
    const serverRole = body?.myRole === "parent" || body?.myRole === "child"
      ? body.myRole
      : null;
    return {
      hasSession: true,
      localRole,
      serverRole,
      familyMineStatus: response.status,
      familyMatches: Boolean(localFamilyId && serverFamilyId && localFamilyId === serverFamilyId),
      roleMatches: Boolean(localRole && serverRole && localRole === serverRole),
    };
  } catch {
    return {
      hasSession: true,
      localRole,
      serverRole: null,
      familyMineStatus: 0,
      familyMatches: false,
      roleMatches: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
})()`);

const parentHomeShortcutLabels = [
  "AI 일정", "위치추적", "친구놀이", "장소관리",
  "주변소리", "안심리포트", "아이 기기 찾기", "알림",
];

const routesByRole = {
  parent: [
    {
      name: "부모 홈",
      hash: "#/parent/home",
      selector: ".ph-hero",
      requiredPhrases: ["아이 기기 찾기"],
      checksParentHome: true,
    },
    { name: "일정", hash: "#/parent/calendar", selector: ".pc-body" },
    { name: "위치", hash: "#/parent/location", selector: ".pl-root", requiresMap: true },
    { name: "오늘 경로", hash: "#/parent/location?view=history", selector: ".pl-root", requiresMap: true },
    { name: "메시지", hash: "#/parent/memo", selector: ".mc-root" },
    { name: "알림함", hash: "#/notifications", selector: ".nc-root" },
    { name: "알림 설정", hash: "#/notification-settings", selector: ".nst-screen" },
    {
      name: "구독 비교",
      hash: "#/subscription",
      selector: ".sub-screen",
      requiredPhrases: ["플랜 비교", "무료", "프리미엄", "SOS · 긴급 알림"],
    },
    { name: "설정", hash: "#/parent/settings", selector: ".ps-content" },
  ],
  child: [
    { name: "아이 홈", hash: "#/child/home", selector: ".kd-root" },
    { name: "스티커북", hash: "#/child/sticker", selector: ".sb-root" },
    { name: "메시지", hash: "#/child/memo", selector: ".mc-root" },
    { name: "내 위치", hash: "#/child/location-status", selector: ".cls-screen" },
    { name: "아이 설정", hash: "#/child/settings", selector: ".ks-root" },
    { name: "준비물", hash: "#/supplies", selector: ".sup-screen" },
    { name: "길찾기", hash: "#/route", selector: ".rv-screen" },
    { name: "SOS 진입", hash: "#/child/sos", selector: ".cs-root" },
  ],
};
// `core`는 미배포 수익화 API와 무관한 기존 핵심 화면을 별도 검증하기 위한 명시적 범위다.
// 기본값은 항상 `all`이며, 구독 화면의 HTTP 실패를 허용하거나 숨기지 않는다.
const routes = routesByRole[expectedRole].filter((route) => (
  routeScope !== "core" || route.hash !== "#/subscription"
));
const safeHomeHash = expectedRole === "parent" ? "#/parent/home" : "#/child/home";
const errorPhrases = expectedRole === "parent"
  ? [
      "지도를 불러오지 못했어요",
      "문제가 발생했어요",
      "오류가 발생했어요",
      "페이지를 표시할 수 없어요",
      "다시 로그인해 주세요",
      "일정을 불러오지 못했어요",
      "위치 갱신에 실패했어요",
      "대화를 불러오지 못했어요",
      "알림을 불러오지 못했어요",
      "설정을 불러오지 못했어요",
      "구독 상태를 확인하지 못했어요",
    ]
  : [
      "문제가 생겼어",
      "페이지를 표시할 수 없어요",
      "다시 로그인해 줘",
      "대화를 불러오지 못했어",
      "위치 상태를 못 불러왔어",
      "설정을 불러오지 못했어",
      "준비물을 불러오지 못했어",
      "길찾기를 불러오지 못했어",
    ];

const routeResults = [];
for (const route of routes) {
  const errorOffset = runtimeErrors.length + consoleErrors.length;
  const networkErrorOffset = networkErrors.length;
  await evaluate(`location.hash = ${JSON.stringify(route.hash)}; true`);
  await delay(routeWaitMs);
  let view;
  const settleDeadline = Date.now() + routeSettleTimeoutMs;
  do {
    view = await evaluate(`(() => {
    const text = document.body?.innerText ?? "";
    const required = document.querySelector(${JSON.stringify(route.selector)});
    const mapCanvas = document.querySelector(".km-canvas");
    const isElementVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity || "1") > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const requiredSelectorVisible = isElementVisible(required);
    const requiredRect = required?.getBoundingClientRect();
    const requiredStyle = required ? getComputedStyle(required) : null;
    const renderContext = {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    };
    const smallControls = Array.from(document.querySelectorAll(
      "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='radio'], [role='checkbox']",
    ))
      .filter(isElementVisible)
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width >= 44 && rect.height >= 44) return [];
        return [{
          element: [element.tagName.toLowerCase(), ...Array.from(element.classList).slice(0, 3)].join("."),
          parent: element.parentElement
            ? [element.parentElement.tagName.toLowerCase(), ...Array.from(element.parentElement.classList).slice(0, 3)].join(".")
            : null,
          origin: element instanceof HTMLAnchorElement
            ? (() => { try { return new URL(element.href).origin; } catch { return null; } })()
            : null,
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
        }];
      });
    const phrases = ${JSON.stringify(errorPhrases)}.filter((phrase) => text.includes(phrase));
    const missingRequiredPhrases = ${JSON.stringify(route.requiredPhrases ?? [])}
      .filter((phrase) => !text.includes(phrase));
    const parentHomeFacts = ${route.checksParentHome === true} ? (() => {
      const shortcutLabels = [...document.querySelectorAll(".ph-shortcut__label")]
        .map((label) => label.textContent?.trim() || "");
      const subscription = document.querySelector(".ph-subscription");
      const subscriptionAction = subscription?.querySelector(".ph-subscription__action");
      const subscriptionTitle = subscription?.querySelector(".ph-subscription__title")?.textContent?.trim() || "";
      const subscriptionActionText = subscriptionAction?.textContent?.trim() || "";
      const subscriptionTone = subscription?.getAttribute("data-tone") || "";
      const subscriptionRect = subscription?.getBoundingClientRect();
      const subscriptionActionRect = subscriptionAction?.getBoundingClientRect();
      const subscriptionStateConsistent = (
        (subscriptionTone === "benefits" && subscriptionTitle === "구독 시 혜택")
        || (subscriptionTone === "manage" && subscriptionTitle === "구독 관리")
        || (subscriptionTone === "neutral" && subscriptionTitle === "구독 정보")
      );
      const subscriptionActionConsistent = (
        (subscriptionTone === "benefits" && subscriptionActionText === "혜택 보기")
        || (subscriptionTone === "manage" && subscriptionActionText === "관리하기")
        || (subscriptionTone === "neutral" && subscriptionActionText === "확인하기")
      );
      const subscriptionHasGradient = subscription
        ? getComputedStyle(subscription).backgroundImage.includes("gradient")
        : false;
      const subscriptionActionHeight = Math.round(subscriptionActionRect?.height ?? 0);
      return {
        shortcutLabels,
        subscriptionTitle,
        subscriptionActionText,
        subscriptionTone,
        subscriptionStateConsistent,
        subscriptionActionConsistent,
        subscriptionHasGradient,
        subscriptionHeight: Math.round(subscriptionRect?.height ?? 0),
        subscriptionActionHeight,
        valid: JSON.stringify(shortcutLabels) === ${JSON.stringify(JSON.stringify(parentHomeShortcutLabels))}
          && isElementVisible(subscription)
          && subscriptionStateConsistent
          && subscriptionActionConsistent
          && (subscriptionTone === "neutral" || subscriptionHasGradient)
          && (subscriptionRect?.height ?? 0) >= 100
          && subscriptionActionHeight >= 36,
      };
    })() : null;
    return {
      hash: location.hash,
      visible: requiredSelectorVisible,
      requiredSelectorVisible,
      renderContext,
      requiredDiagnostic: required
        ? {
            count: document.querySelectorAll(${JSON.stringify(route.selector)}).length,
            display: requiredStyle?.display ?? null,
            visibility: requiredStyle?.visibility ?? null,
            opacity: requiredStyle?.opacity ?? null,
            animationName: requiredStyle?.animationName ?? null,
            animationDuration: requiredStyle?.animationDuration ?? null,
            animationFillMode: requiredStyle?.animationFillMode ?? null,
            animationPlayState: requiredStyle?.animationPlayState ?? null,
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
            animations: required.getAnimations().map((animation) => ({
              playState: animation.playState,
              currentTime: typeof animation.currentTime === "number" ? Math.round(animation.currentTime) : null,
              progress: animation.effect?.getComputedTiming().progress ?? null,
            })),
            width: Math.round(requiredRect?.width ?? 0),
            height: Math.round(requiredRect?.height ?? 0),
          }
        : { count: 0 },
      mapReady: ${route.requiresMap === true}
        ? Boolean(mapCanvas && mapCanvas.childElementCount > 0 && !document.querySelector(".km-error"))
        : null,
      textLength: text.trim().length,
      errorPhrases: phrases,
      missingRequiredPhrases,
      parentHome: parentHomeFacts,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      viewport: { width: innerWidth, height: innerHeight },
      busyCount: document.querySelectorAll("[aria-busy='true']").length,
      buttonCount: document.querySelectorAll("button").length,
      smallControlCount: smallControls.length,
      smallControls: smallControls.slice(0, 10),
    };
    })()`);
    if (view.busyCount === 0 || Date.now() >= settleDeadline) break;
    await delay(250);
  } while (true);
  routeResults.push({
    name: route.name,
    expectedHash: route.hash,
    ...view,
    newConsoleOrRuntimeErrors: runtimeErrors.length + consoleErrors.length - errorOffset,
    newNetworkErrors: networkErrors.slice(networkErrorOffset),
  });
}

await evaluate(`location.hash = ${JSON.stringify(safeHomeHash)}; true`);
await delay(500);

const result = {
  checkedAt: new Date().toISOString(),
  targetUrl: String(target.url).replace(/[?#].*$/, ""),
  expectedRole,
  routeScope,
  session: sessionCheck,
  routes: routeResults,
  runtimeErrors: [...new Set(runtimeErrors)],
  consoleErrors: [...new Set(consoleErrors)],
  networkErrors,
  networkFailures,
};

const environmentBlocked = routeResults.some((route) => (
  route.renderContext?.visibilityState !== "visible"
  || route.renderContext?.hidden !== false
  || route.renderContext?.hasFocus !== true
));
result.environmentBlocked = environmentBlocked;

console.log(JSON.stringify(result, null, 2));
socket.close();

const failed = (
  !sessionCheck?.hasSession
  || sessionCheck?.localRole !== expectedRole
  || sessionCheck?.serverRole !== expectedRole
  || sessionCheck?.familyMineStatus !== 200
  || !sessionCheck?.familyMatches
  || !sessionCheck?.roleMatches
  || routeResults.some((route) => (
    route.hash !== route.expectedHash
    || !route.visible
    || !route.requiredSelectorVisible
    || (route.mapReady === false)
    || route.textLength === 0
    || route.errorPhrases.length > 0
    || route.missingRequiredPhrases.length > 0
    || route.parentHome?.valid === false
    || route.horizontalOverflowPx > 1
    || route.busyCount > 0
    || route.smallControlCount > 0
    || route.newConsoleOrRuntimeErrors > 0
    || route.newNetworkErrors.length > 0
  ))
  || runtimeErrors.length > 0
  || consoleErrors.length > 0
  || networkErrors.length > 0
);

if (environmentBlocked) process.exitCode = 2;
else if (failed) process.exitCode = 1;
