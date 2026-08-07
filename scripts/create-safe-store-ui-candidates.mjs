import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { hashDirectory, hashFile } from "./release-evidence.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = resolve(ROOT_DIR, "dist/index.html");
const VITE_BIN = resolve(ROOT_DIR, "node_modules/vite/bin/vite.js");
const TEMP_DIR = resolve(ROOT_DIR, "tmp-verify-store-ui");
export const SAFE_STORE_UI_CANDIDATE_DIR = resolve(ROOT_DIR, "output/store-ui-candidates-v1");
export const STORE_UI_WIDTH = 1080;
export const STORE_UI_HEIGHT = 1920;

const PREVIEW_PORT = 4193;
const LOCAL_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const FAMILY_ID = "demo-family";
const PARENT_ID = "demo-parent";
const CHILD_ID = "demo-child";
const PARENT_MEMBER_ID = "demo-parent-member";
const CHILD_MEMBER_ID = "demo-child-member";

export const SAFE_STORE_UI_CANDIDATES = Object.freeze([
  Object.freeze({
    file: "01-parent-home-ui.png",
    route: "parent/home",
    role: "parent",
    tier: "premium",
    semanticSelector: ".ph-hero",
    expectedTexts: Object.freeze(["데모 자녀의 오늘", "오늘의 일정"]),
  }),
  Object.freeze({
    file: "02-family-calendar-ui.png",
    route: "parent/calendar",
    role: "parent",
    tier: "free",
    semanticSelector: ".pc-events .pc-event__card",
    expectedTexts: Object.freeze(["가족 일정", "방과 후 일정"]),
  }),
  Object.freeze({
    file: "03-family-memo-ui.png",
    route: "parent/memo",
    role: "parent",
    tier: "free",
    semanticSelector: ".mc-root .mc-bubble",
    expectedTexts: Object.freeze(["데모 자녀", "오늘 가족 일정을 확인해 주세요.", "조심히 와 💛"]),
  }),
  Object.freeze({
    file: "04-daily-safety-report-ui.png",
    route: "daily-report",
    role: "parent",
    tier: "premium",
    semanticSelector: ".dr-root .dr-overview",
    expectedTexts: Object.freeze(["오늘의 안심 리포트", "데모 자녀 · 오늘"]),
  }),
  Object.freeze({
    file: "05-weekly-family-report-ui.png",
    route: "weekly-report",
    role: "parent",
    tier: "premium",
    semanticSelector: ".wr-root .wr-metrics",
    expectedTexts: Object.freeze(["주간 가족 리포트", "데모 자녀"]),
  }),
  Object.freeze({
    file: "06-child-home-ui.png",
    route: "child/home",
    role: "child",
    tier: "free",
    semanticSelector: ".kd-root .kd-node",
    expectedTexts: Object.freeze(["데모 자녀의 오늘", "가족 일정"]),
  }),
]);

const CANDIDATE_READY_TIMEOUT_MS = 15_000;
const CANDIDATE_READY_POLL_MS = 125;

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function assessCandidateReadiness(candidate, state) {
  const problems = [];
  if (state.hash !== `#/${candidate.route}`) problems.push(`route_hash_mismatch:${state.hash || "empty"}`);
  if (state.crash) problems.push("crash_screen_present");
  if (!state.text) problems.push("empty_body_text");
  if (state.width > 360) problems.push(`horizontal_overflow_${state.width}px`);
  if (!state.semanticSelectorFound) problems.push("semantic_selector_missing");
  if (state.bootSplashPresent) problems.push("boot_splash_present");
  if (!state.fontsLoaded) {
    const pending = Array.isArray(state.pendingFontTexts) ? state.pendingFontTexts.join("|") : "unknown";
    const fontStatus = typeof state.fontStatus === "string" ? state.fontStatus : "unknown";
    const fontFaceStatusCounts = state.fontFaceStatusCounts && typeof state.fontFaceStatusCounts === "object"
      ? Object.entries(state.fontFaceStatusCounts)
        .map(([status, count]) => `${status}=${count}`)
        .join("|")
      : "unknown";
    const loadingFontFaces = Array.isArray(state.loadingFontFaces)
      ? state.loadingFontFaces.map((face) => [
          face?.family,
          face?.weight,
          face?.style,
          face?.unicodeRange,
        ].filter(Boolean).join("/")).join("|")
      : "unknown";
    problems.push(`fonts_not_loaded:${pending}:set=${fontStatus}:faces=${fontFaceStatusCounts}:loading=${loadingFontFaces}`);
  }
  if (Array.isArray(state.visibleLoadingTexts) && state.visibleLoadingTexts.length > 0) {
    problems.push("visible_loading_state");
  }
  for (const expectedText of candidate.expectedTexts) {
    if (!state.text.includes(expectedText)) problems.push(`expected_text_missing:${expectedText}`);
  }
  return { ready: problems.length === 0, problems };
}

async function candidateRenderState(cdp, candidate) {
  return cdp.evaluate(`(async () => {
    const isVisible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const loadingPattern = /(?:불러오는 중|확인하고 있어요|로딩 중)/;
    const visibleLoadingTexts = Array.from(document.querySelectorAll(
      ".hy-loading, [role='status'], [aria-busy='true']",
    ))
      .filter(isVisible)
      .map((element) => (
        element.getAttribute("aria-label")
        || element.textContent
        || ""
      ).replace(/\\s+/g, " ").trim())
      .filter((text) => loadingPattern.test(text));
    const expectedTexts = ${JSON.stringify(candidate.expectedTexts)};
    const fontsLoaded = !document.fonts || await Promise.race([
      document.fonts.ready.then(() => document.fonts.status === "loaded"),
      new Promise((resolveFontWait) => setTimeout(() => resolveFontWait(false), 500)),
    ]);
    const pendingFontTexts = fontsLoaded ? [] : expectedTexts;
    const fontFaceStatusCounts = document.fonts
      ? Array.from(document.fonts).reduce((counts, face) => {
          counts[face.status] = (counts[face.status] || 0) + 1;
          return counts;
        }, {})
      : {};
    const loadingFontFaces = document.fonts
      ? Array.from(document.fonts)
        .filter((face) => face.status === "loading")
        .map((face) => ({
          family: face.family,
          weight: face.weight,
          style: face.style,
          unicodeRange: face.unicodeRange,
        }))
      : [];
    return {
      hash: location.hash,
      text: (document.body.innerText || "").replace(/\\s+/g, " ").trim(),
      crash: Boolean(document.querySelector(".hy-crash, .route-error")),
      width: document.documentElement.scrollWidth,
      semanticSelectorFound: Boolean(document.querySelector(${JSON.stringify(candidate.semanticSelector)})),
      bootSplashPresent: Boolean(document.querySelector(".sp-root")),
      visibleLoadingTexts: [...new Set(visibleLoadingTexts)],
      fontsLoaded,
      pendingFontTexts,
      fontStatus: document.fonts?.status || "unsupported",
      fontFaceStatusCounts,
      loadingFontFaces,
    };
  })()`);
}

export async function waitForCandidateReadiness(
  cdp,
  candidate,
  { timeoutMs = CANDIDATE_READY_TIMEOUT_MS, pollIntervalMs = CANDIDATE_READY_POLL_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let assessment = { ready: false, problems: ["render_state_unavailable"] };
  let lastState = null;
  do {
    let state;
    try {
      state = await candidateRenderState(cdp, candidate);
    } catch {
      assessment = { ready: false, problems: ["render_state_unavailable"] };
      if (Date.now() >= deadline) break;
      await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
      continue;
    }
    lastState = state;
    assessment = assessCandidateReadiness(candidate, state);
    if (assessment.ready) return state;
    if (Date.now() >= deadline) break;
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);
  const surface = lastState
    ? `${lastState.hash || "empty"}|${String(lastState.text || "").slice(0, 160)}`
    : "unavailable";
  throw new Error(`실제 UI 후보 준비 시간 초과: ${candidate.route} (${assessment.problems.join(", ")}; surface=${surface})`);
}

async function prepareCandidateCapture(cdp, candidate) {
  if (candidate.route !== "parent/memo") return;
  const layout = await cdp.evaluate(`(async () => {
    const nextFrame = () => new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const header = document.querySelector(".mc-header");
    const composer = document.querySelector(".mc-composer");
    const quick = document.querySelector(".mc-quick");
    const scrollTarget = document.querySelector(".hy-screen");
    const messageRows = Array.from(document.querySelectorAll(".mc-msg"));
    if (!header || !composer || !quick || !scrollTarget || messageRows.length === 0) {
      return { ready: false, problem: "memo_layout_missing" };
    }

    const headerBottom = header.getBoundingClientRect().bottom;
    const clippedMessage = messageRows.find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top < headerBottom + 8 && rect.bottom > headerBottom;
    });
    if (clippedMessage) {
      scrollTarget.scrollBy(0, clippedMessage.getBoundingClientRect().top - headerBottom - 8);
      await nextFrame();
      await nextFrame();
    }

    const quickRect = quick.getBoundingClientRect();
    const quickRepliesFullyVisible = Array.from(quick.querySelectorAll(".mc-quick-btn"))
      .every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= Math.max(0, quickRect.left) - 1
          && rect.right <= Math.min(innerWidth, quickRect.right) + 1
          && rect.top >= Math.max(0, quickRect.top) - 1
          && rect.bottom <= Math.min(innerHeight, quickRect.bottom) + 1;
      });
    const captureTop = header.getBoundingClientRect().bottom;
    const captureBottom = composer.getBoundingClientRect().top;
    const clippedMessages = messageRows.map((row) => row.getBoundingClientRect()).filter((rect) => {
      const intersectsCapture = rect.bottom > captureTop && rect.top < captureBottom;
      return intersectsCapture && (rect.top < captureTop - 1 || rect.bottom > captureBottom + 1);
    });
    const messageClipped = clippedMessages.length > 0;
    const messageClipEdge = clippedMessages.some((rect) => rect.top < captureTop - 1)
      ? "top"
      : "bottom";
    return {
      ready: quickRepliesFullyVisible && !messageClipped,
      problem: !quickRepliesFullyVisible
        ? "quick_reply_chip_clipped"
        : messageClipped
          ? "memo_message_clipped_" + messageClipEdge
          : null,
    };
  })()`);
  if (!layout.ready) throw new Error(`실제 UI 후보 메모 레이아웃 실패: ${layout.problem}`);
}

function todayDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function safeAccessToken(role) {
  const userId = role === "child" ? CHILD_ID : PARENT_ID;
  const header = toBase64Url({ alg: "HS256", typ: "JWT" });
  const payload = toBase64Url({
    sub: userId,
    role,
    family_id: FAMILY_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.demo`;
}

function familyResponse(role) {
  return {
    familyId: FAMILY_ID,
    pairCode: null,
    pairCodeExpiresAt: null,
    myRole: role,
    myName: role === "child" ? "데모 자녀" : "데모 보호자",
    parentName: "데모 보호자",
    primaryParentId: PARENT_ID,
    isPrimaryParent: role === "parent",
    isCoParent: false,
    members: [
      {
        id: PARENT_MEMBER_ID,
        user_id: PARENT_ID,
        role: "parent",
        name: "데모 보호자",
        phone: null,
        photo_url: null,
      },
      {
        id: CHILD_MEMBER_ID,
        user_id: CHILD_ID,
        role: "child",
        name: "데모 자녀",
        phone: null,
        photo_url: null,
        child_order: 1,
        color_hex: "#F76BA6",
        device_health: {
          batteryLevel: 82,
          isCharging: false,
          networkConnected: true,
          networkType: "wifi",
          connectionType: "wifi",
          deviceScreenOnMs: 3_600_000,
          recentApp: null,
          usagePermission: "granted",
          appUsage: [],
          deviceUnlockCount: 3,
          postNotif: true,
          postPermissionGranted: true,
          notificationsEnabled: true,
          requiredChannelsEnabled: true,
          fullScreenIntentAllowed: true,
          remoteListenChannelEnabled: true,
          backgroundLocationGranted: true,
          locationOk: true,
          locationServiceRunning: true,
          backgroundRestricted: false,
          updatedAt: new Date().toISOString(),
        },
      },
    ],
  };
}

function entitlementResponse(tier) {
  if (tier === "premium") {
    return {
      effective: {
        tier: "premium",
        is_premium: true,
        source: "family_subscription",
        has_grandfathered_review_limits: false,
      },
      subscription: {
        status: "active",
        product_id: "premium_yearly",
        base_plan_id: "yearly",
        provider: "google_play",
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      family: { id: FAMILY_ID, user_tier: "subscription" },
    };
  }
  return {
    effective: {
      tier: "free",
      is_premium: false,
      source: "free",
      has_grandfathered_review_limits: false,
    },
    subscription: null,
    family: { id: FAMILY_ID, user_tier: "free" },
  };
}

function demoEvents() {
  const dateKey = todayDateKey();
  const createdAt = new Date().toISOString();
  return [
    {
      id: "demo-event-1",
      family_id: FAMILY_ID,
      title: "가족 일정",
      date_key: dateKey,
      time: "09:00",
      end_time: "10:00",
      category: "family",
      emoji: null,
      location: null,
      events_children: [{ child_id: CHILD_MEMBER_ID }],
      notif_override: [15, 5],
      is_family_event: true,
      created_at: createdAt,
    },
    {
      id: "demo-event-2",
      family_id: FAMILY_ID,
      title: "방과 후 일정",
      date_key: dateKey,
      time: "16:30",
      end_time: "17:30",
      category: "hobby",
      emoji: null,
      location: null,
      events_children: [{ child_id: CHILD_MEMBER_ID }],
      notif_override: [15],
      is_family_event: false,
      created_at: createdAt,
    },
  ];
}

function demoMemos() {
  const now = Date.now();
  return [
    {
      id: "demo-memo-1",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: PARENT_ID,
      user_role: "parent",
      content: "오늘 가족 일정을 확인해 주세요.",
      origin: "reply",
      read_by: [CHILD_ID],
      created_at: new Date(now - 35 * 60_000).toISOString(),
    },
    {
      id: "demo-memo-2",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: CHILD_ID,
      user_role: "child",
      content: "응, 확인했어",
      origin: "reply",
      read_by: [PARENT_ID],
      created_at: new Date(now - 30 * 60_000).toISOString(),
    },
    {
      id: "demo-memo-3",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: PARENT_ID,
      user_role: "parent",
      content: "준비물도 함께 챙겨요.",
      origin: "reply",
      read_by: [CHILD_ID],
      created_at: new Date(now - 25 * 60_000).toISOString(),
    },
    {
      id: "demo-memo-4",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: CHILD_ID,
      user_role: "child",
      content: "다 챙겼어",
      origin: "reply",
      read_by: [PARENT_ID],
      created_at: new Date(now - 20 * 60_000).toISOString(),
    },
    {
      id: "demo-memo-5",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: PARENT_ID,
      user_role: "parent",
      content: "일정이 끝나면 메시지를 남겨 주세요.",
      origin: "reply",
      read_by: [CHILD_ID],
      created_at: new Date(now - 15 * 60_000).toISOString(),
    },
    {
      id: "demo-memo-6",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: CHILD_ID,
      user_role: "child",
      content: "응, 끝나면 알려줄게",
      origin: "reply",
      read_by: [PARENT_ID],
      created_at: new Date(now - 10 * 60_000).toISOString(),
    },
  ];
}

function demoLocations() {
  return [{
    user_id: CHILD_ID,
    lat: 0,
    lng: 0,
    updated_at: new Date().toISOString(),
    accuracy_m: 8,
  }];
}

function demoSavedPlaces() {
  return [{
    id: "demo-place-1",
    family_id: FAMILY_ID,
    name: "가족 장소",
    location: {
      lat: 0,
      lng: 0,
      category: "frequent",
      alertRadiusM: 100,
    },
    is_home: false,
    is_playdate_safe: true,
  }];
}

function mockApi(pathname, candidate) {
  if (pathname === "/api/family/mine") return familyResponse(candidate.role);
  if (pathname === "/api/entitlement") return entitlementResponse(candidate.tier);
  if (pathname === "/api/events") return demoEvents();
  if (pathname === "/api/memos/replies") return demoMemos();
  if (pathname === "/api/notif-settings/child-status") {
    return { user_id: CHILD_ID, child_enabled: true, configured: true };
  }
  if (pathname === "/api/notif-settings") {
    return {
      user_id: candidate.role === "child" ? CHILD_ID : PARENT_ID,
      child_enabled: true,
      parent_enabled: true,
      location_enabled: true,
      registered_place_enabled: true,
      playdate_enabled: true,
      minutes_before: [15, 5],
      quiet_hours: {
        enabled: false,
        start_minute: 1320,
        end_minute: 420,
        updated_at: null,
        configured: false,
      },
    };
  }
  if (pathname === "/api/ai/usage/today") return { used: 1, daily_limit: candidate.tier === "premium" ? 20 : 5 };
  if (pathname === "/api/ai/credits/public-status") {
    return { isPremium: candidate.tier === "premium", dailyIncludedLimit: candidate.tier === "premium" ? 20 : 5, dailyIncludedUsed: 1, dailyIncludedRemaining: candidate.tier === "premium" ? 19 : 4, purchasedCredits: 0, purchasedCreditDebt: 0 };
  }
  if (pathname === "/api/ai/settings/friend-public") return { name: "데모 친구", persona: "cheerful" };
  if (pathname === "/api/ai/settings/chat") return { friend_name: "데모 친구", persona: "cheerful" };
  if (pathname === "/api/ai/day-summary") return null;
  if (pathname === "/api/review-rewards") return { reviewed: false, rewarded: false };
  if (pathname === "/api/location/children") return demoLocations();
  if (pathname === "/api/location/history") return [];
  if (pathname === "/api/location-prefs") return { family_id: FAMILY_ID, interval_mode: "balanced", background_enabled: true };
  if (pathname === "/api/daily-supplies") {
    return [{ family_id: FAMILY_ID, child_user_id: CHILD_MEMBER_ID, date_key: todayDateKey(), prep: [{ id: "demo-supply-1", text: "준비물 확인", done: false }], homework: [] }];
  }
  if (pathname === "/api/stickers/summary") return [{ user_id: CHILD_ID, sticker_type: "praise", count: 2 }];
  if (pathname === "/api/stickers/received") return [];
  if (pathname === "/api/stickers/date") return [];
  if (pathname === "/api/parent-alerts") return [];
  if (pathname === "/api/saved-places") return demoSavedPlaces();
  if (pathname === "/api/danger-zones") return [];
  if (pathname === "/api/academies") return [];
  if (pathname === "/api/memos/blocks") return { blockedUserIds: [] };
  if (pathname === "/api/referrals/me") return { code: null, shareUrl: null, successfulReferrals: 0, pendingReferrals: 0 };
  if (pathname === "/api/realtime/ticket") return { ticket: "demo-realtime-ticket", expiresAt: Date.now() + 45_000 };
  if (pathname === "/api/premium-funnel/events") return { accepted: true };
  return [];
}

function browserPath() {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    resolve(localAppData, "ms-playwright/chromium-1228/chrome-win/chrome.exe"),
    resolve(localAppData, "ms-playwright/chromium-1223/chrome-win/chrome.exe"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.handlers) handler(message);
    });
  }

  on(handler) {
    this.handlers.push(handler);
  }

  send(method, params = {}, timeoutMs = 20_000) {
    const id = (this.nextId += 1);
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveSend(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectSend(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("브라우저 평가 중 예외가 발생했습니다");
    return result.result.value;
  }
}

async function waitForHttp(url, attempts = 80) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 로컬 preview 또는 CDP가 준비될 때까지 짧게 재시도한다.
    }
    await wait(250);
  }
  throw new Error(`로컬 프로세스 준비 실패: ${url}`);
}

async function waitForDocumentReadiness(cdp, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const state = await cdp.evaluate(`(() => ({
        origin: location.origin,
        pathname: location.pathname,
        readyState: document.readyState,
      }))()`);
      if (
        state.origin === LOCAL_ORIGIN
        && state.pathname === "/index.html"
        && state.readyState === "complete"
      ) return;
    } catch {
      // 전체 문서 전환 중 파괴된 execution context는 새 문서가 준비될 때까지 재시도한다.
    }
    await wait(100);
  } while (Date.now() <= deadline);
  throw new Error("스토어 UI 세션 설정용 문서 준비 시간 초과");
}

async function waitForChildExit(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return true;
  const exited = new Promise((resolveExit) => processHandle.once("exit", () => resolveExit(true)));
  return Promise.race([exited, wait(timeoutMs).then(() => false)]);
}

async function stopProcessTree(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  if (process.platform === "win32" && processHandle.pid) {
    const taskkill = spawn(
      "C:/Windows/System32/taskkill.exe",
      ["/PID", String(processHandle.pid), "/T", "/F"],
      { env: {}, shell: false, stdio: "ignore", windowsHide: true },
    );
    await waitForChildExit(taskkill, 5_000);
  } else {
    processHandle.kill("SIGTERM");
  }
  if (await waitForChildExit(processHandle, 3_000)) return;
  processHandle.kill("SIGKILL");
  await waitForChildExit(processHandle, 1_000);
}

async function waitForDevToolsActivePort(profileRoot, processHandle, attempts = 200) {
  const activePortPath = resolve(profileRoot, "DevToolsActivePort");
  for (let index = 0; index < attempts; index += 1) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error("격리 Chrome이 CDP 준비 전에 종료되었습니다");
    }
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
    } catch {
      // Chrome이 동적 CDP 포트 파일을 쓸 때까지 짧게 재시도한다.
    }
    await wait(50);
  }
  throw new Error("격리 Chrome의 동적 CDP 포트를 확인하지 못했습니다");
}

async function connectCdp(cdpPort) {
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("CDP page target을 찾지 못했습니다");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  return { socket, client: new CdpClient(socket) };
}

function sessionFor(role) {
  const userId = role === "child" ? CHILD_ID : PARENT_ID;
  return {
    access: safeAccessToken(role),
    refresh: "demo-refresh-not-valid",
    user: {
      id: userId,
      app_metadata: { role, family_id: FAMILY_ID },
      user_metadata: { role, family_id: FAMILY_ID },
    },
    session_instance_id: `demo-${role}`,
  };
}

export async function generateSafeStoreUiCandidates() {
  if (!existsSync(DIST_INDEX)) throw new Error("dist가 없습니다. 먼저 npm run build를 실행하세요");
  if (!existsSync(VITE_BIN)) throw new Error("로컬 Vite 실행 파일이 없습니다. 먼저 npm ci를 실행하세요");
  const chromePath = browserPath();
  if (!chromePath) throw new Error("로컬 Chrome 또는 Playwright Chromium을 찾지 못했습니다");
  const sourceDistBefore = hashDirectory(resolve(ROOT_DIR, "dist"));
  const chromeProfileDir = resolve(TEMP_DIR, `profile-${process.pid}-${Date.now()}`);

  await mkdir(TEMP_DIR, { recursive: true });
  await mkdir(SAFE_STORE_UI_CANDIDATE_DIR, { recursive: true });

  const preview = spawn(process.execPath, [VITE_BIN, "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], {
    cwd: ROOT_DIR,
    stdio: "ignore",
  });
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${chromeProfileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-background-networking",
    "--window-size=360,640",
    "about:blank",
  ], { env: {}, shell: false, stdio: "ignore", windowsHide: true });

  let socket;
  try {
    await waitForHttp(`${LOCAL_ORIGIN}/index.html`);
    const cdpPort = await waitForDevToolsActivePort(chromeProfileDir, chrome);
    const connected = await connectCdp(cdpPort);
    socket = connected.socket;
    const cdp = connected.client;
    let activeCandidate = SAFE_STORE_UI_CANDIDATES[0];
    const runtimeErrors = [];
    const fontNetworkEvents = [];
    const fontRequestPaths = new Map();

    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 640,
      screenWidth: 360,
      screenHeight: 640,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });

    cdp.on((message) => {
      if (message.method === "Network.requestWillBeSent") {
        const requestUrl = message.params.request?.url;
        if (typeof requestUrl === "string" && requestUrl.includes("/fonts/jua/") && requestUrl.endsWith(".woff2")) {
          const requestPath = new URL(requestUrl).pathname;
          fontRequestPaths.set(message.params.requestId, requestPath);
          fontNetworkEvents.push(`requested:${requestPath}`);
        }
      }
      if (message.method === "Network.responseReceived" && fontRequestPaths.has(message.params.requestId)) {
        fontNetworkEvents.push(`response:${fontRequestPaths.get(message.params.requestId)}:${message.params.response?.status ?? "unknown"}`);
      }
      if (message.method === "Network.loadingFinished" && fontRequestPaths.has(message.params.requestId)) {
        fontNetworkEvents.push(`finished:${fontRequestPaths.get(message.params.requestId)}`);
      }
      if (message.method === "Network.loadingFailed" && fontRequestPaths.has(message.params.requestId)) {
        fontNetworkEvents.push(`failed:${fontRequestPaths.get(message.params.requestId)}:${message.params.errorText ?? "unknown"}`);
      }
      if (message.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(message.params.exceptionDetails?.text ?? "runtime_exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        runtimeErrors.push("console_error");
      }
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      void (async () => {
        try {
          const url = new URL(request.url);
          if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
            await cdp.send("Fetch.continueRequest", { requestId });
            return;
          }
          const headers = [
            { name: "access-control-allow-origin", value: "*" },
            { name: "access-control-allow-headers", value: "*" },
            { name: "access-control-allow-methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
          ];
          if (request.method === "OPTIONS") {
            await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: headers });
            return;
          }
          const body = Buffer.from(JSON.stringify(mockApi(url.pathname, activeCandidate))).toString("base64");
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [...headers, { name: "content-type", value: "application/json; charset=utf-8" }],
            body,
          });
        } catch {
          await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => undefined);
        }
      })();
    });

    const generated = [];
    for (const candidate of SAFE_STORE_UI_CANDIDATES) {
      activeCandidate = candidate;
      runtimeErrors.length = 0;
      fontNetworkEvents.length = 0;
      await cdp.send("Page.navigate", { url: `${LOCAL_ORIGIN}/index.html` });
      await waitForDocumentReadiness(cdp);
      const session = sessionFor(candidate.role);
      await cdp.evaluate(`(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("hyeni-api-session-v1", ${JSON.stringify(JSON.stringify(session))});
        localStorage.setItem("hyeni-active-child-v1", ${JSON.stringify(JSON.stringify({ [FAMILY_ID]: CHILD_MEMBER_ID }))});
        return true;
      })()`);
      const captureUrl = `${LOCAL_ORIGIN}/index.html?capture=${encodeURIComponent(candidate.file)}#/${candidate.route}`;
      await cdp.send("Page.navigate", { url: captureUrl });
      try {
        await waitForCandidateReadiness(cdp, candidate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}; fontNetwork=${fontNetworkEvents.slice(-24).join("|") || "none"}`);
      }
      await prepareCandidateCapture(cdp, candidate);
      await wait(150);
      const state = await waitForCandidateReadiness(cdp, candidate, { timeoutMs: 1_000 });
      if (runtimeErrors.length > 0) throw new Error(`실제 UI 후보 런타임 오류: ${candidate.route}`);
      if (/(?:01[016789]|02|0[3-6][1-5])-?\d{3,4}-?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|KID-|QR|초대 코드|[+-]?\d{1,2}\.\d{4,}\s*[,/]\s*[+-]?\d{1,3}\.\d{4,}/i.test(state.text)) {
        throw new Error(`실제 UI 후보 개인정보 패턴 감지: ${candidate.route}`);
      }

      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        fromSurface: true,
      }, 30_000);
      const outputPath = resolve(SAFE_STORE_UI_CANDIDATE_DIR, candidate.file);
      await sharp(Buffer.from(shot.data, "base64"))
        .resize(STORE_UI_WIDTH, STORE_UI_HEIGHT, { fit: "fill" })
        .flatten({ background: "#FBF7F4" })
        .removeAlpha()
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
        .toFile(outputPath);
      generated.push(outputPath);
    }

    const sourceDist = hashDirectory(resolve(ROOT_DIR, "dist"));
    if (
      sourceDist.fileCount !== sourceDistBefore.fileCount
      || sourceDist.sha256 !== sourceDistBefore.sha256
    ) {
      throw new Error("production_dist_changed_during_capture");
    }
    const artifacts = [];
    const technicalChecks = {
      exactDimensions: true,
      opaqueRgb: true,
      metadataFree: true,
      piiPatternFree: true,
      unexpectedClippingAbsent: true,
      featureTruthfulness: true,
    };
    for (const candidate of SAFE_STORE_UI_CANDIDATES) {
      const outputPath = resolve(SAFE_STORE_UI_CANDIDATE_DIR, candidate.file);
      const outputStat = await stat(outputPath);
      const [metadata, imageStats] = await Promise.all([
        sharp(outputPath).metadata(),
        sharp(outputPath).stats(),
      ]);
      technicalChecks.exactDimensions &&= metadata.format === "png"
        && metadata.width === STORE_UI_WIDTH
        && metadata.height === STORE_UI_HEIGHT;
      technicalChecks.opaqueRgb &&= metadata.channels === 3 && metadata.hasAlpha === false;
      technicalChecks.metadataFree &&= metadata.exif === undefined
        && metadata.iptc === undefined
        && metadata.xmp === undefined;
      const nonEmptyImage = imageStats.channels.every((channel) => channel.stdev > 8);
      if (!nonEmptyImage) throw new Error(`실제 UI 후보 이미지가 비어 있습니다: ${candidate.file}`);
      artifacts.push({
        file: candidate.file,
        bytes: outputStat.size,
        sha256: hashFile(outputPath),
      });
    }
    if (!Object.values(technicalChecks).every(Boolean)) {
      const failedChecks = Object.entries(technicalChecks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name)
        .join(",");
      throw new Error(`실제 UI 후보 기술 검토 실패: ${failedChecks}`);
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      source: "local-production-dist-with-static-demo-session",
      sourceDist,
      uploadStatus: "candidate_requires_policy_and_visual_review",
      files: SAFE_STORE_UI_CANDIDATES,
      artifacts,
    };
    const manifestPath = resolve(SAFE_STORE_UI_CANDIDATE_DIR, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const technicalReview = {
      schemaVersion: 1,
      artifactKind: "hyeni-store-ui-technical-review",
      reviewedAt: new Date().toISOString(),
      sourceManifest: {
        path: "manifest.json",
        sha256: hashFile(manifestPath),
      },
      sourceDist,
      verdict: "TECHNICAL_REVIEW_PASSED",
      playUploadApproved: false,
      humanPolicyApprovalRequired: true,
      checks: technicalChecks,
      artifacts,
    };
    await writeFile(
      resolve(SAFE_STORE_UI_CANDIDATE_DIR, "technical-review.json"),
      `${JSON.stringify(technicalReview, null, 2)}\n`,
      "utf8",
    );
    return generated;
  } finally {
    try {
      socket?.close();
    } catch {
      // 종료 단계의 소켓 오류는 생성 결과를 바꾸지 않는다.
    }
    await stopProcessTree(chrome).catch(() => undefined);
    await stopProcessTree(preview).catch(() => undefined);
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const generated = await generateSafeStoreUiCandidates();
  process.stdout.write(`실제 인앱 UI 안전 후보 ${generated.length}개 생성 완료: ${SAFE_STORE_UI_CANDIDATE_DIR}\n`);
}
