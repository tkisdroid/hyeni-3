/**
 * 최종 모바일 브라우저 QA 하니스.
 *
 * 최신 production dist를 localhost의 격리 Chrome 프로필에서 열고, 외부 요청을
 * 정적 fixture로 닫은 뒤 부모/아이 전 화면과 핵심 전환 동선을 검증한다.
 * 운영 API·실결제·ADB에는 접근하지 않는다.
 *
 * 사용: npm run build && npm run qa:browser
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareFreshQaOutputDir,
  resolveQaOutputDir,
} from "./lib/qaArtifactOutput.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = resolve(ROOT_DIR, "dist/index.html");
const VITE_BIN = resolve(ROOT_DIR, "node_modules/vite/bin/vite.js");
export const BROWSER_QA_OUTPUT_DIR = resolve(ROOT_DIR, "artifacts/release-evidence/browser-qa");
export const BROWSER_QA_VIEWPORT = Object.freeze({ width: 390, height: 844 });

export function extractDistEntryAssets(indexHtml) {
  return [...new Set(
    [...indexHtml.matchAll(/(?:src|href)="(?:\.\/|\/)([^"?#]+\.(?:js|css))(?:[?#][^"]*)?"/g)]
      .map((match) => match[1]),
  )];
}

const FAMILY_ID = "qa-family";
const PARENT_ID = "qa-parent";
const CHILD_ID = "qa-child";
const TEACHER_ID = "qa-teacher";
const PARENT_MEMBER_ID = "qa-parent-member";
const CHILD_MEMBER_ID = "qa-child-member";
const HOME = Object.freeze({ lat: 37.3021, lng: 127.1043 });
const SCHOOL = Object.freeze({ lat: 37.2925, lng: 127.1191 });

export const PARENT_BROWSER_QA_ROUTES = Object.freeze([
  "parent/home", "parent/calendar", "parent/location", "parent/memo", "parent/settings",
  "parent/family", "subscription", "trial-lock", "notifications", "remote-audio",
  "place-manager", "friend-play", "ai-schedule", "ai-credit", "phone-setup",
  "sticker-send", "profile-edit", "place-form", "child-invite", "event-form",
  "danger-zone-form", "location-status", "child-detail", "pairing-wizard",
  "family-connection", "location-settings", "account", "data-sync",
  "notification-settings", "arrival-alerts", "danger-alert", "day-summary",
  "daily-report", "weekly-report", "remote-audio-audit", "remote-ring",
  "sos-receive", "feedback", "supplies", "route", "app-update", "perm-denied",
]);

export const CHILD_BROWSER_QA_ROUTES = Object.freeze([
  "child/home", "child/sticker", "child/memo", "child/sos", "child/ai-friend",
  "child/location-status", "child/settings", "child/ai-friend-setup", "playdate-accept",
  "feedback", "supplies", "route", "app-update", "perm-denied",
]);

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jsonBody = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function todayDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function todayKst() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function safeAccessToken(role) {
  const userId = role === "child" ? CHILD_ID : role === "teacher" ? TEACHER_ID : PARENT_ID;
  return `${toBase64Url({ alg: "HS256", typ: "JWT" })}.${toBase64Url({
    sub: userId,
    role,
    family_id: FAMILY_ID,
    exp: Math.floor(Date.now() / 1000) + 3_600,
  })}.qa`;
}

function familyResponse(role) {
  const myId = role === "child" ? CHILD_ID : role === "teacher" ? TEACHER_ID : PARENT_ID;
  return {
    familyId: FAMILY_ID,
    pairCode: "KID-QA123456",
    pairCodeExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    myRole: role,
    myName: role === "child" ? "데모 자녀" : role === "teacher" ? "데모 선생님" : "데모 보호자",
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
        birthdate: "2016-03-02",
        gender: "female",
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
    user: { id: myId },
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
        product_id: "hyeni_premium",
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

function webBillingCatalog(mode) {
  if (mode === "invalid") return { configured: false, accepting: false };
  return {
    provider: "toss_payments",
    currency: "KRW",
    trialEligible: true,
    trialDays: 7,
    plans: {
      month: { amount: 4_900, displayPrice: "월 4,900원" },
      year: { amount: 39_000, displayPrice: "연 39,000원" },
    },
  };
}

function savedPlaces(overLimit) {
  const rows = [
    {
      id: "qa-place-home",
      family_id: FAMILY_ID,
      name: "우리 집",
      location: { ...HOME, address: "경기도 데모시 가족로 1", category: "home", alertRadiusM: 100 },
      is_home: true,
      is_playdate_safe: true,
      tier_alert_active: true,
      tier_alert_inactive_reason: null,
    },
    {
      id: "qa-place-school",
      family_id: FAMILY_ID,
      name: "데모 학교",
      location: { ...SCHOOL, address: "경기도 데모시 학교로 2", category: "school", alertRadiusM: 100 },
      is_home: false,
      is_playdate_safe: true,
      tier_alert_active: true,
      tier_alert_inactive_reason: null,
    },
  ];
  if (overLimit) {
    rows.push({
      id: "qa-place-academy",
      family_id: FAMILY_ID,
      name: "데모 피아노",
      location: { lat: 37.296, lng: 127.111, address: "경기도 데모시 음악로 3", category: "academy", alertRadiusM: 80 },
      is_home: false,
      is_playdate_safe: false,
      tier_alert_active: false,
      tier_alert_inactive_reason: "premium_required",
    });
  }
  return rows;
}

function dangerZones(overLimit) {
  const rows = [{
    id: "qa-zone-1",
    family_id: FAMILY_ID,
    name: "공사 구역",
    lat: 37.3,
    lng: 127.11,
    radius_m: 100,
    tier_alert_active: true,
    tier_alert_inactive_reason: null,
  }];
  if (overLimit) rows.push({
    id: "qa-zone-2",
    family_id: FAMILY_ID,
    name: "차량 통행 구역",
    lat: 37.301,
    lng: 127.112,
    radius_m: 120,
    tier_alert_active: false,
    tier_alert_inactive_reason: "premium_required",
  });
  return rows;
}

function demoEvents() {
  const createdAt = new Date().toISOString();
  return [
    {
      id: "qa-event-1",
      family_id: FAMILY_ID,
      title: "가족 일정",
      date_key: todayDateKey(),
      time: "09:00",
      end_time: "10:00",
      category: "family",
      emoji: null,
      location: { ...SCHOOL, address: "경기도 데모시 학교로 2" },
      events_children: [{ child_id: CHILD_MEMBER_ID }],
      notif_override: [15, 5],
      is_family_event: true,
      created_at: createdAt,
    },
    {
      id: "qa-event-2",
      family_id: FAMILY_ID,
      title: "방과 후 일정",
      date_key: todayDateKey(),
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
  return [
    {
      id: "qa-memo-1",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: PARENT_ID,
      user_role: "parent",
      content: "오늘 가족 일정을 확인해 주세요.",
      origin: "reply",
      read_by: [CHILD_ID],
      created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    },
    {
      id: "qa-memo-2",
      family_id: FAMILY_ID,
      date_key: todayDateKey(),
      child_id: CHILD_MEMBER_ID,
      user_id: CHILD_ID,
      user_role: "child",
      content: "응, 확인했어",
      origin: "reply",
      read_by: [PARENT_ID],
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    },
  ];
}

function mockApi(pathname, scenario) {
  const {
    role,
    tier,
    catalogMode = "valid",
    overLimit = false,
    aiScheduleExhausted = false,
  } = scenario;
  if (pathname === "/api/family/mine") return familyResponse(role);
  if (pathname === "/api/entitlement") return entitlementResponse(tier);
  if (pathname === "/api/billing/web/catalog") return webBillingCatalog(catalogMode);
  if (pathname === "/api/billing/web/ai-credits/catalog") return { configured: false, accepting: false };
  if (pathname === "/api/premium-funnel/events") return { accepted: true };
  if (pathname === "/api/realtime/ticket") return {
    ticket: safeAccessToken(role),
    expires_at: new Date(Date.now() + 45_000).toISOString(),
    expires_in: 45,
  };
  if (pathname === "/api/events") return demoEvents();
  if (pathname === "/api/memos/replies") return demoMemos();
  if (pathname === "/api/memos/blocks") return { blockedUserIds: [] };
  if (pathname === "/api/notif-settings/child-status") {
    return { user_id: CHILD_ID, child_enabled: true, configured: true };
  }
  if (pathname === "/api/notif-settings/family") {
    return {
      family_id: FAMILY_ID,
      recipients: [
        { target_user_id: PARENT_ID, role: "parent", enabled: false, start_minute: 1320, end_minute: 420, updated_at: null, configured: false },
        { target_user_id: CHILD_ID, role: "child", enabled: false, start_minute: 1320, end_minute: 420, updated_at: null, configured: false },
      ],
    };
  }
  if (pathname === "/api/notif-settings") {
    return {
      user_id: role === "child" ? CHILD_ID : PARENT_ID,
      family_id: FAMILY_ID,
      child_enabled: true,
      parent_enabled: true,
      location_enabled: true,
      registered_place_enabled: true,
      playdate_enabled: true,
      minutes_before: [15, 5],
      quiet_hours: { enabled: false, start_minute: 1320, end_minute: 420, updated_at: null, configured: false },
    };
  }
  if (pathname === "/api/ai/usage/today") return { count: 1, usage_date: todayKst() };
  if (pathname === "/api/ai/credits/public-status") {
    const limit = tier === "premium" ? 20 : 5;
    return { isPremium: tier === "premium", dailyIncludedLimit: limit, dailyIncludedUsed: 1, dailyIncludedRemaining: limit - 1, purchasedCredits: 0, purchasedCreditDebt: 0 };
  }
  if (pathname === "/api/ai/credits/balance") {
    const limit = tier === "premium" ? 20 : 5;
    return { balance: { is_premium: tier === "premium", daily_included_limit: limit, daily_included_used: 1, daily_reset_date: todayKst(), purchased_credits: 0, purchased_credit_debt: 0, available_remaining: limit - 1 }, totalPurchased: 0 };
  }
  if (pathname === "/api/ai/credits/ledger" || pathname === "/api/ai/messages") return [];
  if (pathname === "/api/ai/settings/friend-public") return { ai_enabled: true, ai_friend_name: "데모 친구", daily_limit: tier === "premium" ? 20 : 5 };
  if (pathname === "/api/ai/settings/friend") return { ai_enabled: true, ai_friend_name: "데모 친구", daily_limit: tier === "premium" ? 20 : 5 };
  if (pathname === "/api/ai/settings/chat") return { enabled: true, daily_limit: tier === "premium" ? 20 : 5 };
  if (pathname === "/api/ai/day-summary") return null;
  if (pathname === "/api/ai/voice-parse") {
    return aiScheduleExhausted
      ? { error: "daily_limit_reached", remaining: 0, dailyLimit: 5 }
      : { events: [] };
  }
  if (pathname === "/api/review-rewards") return { reviewed: false, rewarded: false };
  if (pathname === "/api/location/children") return [{ user_id: CHILD_ID, ...SCHOOL, updated_at: new Date().toISOString(), accuracy_m: 8 }];
  if (pathname === "/api/location/history") {
    const now = Date.now();
    return [
      { user_id: CHILD_ID, ...HOME, recorded_at: new Date(now - 100 * 60_000).toISOString(), accuracy_m: 12, is_estimated: 0 },
      { user_id: CHILD_ID, lat: HOME.lat + 0.00004, lng: HOME.lng + 0.00003, recorded_at: new Date(now - 85 * 60_000).toISOString(), accuracy_m: 10, is_estimated: 0 },
      { user_id: CHILD_ID, lat: 37.2972, lng: 127.1112, recorded_at: new Date(now - 75 * 60_000).toISOString(), accuracy_m: 14, is_estimated: 0 },
      { user_id: CHILD_ID, ...SCHOOL, recorded_at: new Date(now - 65 * 60_000).toISOString(), accuracy_m: 9, is_estimated: 0 },
      { user_id: CHILD_ID, lat: SCHOOL.lat + 0.00003, lng: SCHOOL.lng - 0.00002, recorded_at: new Date(now - 45 * 60_000).toISOString(), accuracy_m: 8, is_estimated: 0 },
      { user_id: CHILD_ID, lat: SCHOOL.lat - 0.00002, lng: SCHOOL.lng + 0.00002, recorded_at: new Date(now - 5 * 60_000).toISOString(), accuracy_m: 8, is_estimated: 0 },
    ];
  }
  if (pathname === "/api/location-prefs") return { family_id: FAMILY_ID, interval_mode: "balanced", background_enabled: true };
  if (pathname === "/api/daily-supplies") return [{ family_id: FAMILY_ID, child_user_id: CHILD_MEMBER_ID, date_key: todayDateKey(), prep: [{ id: "qa-supply-1", text: "준비물 확인", done: false }], homework: [] }];
  if (pathname === "/api/stickers/summary") return [{ user_id: CHILD_ID, sticker_type: "praise", count: 2 }];
  if (pathname === "/api/stickers/received" || pathname === "/api/stickers/date") return [];
  if (pathname === "/api/parent-alerts") return [{ id: "qa-alert-1", alert_type: "place_arrived", title: "학교 도착", message: "데모 자녀가 학교에 도착했어요.", severity: "info", event_id: null, child_user_id: CHILD_ID, read: false, created_at: new Date(Date.now() - 20 * 60_000).toISOString() }];
  if (pathname === "/api/saved-places") return savedPlaces(overLimit);
  if (pathname === "/api/danger-zones") return dangerZones(overLimit);
  if (pathname === "/api/academies") return tier === "premium" ? [{ id: "qa-academy-1", family_id: FAMILY_ID, child_id: CHILD_MEMBER_ID, name: "데모 피아노", category: "music", schedule: [] }] : [];
  if (pathname === "/api/referrals/me") return { code: null, shareUrl: null, successfulReferrals: 0, pendingReferrals: 0 };
  if (pathname === "/api/auth/oauth/links") return { links: [] };
  if (pathname === "/api/force-ring/active") return null;
  if (pathname === "/api/force-ring/history") return [];
  if (pathname === "/api/force-ring/quota") return { allowed: true, quota: tier === "premium" ? 10 : 1, used: 0, tier };
  if (pathname === "/api/remote-listen/sessions") return [];
  if (pathname === "/api/playdate/family-enabled") return { enabled: true };
  if (pathname === "/api/playdate/candidates" || pathname === "/api/playdate/invites/pending") return [];
  if (pathname === "/api/playdate/sessions/active") return null;
  if (pathname === "/api/kakao/walking-directions") return {
    routes: [{ result_code: 0, summary: { distance: 1_200, duration: 900 }, sections: [{ roads: [{ name: "데모길", distance: 1_200, vertexes: [HOME.lng, HOME.lat, SCHOOL.lng, SCHOOL.lat] }], guides: [{ guidance: "데모길을 따라 걸어가세요", distance: 1_200 }] }] }],
  };
  if (pathname === "/api/admin/me") return { isAdmin: false };
  if (pathname.startsWith("/rest/v1/rpc/")) return [];
  return [];
}

function chromePath() {
  const localAppData = process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData/Local");
  const candidates = [
    resolve(localAppData, "ms-playwright/chromium-1228/chrome-win/chrome.exe"),
    resolve(localAppData, "ms-playwright/chromium-1223/chrome-win/chrome.exe"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("검증용 로컬 포트를 확보하지 못했습니다");
  const { port } = address;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = [];
    const rejectPending = () => {
      const error = new Error("브라우저 CDP 연결이 종료되었습니다");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    socket.addEventListener("close", rejectPending, { once: true });
    socket.addEventListener("error", rejectPending, { once: true });
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
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "브라우저 평가 예외");
    }
    return result.result.value;
  }
}

async function waitForHttp(url, attempts = 80, interrupted = () => false) {
  for (let index = 0; index < attempts; index += 1) {
    if (interrupted()) throw new Error("최종 브라우저 QA가 사용자 신호로 중단되었습니다");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 로컬 프로세스가 준비될 때까지 짧게 재시도한다.
    }
    await wait(250);
  }
  throw new Error(`로컬 프로세스 준비 실패: ${url}`);
}

async function waitForChildExit(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return true;
  const exited = new Promise((resolveExit) => processHandle.once("exit", () => resolveExit(true)));
  return Promise.race([exited, wait(timeoutMs).then(() => false)]);
}

function signalProcessTree(processHandle, signal) {
  if (process.platform !== "win32" && processHandle.pid) {
    try {
      process.kill(-processHandle.pid, signal);
      return;
    } catch {
      // 별도 프로세스 그룹이 사라졌다면 직접 자식 종료를 시도한다.
    }
  }
  processHandle.kill(signal);
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
    signalProcessTree(processHandle, "SIGTERM");
  }
  if (await waitForChildExit(processHandle, 3_000)) return;
  signalProcessTree(processHandle, "SIGKILL");
  await waitForChildExit(processHandle, 1_000);
}

function installSignalHandlers(onSignal) {
  const handlers = new Map([
    ["SIGINT", () => onSignal("SIGINT")],
    ["SIGTERM", () => onSignal("SIGTERM")],
  ]);
  for (const [signal, handler] of handlers) process.once(signal, handler);
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

async function connectCdp(cdpPort, interrupted) {
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 80, interrupted);
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

function newDocumentScript() {
  const sessions = Object.fromEntries(["parent", "child", "teacher"].map((role) => {
    const userId = role === "child" ? CHILD_ID : role === "teacher" ? TEACHER_ID : PARENT_ID;
    return [role, {
      access: safeAccessToken(role),
      refresh: "qa-refresh-not-valid",
      user: {
        id: userId,
        app_metadata: { role, family_id: FAMILY_ID },
        user_metadata: { role, family_id: FAMILY_ID },
      },
      session_instance_id: `qa-${role}`,
    }];
  }));
  return `
    (() => {
      const role = new URL(location.href).searchParams.get("qaRole") || "parent";
      const sessions = ${JSON.stringify(sessions)};
      try {
        if (role === "public") localStorage.removeItem("hyeni-api-session-v1");
        else localStorage.setItem("hyeni-api-session-v1", JSON.stringify(sessions[role] || sessions.parent));
        localStorage.setItem("hyeni-active-child-v1", JSON.stringify({ ${JSON.stringify(FAMILY_ID)}: ${JSON.stringify(CHILD_MEMBER_ID)} }));
      } catch {}

      class QaWebSocket {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) { this.url = String(url); this.readyState = 1; queueMicrotask(() => this.onopen?.({ type: "open" })); }
        addEventListener(type, listener) { if (type === "open") queueMicrotask(() => listener({ type: "open" })); }
        removeEventListener() {}
        send() {}
        close() { this.readyState = 3; this.onclose?.({ type: "close", code: 1000 }); }
      }
      window.WebSocket = QaWebSocket;

      class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } getLat() { return this.lat; } getLng() { return this.lng; } }
      class LatLngBounds { constructor() { this.points = []; } extend(point) { this.points.push(point); } }
      window.__hyQaMapPanCalls = [];
      window.__hyQaOverlayContents = [];
      class Map { constructor(element, options = {}) { this.element = element; this.center = options.center || new LatLng(0, 0); this.level = options.level || 4; } setCenter(center) { this.center = center; } getCenter() { return this.center; } setLevel(level) { this.level = level; } getLevel() { return this.level; } setBounds() {} panBy(x, y) { window.__hyQaMapPanCalls.push({ x, y }); } relayout() {} }
      class Overlay {
        constructor(options = {}) { Object.assign(this, options); }
        setMap(map) {
          window.__hyQaOverlayContents = window.__hyQaOverlayContents.filter((content) => content !== this.content);
          if (map && this.content instanceof HTMLElement) window.__hyQaOverlayContents.push(this.content);
        }
      }
      class Geocoder {
        coord2Address(_lng, _lat, callback) { callback([{ road_address: { address_name: "경기도 데모시 가족로 1" }, address: { address_name: "경기도 데모시 가족동" } }], "OK"); }
        addressSearch(_query, callback) { callback([{ x: String(${SCHOOL.lng}), y: String(${SCHOOL.lat}) }], "OK"); }
      }
      class Places { keywordSearch(_query, callback) { callback([{ x: String(${SCHOOL.lng}), y: String(${SCHOOL.lat}) }], "OK"); } }
      window.kakao = { maps: { LatLng, LatLngBounds, Map, Polyline: Overlay, Circle: Overlay, Marker: Overlay, CustomOverlay: Overlay, event: { addListener() {} }, services: { Geocoder, Places }, load(callback) { callback(); } } };

      Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
        getCurrentPosition(success) { queueMicrotask(() => success({ coords: { latitude: ${SCHOOL.lat}, longitude: ${SCHOOL.lng}, accuracy: 8 } })); },
        watchPosition(success) { queueMicrotask(() => success({ coords: { latitude: ${SCHOOL.lat}, longitude: ${SCHOOL.lng}, accuracy: 8 } })); return 1; },
        clearWatch() {},
      } });
    })();
  `;
}

const inspectExpression = `(() => {
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 && !element.closest("[aria-hidden='true']");
  };
  const labelRect = (element) => {
    if (!(element instanceof HTMLInputElement) || !["checkbox", "radio"].includes(element.type)) return null;
    const label = element.closest("label") || (element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null);
    return label && isVisible(label) ? label.getBoundingClientRect() : null;
  };
  const targetSelector = "button,a[href],input:not([type='hidden']),select,textarea,[role='button'],[role='tab'],summary";
  const smallTargets = [...document.querySelectorAll(targetSelector)]
    .filter((element) => isVisible(element) && !element.matches(":disabled,[aria-disabled='true']"))
    .map((element) => {
      const own = element.getBoundingClientRect();
      const label = labelRect(element);
      const rect = label && label.width >= own.width && label.height >= own.height ? label : own;
      return { element, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
    })
    .filter(({ width, height }) => width < 43.5 || height < 43.5)
    .map(({ element, width, height }) => ({
      tag: element.tagName.toLowerCase(),
      label: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 80),
      className: element.getAttribute("class") || "",
      width,
      height,
    }));
  const brokenImages = [...document.images]
    .filter((image) => isVisible(image) && image.complete && image.naturalWidth === 0)
    .map((image) => ({ src: image.currentSrc || image.src, alt: image.alt, className: image.className }));
  const text = (document.body.innerText || "").replace(/\\s+/g, " ").trim();
  return {
    hash: location.hash,
    title: document.title,
    textLength: text.length,
    textSample: text.slice(0, 180),
    crash: Boolean(document.querySelector(".hy-crash, .route-error")),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    brokenImages,
    smallTargets,
  };
})()`;

async function screenshot(cdp, outputDir, name) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  }, 30_000);
  const path = resolve(outputDir, name);
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

async function clickSelector(cdp, selector) {
  const point = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, disabled: element.matches(":disabled,[aria-disabled='true']") };
  })()`);
  if (!point || point.disabled) throw new Error(`클릭할 수 없는 요소입니다: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function rowProblems(row) {
  const problems = [];
  if (row.state.crash) problems.push("render_crash");
  if (row.state.textLength === 0) problems.push("empty_screen");
  if (row.state.overflowX) problems.push(`document_overflow_${row.state.documentWidth}px`);
  if (row.state.brokenImages.length > 0) problems.push(`broken_images_${row.state.brokenImages.length}`);
  if (row.state.smallTargets.length > 0) problems.push(`small_targets_${row.state.smallTargets.length}`);
  if (row.console.length > 0) problems.push(`console_${row.console.length}`);
  if (row.network.length > 0) problems.push(`network_${row.network.length}`);
  return problems;
}

export function resolveBrowserQaOutputDir(args = process.argv.slice(2)) {
  return resolveQaOutputDir(args, {
    rootDir: ROOT_DIR,
    outputRoot: BROWSER_QA_OUTPUT_DIR,
  });
}

export async function runFinalBrowserQa({ outputDir = resolveBrowserQaOutputDir([]) } = {}) {
  if (!existsSync(DIST_INDEX)) throw new Error("dist가 없습니다. 먼저 npm run build를 실행하세요");
  if (!existsSync(VITE_BIN)) throw new Error("로컬 Vite 실행 파일이 없습니다. 먼저 npm ci를 실행하세요");
  const executable = chromePath();
  if (!executable) throw new Error("로컬 Chrome 또는 Playwright Chromium을 찾지 못했습니다");

  const distIndex = await readFile(DIST_INDEX);
  const distIndexText = distIndex.toString("utf8");
  const distIndexStat = await stat(DIST_INDEX);
  const distEntryAssets = extractDistEntryAssets(distIndexText);

  const freshOutputDir = await prepareFreshQaOutputDir(outputDir);
  const profileRoot = await mkdtemp(resolve(tmpdir(), "hyeni-browser-qa-"));
  const previewPort = await freePort();
  const cdpPort = await freePort();
  const origin = `http://127.0.0.1:${previewPort}`;
  const preview = spawn(process.execPath, [VITE_BIN, "preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"], {
    cwd: ROOT_DIR,
    detached: process.platform !== "win32",
    env: {},
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const chrome = spawn(executable, [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--window-size=390,844",
    "about:blank",
  ], {
    detached: process.platform !== "win32",
    env: {},
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });

  let socket;
  let interruptedSignal = null;
  let cleanupPromise = null;
  const cleanup = () => {
    cleanupPromise = (cleanupPromise ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        socket?.close();
      } catch {
        // 종료 단계 소켓 오류는 검증 결과를 바꾸지 않는다.
      }
      await stopProcessTree(chrome).catch(() => undefined);
      await stopProcessTree(preview).catch(() => undefined);
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
    });
    return cleanupPromise;
  };
  const removeSignalHandlers = installSignalHandlers((signal) => {
    interruptedSignal = signal;
    void cleanup();
  });
  try {
    const interrupted = () => interruptedSignal !== null;
    await waitForHttp(`${origin}/index.html`, 80, interrupted);
    const connected = await connectCdp(cdpPort, interrupted);
    socket = connected.socket;
    const cdp = connected.client;
    let activeScenario = { role: "parent", tier: "free", catalogMode: "valid", overLimit: false };
    let consoleMessages = [];
    let networkFailures = [];
    let documentNonce = 0;

    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      ...BROWSER_QA_VIEWPORT,
      screenWidth: BROWSER_QA_VIEWPORT.width,
      screenHeight: BROWSER_QA_VIEWPORT.height,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: newDocumentScript() });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

    cdp.on((message) => {
      if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
        consoleMessages.push(message.params.args.map((arg) => arg.description ?? String(arg.value ?? "")).join(" ").slice(0, 500));
      }
      if (message.method === "Runtime.exceptionThrown") {
        consoleMessages.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "runtime_exception").slice(0, 500));
      }
      if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        networkFailures.push(`${message.params.response.status} ${message.params.response.url}`);
      }
      if (message.method === "Network.loadingFailed" && !message.params.canceled && message.params.errorText !== "net::ERR_ABORTED") {
        networkFailures.push(`${message.params.errorText} ${message.params.type}`);
      }
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request, resourceType } = message.params;
      void (async () => {
        try {
          const url = new URL(request.url);
          if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
            await cdp.send("Fetch.continueRequest", { requestId });
            return;
          }
          const cors = [
            { name: "access-control-allow-origin", value: "*" },
            { name: "access-control-allow-headers", value: "*" },
            { name: "access-control-allow-methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
          ];
          if (request.method === "OPTIONS") {
            await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: cors });
            return;
          }
          if (resourceType === "Script") {
            await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "application/javascript" }], body: Buffer.from("/* isolated browser QA */").toString("base64") });
            return;
          }
          const payload = mockApi(url.pathname, activeScenario);
          const responseCode = url.pathname === "/api/ai/voice-parse"
            && activeScenario.aiScheduleExhausted === true
            ? 429
            : 200;
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode,
            responseHeaders: [...cors, { name: "content-type", value: "application/json; charset=utf-8" }],
            body: jsonBody(payload),
          });
        } catch {
          await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => undefined);
        }
      })();
    });

    const navigate = async (scenario, route, settleMs = 3_200) => {
      activeScenario = scenario;
      consoleMessages = [];
      networkFailures = [];
      documentNonce += 1;
      await cdp.send("Page.navigate", { url: `${origin}/index.html?qaRole=${encodeURIComponent(scenario.role)}&qaRun=${documentNonce}#/${route}` });
      await wait(settleMs);
      const state = await cdp.evaluate(inspectExpression);
      return {
        role: scenario.role,
        tier: scenario.tier,
        route,
        state,
        console: uniqueStrings(consoleMessages),
        network: uniqueStrings(networkFailures),
      };
    };

    const report = {
      generatedAt: new Date().toISOString(),
      source: "local-production-dist-with-isolated-static-fixtures",
      buildFingerprint: {
        indexSha256: createHash("sha256").update(distIndex).digest("hex"),
        indexBytes: distIndex.byteLength,
        indexModifiedAt: distIndexStat.mtime.toISOString(),
        entryAssets: distEntryAssets,
      },
      operationalAccess: { productionApi: false, realPayment: false, adb: false },
      viewport: BROWSER_QA_VIEWPORT,
      routes: { parent: [], child: [] },
      focused: {},
      problems: [],
      screenshots: [],
    };

    const onboarding = await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false },
      "onboarding",
    );
    const onboardingAntiSlopFacts = await cdp.evaluate(`(() => ({
      badgePresent: Boolean(document.querySelector(".ob-role-badge")),
      subtitle: document.querySelector(".ob-role-sub")?.textContent?.trim() || "",
    }))()`);
    if (
      onboardingAntiSlopFacts.badgePresent
      || onboardingAntiSlopFacts.subtitle !== "함께 보는 우리 가족 일정"
      || rowProblems(onboarding).length > 0
    ) {
      report.problems.push({
        scope: "onboarding-decorative-badge",
        facts: onboardingAntiSlopFacts,
        routeProblems: rowProblems(onboarding),
      });
    }
    report.focused.antiSlop = { onboarding: onboardingAntiSlopFacts };

    for (const route of PARENT_BROWSER_QA_ROUTES) {
      const row = await navigate({ role: "parent", tier: "free", catalogMode: "valid", overLimit: route === "place-manager" }, route);
      row.problems = rowProblems(row);
      report.routes.parent.push(row);
      if (row.problems.length > 0) report.problems.push({ scope: "parent-route", route, problems: row.problems });
      process.stdout.write(`${row.problems.length ? "FAIL" : "OK  "} parent ${route}\n`);
    }

    const inspectParentHomeShortcuts = () => cdp.evaluate(`(() => {
      const shortcutGrid = document.querySelector(".ph-shortcuts");
      const shortcutButtons = [...document.querySelectorAll(".ph-shortcut")];
      const subscription = document.querySelector(".ph-subscription");
      const subscriptionAction = subscription?.querySelector(".ph-subscription__action");
      const memo = document.querySelector(".ph-memo");
      const shortcutRect = shortcutGrid?.getBoundingClientRect();
      const subscriptionRect = subscription?.getBoundingClientRect();
      const subscriptionActionRect = subscriptionAction?.getBoundingClientRect();
      const memoRect = memo?.getBoundingClientRect();
      const subscriptionStyle = subscription ? getComputedStyle(subscription) : null;
      const rowCounts = Object.values(shortcutButtons.reduce((rows, button) => {
        const top = String(Math.round(button.getBoundingClientRect().top));
        rows[top] = (rows[top] || 0) + 1;
        return rows;
      }, {}));
      return {
        labels: shortcutButtons.map((button) => button.querySelector(".ph-shortcut__label")?.textContent?.trim() || ""),
        shortcutCount: shortcutButtons.length,
        columnCount: shortcutGrid ? getComputedStyle(shortcutGrid).gridTemplateColumns.split(" ").length : 0,
        rowCounts,
        subscriptionTitle: subscription?.querySelector(".ph-subscription__title")?.textContent?.trim() || "",
        subscriptionAction: subscriptionAction?.textContent?.trim() || "",
        subscriptionTone: subscription?.getAttribute("data-tone"),
        subscriptionTag: subscription?.tagName || null,
        subscriptionHeight: Math.round(subscriptionRect?.height || 0),
        subscriptionActionHeight: Math.round(subscriptionActionRect?.height || 0),
        subscriptionHasGradient: Boolean(subscriptionStyle?.backgroundImage.includes("gradient")),
        subscriptionActionInside: Boolean(
          subscriptionRect
          && subscriptionActionRect
          && subscriptionActionRect.left >= subscriptionRect.left
          && subscriptionActionRect.right <= subscriptionRect.right
        ),
        isSubscriptionBelowGrid: Boolean(shortcutRect && subscriptionRect && subscriptionRect.top >= shortcutRect.bottom),
        alignsWithMemo: Boolean(subscriptionRect && memoRect && Math.abs(subscriptionRect.width - memoRect.width) <= 2),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    const expectedParentHomeShortcuts = [
      "AI 일정", "위치추적", "친구놀이", "장소관리",
      "주변소리", "안심리포트", "아이 기기 찾기", "알림",
    ];

    const parentHomeFree = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false },
      "parent/home",
    );
    const parentHomeFreeFacts = await inspectParentHomeShortcuts();
    if (
      JSON.stringify(parentHomeFreeFacts.labels) !== JSON.stringify(expectedParentHomeShortcuts)
      || parentHomeFreeFacts.shortcutCount !== 8
      || parentHomeFreeFacts.columnCount !== 4
      || JSON.stringify(parentHomeFreeFacts.rowCounts) !== JSON.stringify([4, 4])
      || parentHomeFreeFacts.subscriptionTitle !== "구독 시 혜택"
      || parentHomeFreeFacts.subscriptionAction !== "혜택 보기"
      || parentHomeFreeFacts.subscriptionTone !== "benefits"
      || parentHomeFreeFacts.subscriptionTag !== "BUTTON"
      || parentHomeFreeFacts.subscriptionHeight < 100
      || parentHomeFreeFacts.subscriptionActionHeight < 36
      || !parentHomeFreeFacts.subscriptionHasGradient
      || !parentHomeFreeFacts.subscriptionActionInside
      || !parentHomeFreeFacts.isSubscriptionBelowGrid
      || !parentHomeFreeFacts.alignsWithMemo
      || parentHomeFreeFacts.overflowX > 0
      || rowProblems(parentHomeFree).length > 0
    ) {
      report.problems.push({
        scope: "parent-home-shortcuts-free",
        facts: parentHomeFreeFacts,
        routeProblems: rowProblems(parentHomeFree),
      });
    }
    await cdp.evaluate(`(() => {
      document.querySelector(".ph-shortcuts")?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -96);
      return true;
    })()`);
    await wait(250);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-home-shortcuts-free.png"));

    await cdp.evaluate(`(() => {
      const target = [...document.querySelectorAll(".ph-shortcut")]
        .find((button) => button.textContent?.includes("아이 기기 찾기"));
      if (!(target instanceof HTMLButtonElement)) return false;
      target.click();
      return true;
    })()`);
    await wait(3_200);
    const deviceFinderFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      routedChildUserId: history.state?.usr?.childUserId ?? null,
      targetReady: document.querySelector(".rr-cta") instanceof HTMLButtonElement
        && !document.querySelector(".rr-cta").disabled,
      hasTargetQuestion: Boolean(document.querySelector(".rr-title")?.textContent?.includes("기기에서 벨을 울릴까요?")),
      confirmationOpen: Boolean(document.querySelector(".rr-modal")),
      ringing: Boolean(document.querySelector(".rr-ring")),
    }))()`);
    if (
      deviceFinderFacts.hash !== "#/remote-ring"
      || deviceFinderFacts.routedChildUserId !== CHILD_ID
      || !deviceFinderFacts.targetReady
      || !deviceFinderFacts.hasTargetQuestion
      || deviceFinderFacts.confirmationOpen
      || deviceFinderFacts.ringing
    ) {
      report.problems.push({ scope: "parent-home-device-finder-entry", facts: deviceFinderFacts });
    }

    const parentHomePremium = await navigate(
      { role: "parent", tier: "premium", catalogMode: "valid", overLimit: false },
      "parent/home",
    );
    const parentHomePremiumFacts = await inspectParentHomeShortcuts();
    if (
      parentHomePremiumFacts.subscriptionTitle !== "구독 관리"
      || parentHomePremiumFacts.subscriptionAction !== "관리하기"
      || parentHomePremiumFacts.subscriptionTone !== "manage"
      || parentHomePremiumFacts.subscriptionTag !== "BUTTON"
      || parentHomePremiumFacts.subscriptionHeight < 100
      || parentHomePremiumFacts.subscriptionActionHeight < 36
      || !parentHomePremiumFacts.subscriptionHasGradient
      || !parentHomePremiumFacts.subscriptionActionInside
      || !parentHomePremiumFacts.isSubscriptionBelowGrid
      || !parentHomePremiumFacts.alignsWithMemo
      || parentHomePremiumFacts.overflowX > 0
      || rowProblems(parentHomePremium).length > 0
    ) {
      report.problems.push({
        scope: "parent-home-shortcuts-premium",
        facts: parentHomePremiumFacts,
        routeProblems: rowProblems(parentHomePremium),
      });
    }
    report.focused.parentHomeShortcuts = {
      free: parentHomeFreeFacts,
      premium: parentHomePremiumFacts,
      deviceFinderEntry: deviceFinderFacts,
    };
    await cdp.evaluate(`(() => {
      document.querySelector(".ph-shortcuts")?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -96);
      return true;
    })()`);
    await wait(250);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-home-shortcuts-premium.png"));

    const locationHistory = await navigate(
      { role: "parent", tier: "premium", catalogMode: "valid", overLimit: false },
      "parent/location?view=history",
    );
    const locationHistoryFacts = await cdp.evaluate(`(() => {
      const panel = document.querySelector(".pl-journey");
      const toggle = document.querySelector(".pl-journey__toggle");
      const stays = [...document.querySelectorAll(".pl-journey__stay")];
      const text = (panel?.innerText || "").replace(/\\s+/g, " ").trim();
      const eyebrow = document.querySelector(".pl-journey__eyebrow")?.textContent?.trim() || "";
      const selectedTime = document.querySelector(".pl-journey__replay-head strong")?.textContent?.trim() || "";
      const recordedRange = document.querySelector(".pl-journey__range-label")?.textContent?.trim() || "";
      const recordedStart = recordedRange.split("–").at(0)?.trim() || "";
      const recordedEnd = recordedRange.split("–").at(-1)?.trim() || "";
      const range = document.querySelector(".pl-journey__range");
      // 화면 라벨은 앱과 같은 locale 시각 포맷(오후 6:46)이라 24시간 문자열로 비교하면 절대 일치하지 않는다.
      // 앱이 쓰는 formatDateTime(timeStyle:"short", Asia/Seoul)과 같은 방식으로 맞춘다.
      const rangeClockFormat = new Intl.DateTimeFormat("ko-KR", { timeStyle: "short", timeZone: "Asia/Seoul" });
      const formatRangeClock = (value) => {
        const date = new Date(Number(value));
        if (Number.isNaN(date.getTime())) return "";
        return rangeClockFormat.format(date);
      };
      const sliderStart = range instanceof HTMLInputElement ? formatRangeClock(range.min) : "";
      const sliderEnd = range instanceof HTMLInputElement ? formatRangeClock(range.max) : "";
      return {
        hash: location.hash,
        panelVisible: Boolean(panel),
        expanded: toggle?.getAttribute("aria-expanded"),
        stayCount: stays.length,
        stayTexts: stays.map((stay) => (stay.textContent || "").replace(/\\s+/g, " ").trim()),
        hasToolbar: Boolean(document.querySelector(".pl-history-toolbar")),
        hasReplay: Boolean(document.querySelector(".pl-journey__replay")),
        eyebrow,
        selectedTime,
        recordedRange,
        sliderStart,
        sliderEnd,
        sliderBoundsAligned: Boolean(
          recordedStart
          && recordedEnd
          && sliderStart === recordedStart
          && sliderEnd === recordedEnd
        ),
        latestAligned: Boolean(selectedTime && selectedTime === recordedEnd),
        text,
      };
    })()`);
    if (
      locationHistoryFacts.hash !== "#/parent/location?view=history"
      || !locationHistoryFacts.panelVisible
      || locationHistoryFacts.expanded !== "true"
      || locationHistoryFacts.stayCount !== 2
      || !locationHistoryFacts.hasToolbar
      || !locationHistoryFacts.hasReplay
      || locationHistoryFacts.eyebrow !== "최신 기록"
      || !locationHistoryFacts.latestAligned
      || !locationHistoryFacts.sliderBoundsAligned
      || !locationHistoryFacts.text.includes("머문 곳")
      || !locationHistoryFacts.stayTexts.some((text) => text.includes("우리 집"))
      || !locationHistoryFacts.stayTexts.some((text) => text.includes("데모 학교"))
      || rowProblems(locationHistory).length > 0
    ) {
      report.problems.push({
        scope: "parent-location-history",
        facts: locationHistoryFacts,
        routeProblems: rowProblems(locationHistory),
      });
    }
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-location-history.png"));

    await clickSelector(cdp, ".pl-journey__toggle");
    await wait(360);
    const locationHistoryCollapsed = await cdp.evaluate(`(() => {
      const range = document.querySelector(".pl-journey__range");
      const stays = document.querySelector("#location-journey-stays");
      const rect = range?.getBoundingClientRect();
      return {
        expanded: document.querySelector(".pl-journey__toggle")?.getAttribute("aria-expanded"),
        staysHidden: Boolean(stays?.hidden),
        replayVisible: Boolean(rect && rect.width > 0 && rect.height >= 44),
      };
    })()`);
    await clickSelector(cdp, ".pl-journey__toggle");
    await wait(360);
    const locationHistoryReplay = await cdp.evaluate(`(() => {
      const range = document.querySelector(".pl-journey__range");
      if (!(range instanceof HTMLInputElement)) return { moved: false, followsLatest: null };
      const nextValue = String(Math.max(Number(range.min), Number(range.max) - 90 * 60_000));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(range, nextValue);
      range.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        moved: range.value === nextValue,
        followsLatest: document.querySelector(".pl-journey__follow")?.getAttribute("aria-pressed"),
      };
    })()`);
    // 160ms 지도 포커스 debounce 뒤 React 렌더와 Kakao overlay 재생성까지 기다린다.
    await wait(360);
    const locationHistoryAfterReplay = await cdp.evaluate(`(() => {
      const selectedTime = document.querySelector(".pl-journey__replay-head strong")?.textContent?.trim() || null;
      const panCalls = Array.isArray(window.__hyQaMapPanCalls) ? window.__hyQaMapPanCalls : [];
      const markerBadge = (Array.isArray(window.__hyQaOverlayContents) ? window.__hyQaOverlayContents : [])
        .map((content) => content?.querySelector?.(".km-child-marker__time")?.textContent?.trim() || null)
        .find(Boolean) || null;
      const range = document.querySelector(".pl-journey__range");
      const rangeRect = range?.getBoundingClientRect();
      return {
        expanded: document.querySelector(".pl-journey__toggle")?.getAttribute("aria-expanded"),
        staysHidden: Boolean(document.querySelector("#location-journey-stays")?.hidden),
        replayVisible: Boolean(rangeRect && rangeRect.width > 0 && rangeRect.height >= 44),
        rangeEnabled: range instanceof HTMLInputElement && !range.disabled,
        followsLatest: document.querySelector(".pl-journey__follow")?.getAttribute("aria-pressed"),
        selectedStayCount: document.querySelectorAll(".pl-journey__stay--selected").length,
        selectedTime,
        markerBadge,
        lastPan: panCalls.at(-1) || null,
      };
    })()`);
    const locationHistorySecondReplay = await cdp.evaluate(`(() => {
      const range = document.querySelector(".pl-journey__range");
      if (!(range instanceof HTMLInputElement)) return { moved: false };
      const nextValue = String(Math.max(Number(range.min), Number(range.max) - 20 * 60_000));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(range, nextValue);
      range.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
      return { moved: range.value === nextValue };
    })()`);
    await wait(360);
    const locationHistoryAfterSecondReplay = await cdp.evaluate(`(() => {
      const selectedTime = document.querySelector(".pl-journey__replay-head strong")?.textContent?.trim() || null;
      const markerBadge = (Array.isArray(window.__hyQaOverlayContents) ? window.__hyQaOverlayContents : [])
        .map((content) => content?.querySelector?.(".km-child-marker__time")?.textContent?.trim() || null)
        .find(Boolean) || null;
      return {
        selectedTime,
        markerBadge,
        selectedStayCount: document.querySelectorAll(".pl-journey__stay--selected").length,
      };
    })()`);
    const rapidPanCountBefore = await cdp.evaluate(`Array.isArray(window.__hyQaMapPanCalls) ? window.__hyQaMapPanCalls.length : 0`);
    let rapidMoved = true;
    for (const delta of [75, 65, 55, 45, 35]) {
      const moved = await cdp.evaluate(`(() => {
        const range = document.querySelector(".pl-journey__range");
        if (!(range instanceof HTMLInputElement)) return false;
        const value = Math.max(Number(range.min), Number(range.max) - ${delta} * 60_000);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(range, String(value));
        range.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        range.dispatchEvent(new Event("change", { bubbles: true }));
        return range.value === String(value);
      })()`);
      rapidMoved &&= moved;
      await wait(25);
    }
    await wait(360);
    const rapidReplayFacts = await cdp.evaluate(`(() => {
      const panCount = (Array.isArray(window.__hyQaMapPanCalls) ? window.__hyQaMapPanCalls.length : 0) - ${rapidPanCountBefore};
      const selectedTime = document.querySelector(".pl-journey__replay-head strong")?.textContent?.trim() || null;
      const markerBadge = (Array.isArray(window.__hyQaOverlayContents) ? window.__hyQaOverlayContents : [])
        .map((content) => content?.querySelector?.(".km-child-marker__time")?.textContent?.trim() || null)
        .find(Boolean) || null;
      return { panCount, selectedTime, markerBadge };
    })()`);
    const locationHistoryRapidReplay = { moved: rapidMoved, ...rapidReplayFacts };
    await clickSelector(cdp, ".pl-journey__follow");
    await wait(200);
    const locationHistoryLatest = await cdp.evaluate(`(() => ({
      followsLatest: document.querySelector(".pl-journey__follow")?.getAttribute("aria-pressed"),
      markerBadge: (Array.isArray(window.__hyQaOverlayContents) ? window.__hyQaOverlayContents : [])
        .map((content) => content?.querySelector?.(".km-child-marker__time")?.textContent?.trim() || null)
        .find(Boolean) || null,
    }))()`);
    if (
      locationHistoryCollapsed.expanded !== "false"
      || !locationHistoryCollapsed.staysHidden
      || !locationHistoryCollapsed.replayVisible
      || !locationHistoryReplay.moved
      || locationHistoryAfterReplay.expanded !== "true"
      || locationHistoryAfterReplay.staysHidden
      || !locationHistoryAfterReplay.replayVisible
      || !locationHistoryAfterReplay.rangeEnabled
      || locationHistoryAfterReplay.followsLatest !== "false"
      || locationHistoryAfterReplay.selectedStayCount !== 1
      || !locationHistoryAfterReplay.selectedTime
      || locationHistoryAfterReplay.markerBadge !== locationHistoryAfterReplay.selectedTime
      || !(locationHistoryAfterReplay.lastPan?.y > 0)
      || !locationHistorySecondReplay.moved
      || !locationHistoryAfterSecondReplay.selectedTime
      || locationHistoryAfterSecondReplay.selectedTime === locationHistoryAfterReplay.selectedTime
      || locationHistoryAfterSecondReplay.markerBadge !== locationHistoryAfterSecondReplay.selectedTime
      || locationHistoryAfterSecondReplay.selectedStayCount !== 1
      || !locationHistoryRapidReplay.moved
      || !(locationHistoryRapidReplay.panCount <= 1)
      || !locationHistoryRapidReplay.selectedTime
      || locationHistoryRapidReplay.markerBadge !== locationHistoryRapidReplay.selectedTime
      || locationHistoryLatest.followsLatest !== "true"
      || locationHistoryLatest.markerBadge !== null
    ) {
      report.problems.push({
        scope: "parent-location-history-interaction",
        facts: {
          collapsed: locationHistoryCollapsed,
          replay: locationHistoryReplay,
          afterReplay: locationHistoryAfterReplay,
          secondReplay: locationHistorySecondReplay,
          afterSecondReplay: locationHistoryAfterSecondReplay,
          rapidReplay: locationHistoryRapidReplay,
          latest: locationHistoryLatest,
        },
      });
    }
    report.focused.parentLocationHistory = {
      ...locationHistoryFacts,
      collapsed: locationHistoryCollapsed,
      replay: locationHistoryReplay,
      afterReplay: locationHistoryAfterReplay,
      secondReplay: locationHistorySecondReplay,
      afterSecondReplay: locationHistoryAfterSecondReplay,
      rapidReplay: locationHistoryRapidReplay,
      latest: locationHistoryLatest,
    };

    for (const route of CHILD_BROWSER_QA_ROUTES) {
      const row = await navigate({ role: "child", tier: "free", catalogMode: "valid", overLimit: false }, route);
      row.problems = rowProblems(row);
      report.routes.child.push(row);
      if (row.problems.length > 0) report.problems.push({ scope: "child-route", route, problems: row.problems });
      process.stdout.write(`${row.problems.length ? "FAIL" : "OK  "} child  ${route}\n`);
    }

    const aiFriend = await navigate(
      { role: "child", tier: "free", catalogMode: "valid", overLimit: false },
      "child/ai-friend",
    );
    const aiFriendAntiSlopFacts = await cdp.evaluate(`(() => ({
      decorativeStatusPresent: Boolean(document.querySelector(".afc-head-status")),
      decorativeOnlineDotPresent: Boolean(document.querySelector(".afc-online")),
    }))()`);
    if (
      aiFriendAntiSlopFacts.decorativeStatusPresent
      || aiFriendAntiSlopFacts.decorativeOnlineDotPresent
      || rowProblems(aiFriend).length > 0
    ) {
      report.problems.push({
        scope: "ai-friend-decorative-status",
        facts: aiFriendAntiSlopFacts,
        routeProblems: rowProblems(aiFriend),
      });
    }
    report.focused.antiSlop.aiFriend = aiFriendAntiSlopFacts;

    const parentSettings = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false },
      "parent/settings",
    );
    const parentSettingsAntiSlopFacts = await cdp.evaluate(`(() => ({
      versionText: document.querySelector(".ps-version")?.textContent?.trim() || "",
    }))()`);
    if (
      !/^혜니캘린더 v\S+$/.test(parentSettingsAntiSlopFacts.versionText)
      || rowProblems(parentSettings).length > 0
    ) {
      report.problems.push({
        scope: "settings-decorative-tagline",
        facts: parentSettingsAntiSlopFacts,
        routeProblems: rowProblems(parentSettings),
      });
    }
    report.focused.antiSlop.parentSettings = parentSettingsAntiSlopFacts;

    const subscription = await navigate({ role: "parent", tier: "free", catalogMode: "valid", overLimit: false }, "subscription");
    const subscriptionFacts = await cdp.evaluate(`(() => {
      const body = (document.body.innerText || "").replace(/\\s+/g, " ").trim();
      const table = document.querySelector(".sub-table");
      const cta = document.querySelector(".sub-cta");
      const aiScheduleRow = [...(table?.querySelectorAll("tbody tr") || [])]
        .find((row) => row.querySelector("th")?.textContent?.trim() === "AI 일정 정리");
      return {
        hasFree: Boolean(table && /무료/.test(table.innerText)),
        hasPremium: Boolean(table && /프리미엄/.test(table.innerText)),
        monthlyPriceCount: (body.match(/월 4,900원/g) || []).length,
        annualPriceCount: (body.match(/연 39,000원/g) || []).length,
        hasChildDifference: body.includes("새 아이 연결 상한") && body.includes("1명") && body.includes("2명"),
        aiScheduleCells: aiScheduleRow
          ? [...aiScheduleRow.querySelectorAll("td")].map((cell) => cell.textContent?.trim() || "")
          : [],
        hasSafetyFreeCopy: body.includes("SOS와 긴급 안전 알림은 무료로 계속 제공돼요"),
        hasDowngradeCopy: body.includes("이미 연결된 아이는 구독이 끝나도 자동으로 해제하거나 숨기지 않아요"),
        ctaDisabled: Boolean(cta?.disabled),
        compareText: (table?.innerText || "").replace(/\\s+/g, " ").trim(),
      };
    })()`);
    if (!subscriptionFacts.hasFree || !subscriptionFacts.hasPremium || subscriptionFacts.monthlyPriceCount < 2 || subscriptionFacts.annualPriceCount < 1 || !subscriptionFacts.hasChildDifference || JSON.stringify(subscriptionFacts.aiScheduleCells) !== JSON.stringify(["하루 5회", "제한 없음"]) || !subscriptionFacts.hasSafetyFreeCopy || !subscriptionFacts.hasDowngradeCopy || subscriptionFacts.ctaDisabled) {
      report.problems.push({ scope: "subscription-pricing", facts: subscriptionFacts });
    }
    report.focused.subscriptionPricing = { ...subscriptionFacts, routeState: subscription.state };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "subscription-pricing-top.png"));
    await cdp.evaluate("document.querySelector('.sub-compare')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -112); true");
    await wait(250);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "subscription-comparison.png"));

    const aiScheduleQuota = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, aiScheduleExhausted: true },
      "ai-schedule?tab=text",
    );
    await cdp.evaluate(`(() => {
      const input = document.querySelector(".ais-textarea");
      if (!(input instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, "내일 오후 4시 태권도");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "내일 오후 4시 태권도" }));
      return true;
    })()`);
    await wait(200);
    await clickSelector(cdp, ".ais-confirm");
    await wait(900);
    const aiScheduleQuotaFacts = await cdp.evaluate(`(() => {
      const layer = document.querySelector('[data-upsell-source="ai_schedule_limit"]');
      const dialog = layer?.querySelector(".pu-dialog");
      const body = (document.body.innerText || "").replace(/\\s+/g, " ").trim();
      const text = (dialog?.innerText || "").replace(/\\s+/g, " ").trim();
      return {
        open: Boolean(dialog),
        text,
        hasUsage: text.includes("5/5 사용"),
        hasFreeAlternative: text.includes("직접 일정 추가와 기존 일정 관리는 무료에서도 제한 없이"),
        hasPremiumDifference: text.includes("AI 일정 정리를 하루 횟수 제한 없이"),
        hasContinue: text.includes("무료 플랜으로 계속 사용하기"),
        hasUpgrade: text.includes("AI 일정 정리 제한 없애기"),
        duplicateToastPresent: Boolean(document.querySelector(".hy-toast")),
        leakedRawError: body.includes("daily_limit_reached"),
      };
    })()`);
    const aiScheduleExpected429 = networkFailures.some((value) => value.includes("429") && value.includes("/api/ai/voice-parse"));
    if (!aiScheduleQuotaFacts.open || !aiScheduleQuotaFacts.hasUsage || !aiScheduleQuotaFacts.hasFreeAlternative || !aiScheduleQuotaFacts.hasPremiumDifference || !aiScheduleQuotaFacts.hasContinue || !aiScheduleQuotaFacts.hasUpgrade || aiScheduleQuotaFacts.duplicateToastPresent || aiScheduleQuotaFacts.leakedRawError || !aiScheduleExpected429 || rowProblems(aiScheduleQuota).length > 0) {
      report.problems.push({ scope: "ai-schedule-quota-upsell", facts: { ...aiScheduleQuotaFacts, expected429: aiScheduleExpected429 }, routeProblems: rowProblems(aiScheduleQuota) });
    }
    report.focused.aiScheduleQuotaUpsell = { ...aiScheduleQuotaFacts, expected429: aiScheduleExpected429, routeState: aiScheduleQuota.state };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "ai-schedule-quota-upsell.png"));

    await clickSelector(cdp, ".pu-upgrade");
    await wait(900);
    const aiScheduleIntentFacts = await cdp.evaluate(`(() => {
      const raw = sessionStorage.getItem("hyeni:premium-return-intent:v1");
      const intent = raw ? JSON.parse(raw) : null;
      return { hash: location.hash, source: intent?.source ?? null, feature: intent?.feature ?? null, returnTo: intent?.returnTo ?? null };
    })()`);
    if (aiScheduleIntentFacts.hash !== "#/subscription" || aiScheduleIntentFacts.source !== "ai_schedule_limit" || aiScheduleIntentFacts.feature !== "ai_schedule_daily_limit" || aiScheduleIntentFacts.returnTo !== "/ai-schedule?tab=text") {
      report.problems.push({ scope: "ai-schedule-quota-upgrade-intent", facts: aiScheduleIntentFacts });
    }
    report.focused.aiScheduleQuotaUpsell.intent = aiScheduleIntentFacts;

    await cdp.evaluate('sessionStorage.removeItem("hyeni:premium-return-intent:v1"); true');
    const aiScheduleContinueScenario = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, aiScheduleExhausted: true },
      "ai-schedule?tab=text",
    );
    await cdp.evaluate(`(() => {
      const input = document.querySelector(".ais-textarea");
      if (!(input instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, "내일 오후 4시 태권도");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "내일 오후 4시 태권도" }));
      return true;
    })()`);
    await wait(200);
    await clickSelector(cdp, ".ais-confirm");
    await wait(900);
    const aiScheduleContinueDialogOpen = await cdp.evaluate("Boolean(document.querySelector('[data-upsell-source=\"ai_schedule_limit\"] .pu-dialog'))");
    if (aiScheduleContinueDialogOpen) await clickSelector(cdp, ".pu-continue");
    await wait(200);
    const aiScheduleContinuedFree = await cdp.evaluate("({ hash: location.hash, dialogOpen: Boolean(document.querySelector('.pu-dialog')) })");
    const aiScheduleContinueExpected429 = networkFailures.some((value) => value.includes("429") && value.includes("/api/ai/voice-parse"));
    if (!aiScheduleContinueDialogOpen || aiScheduleContinuedFree.hash !== "#/ai-schedule?tab=text" || aiScheduleContinuedFree.dialogOpen || !aiScheduleContinueExpected429 || rowProblems(aiScheduleContinueScenario).length > 0) {
      report.problems.push({ scope: "ai-schedule-quota-continue-free", facts: { ...aiScheduleContinuedFree, opened: aiScheduleContinueDialogOpen, expected429: aiScheduleContinueExpected429 }, routeProblems: rowProblems(aiScheduleContinueScenario) });
    }
    report.focused.aiScheduleQuotaUpsell.continuedFree = { ...aiScheduleContinuedFree, opened: aiScheduleContinueDialogOpen, expected429: aiScheduleContinueExpected429, routeState: aiScheduleContinueScenario.state };

    const failClosed = await navigate({ role: "parent", tier: "free", catalogMode: "invalid", overLimit: false }, "subscription");
    const failClosedFacts = await cdp.evaluate(`(() => {
      const status = document.querySelector(".sub-web-unavailable");
      const cta = document.querySelector(".sub-cta");
      return {
        statusText: (status?.textContent || "").replace(/\\s+/g, " ").trim(),
        ctaDisabled: Boolean(cta?.disabled),
        showsGuessedLaunchPrice: /월 4,900원|연 39,000원/.test((document.body.innerText || "")),
        showsPreparingPrice: (document.body.innerText || "").includes("웹 결제 준비 중"),
      };
    })()`);
    if (!failClosedFacts.statusText.includes("결제 시작을 잠시 닫았어요") || !failClosedFacts.statusText.includes("무료 기능은 그대로") || !failClosedFacts.ctaDisabled || failClosedFacts.showsGuessedLaunchPrice || !failClosedFacts.showsPreparingPrice || rowProblems(failClosed).length > 0) {
      report.problems.push({ scope: "web-billing-fail-closed", facts: failClosedFacts, routeProblems: rowProblems(failClosed) });
    }
    report.focused.webBillingFailClosed = { ...failClosedFacts, routeState: failClosed.state };
    await cdp.evaluate("document.querySelector('.sub-web-unavailable')?.scrollIntoView({ block: 'center' }); true");
    await wait(200);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "subscription-web-fail-closed.png"));

    const place = await navigate({ role: "parent", tier: "free", catalogMode: "valid", overLimit: true }, "place-manager");
    await cdp.evaluate("document.querySelector('.pm-list')?.scrollIntoView({ block: 'start' }); true");
    await wait(200);
    const placeFacts = await cdp.evaluate(`(() => ({
      activeCount: [...document.querySelectorAll(".pm-alert-state")].filter((node) => node.textContent.includes("플랜 한도 안 · 알림 설정 가능")).length,
      premiumRequiredCount: [...document.querySelectorAll(".pm-alert-state")].filter((node) => node.textContent.includes("저장됨 · 프리미엄에서 알림 대상")).length,
      unknownCount: [...document.querySelectorAll(".pm-alert-state")].filter((node) => node.textContent.includes("확인 필요")).length,
    }))()`);
    if (placeFacts.activeCount !== 3 || placeFacts.premiumRequiredCount !== 2 || placeFacts.unknownCount !== 0 || rowProblems(place).length > 0) {
      report.problems.push({ scope: "tier-alert-state", facts: placeFacts, routeProblems: rowProblems(place) });
    }
    report.focused.tierAlertState = placeFacts;
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "place-manager-tier-alert-state.png"));

    await cdp.evaluate("scrollTo({ top: 0, behavior: 'instant' }); true");
    await wait(150);
    await clickSelector(cdp, ".pm-add");
    await wait(350);
    const upsellFacts = await cdp.evaluate(`(() => {
      const dialog = document.querySelector(".pu-dialog");
      const text = (dialog?.innerText || "").replace(/\\s+/g, " ").trim();
      return {
        open: Boolean(dialog),
        text,
        // 현재 정책은 "저장은 남고 알림 대상만 제한" 이다(2026-08-01 결정) — 정확한 수치를 보여주는지 본다.
        hasExactLimit: text.includes("무료 알림 대상 2개를 모두 사용했어요") && text.includes("알림 2/2") && text.includes("저장 3개"),
        hasContinue: text.includes("무료 플랜으로 계속 사용하기"),
        hasUpgrade: text.includes("장소 계속 추가하기"),
      };
    })()`);
    if (!upsellFacts.open || !upsellFacts.hasExactLimit || !upsellFacts.hasContinue || !upsellFacts.hasUpgrade) {
      report.problems.push({ scope: "saved-place-upsell", facts: upsellFacts });
    }
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "place-manager-upsell.png"));
    await clickSelector(cdp, ".pu-continue");
    await wait(250);
    const continuedFree = await cdp.evaluate("({ hash: location.hash, dialogOpen: Boolean(document.querySelector('.pu-dialog')) })");
    if (continuedFree.hash !== "#/place-manager" || continuedFree.dialogOpen) report.problems.push({ scope: "continue-free", facts: continuedFree });

    await clickSelector(cdp, ".pm-add");
    await wait(250);
    await clickSelector(cdp, ".pu-upgrade");
    await wait(900);
    const intentFacts = await cdp.evaluate(`(() => {
      const raw = sessionStorage.getItem("hyeni:premium-return-intent:v1");
      const intent = raw ? JSON.parse(raw) : null;
      return { hash: location.hash, source: intent?.source ?? null, feature: intent?.feature ?? null, returnTo: intent?.returnTo ?? null };
    })()`);
    if (intentFacts.hash !== "#/subscription" || intentFacts.source !== "saved_place" || intentFacts.feature !== "saved_places" || intentFacts.returnTo !== "/place-form") {
      report.problems.push({ scope: "premium-return-intent-save", facts: intentFacts });
    }
    activeScenario = { role: "parent", tier: "premium", catalogMode: "valid", overLimit: true };
    consoleMessages = [];
    networkFailures = [];
    await cdp.send("Page.reload", { ignoreCache: true });
    await wait(3_200);
    const returnedFacts = await cdp.evaluate(`({ hash: location.hash, intentCleared: sessionStorage.getItem("hyeni:premium-return-intent:v1") === null })`);
    if (returnedFacts.hash !== "#/place-form" || !returnedFacts.intentCleared) report.problems.push({ scope: "premium-return-intent-restore", facts: returnedFacts });
    report.focused.savedPlaceUpsell = { ...upsellFacts, continuedFree, intent: intentFacts, returned: returnedFacts };

    const teacher = await navigate({ role: "teacher", tier: "free", catalogMode: "valid", overLimit: false }, "teacher/home");
    const teacherFacts = await cdp.evaluate(`(() => {
      const text = (document.body.innerText || "").replace(/\\s+/g, " ").trim();
      return {
        hash: location.hash,
        hasVersion: text.includes("혜니캘린더 v1.3.0"),
        gated: text.includes("선생님 모드는 준비 중이에요"),
        hasExitControls: text.includes("로그아웃하고 다른 계정으로 시작") && text.includes("회원 탈퇴"),
      };
    })()`);
    if (!teacherFacts.hasVersion || !teacherFacts.gated || !teacherFacts.hasExitControls || rowProblems(teacher).length > 0) {
      report.problems.push({ scope: "teacher-production-gate", facts: teacherFacts, routeProblems: rowProblems(teacher) });
    }
    report.focused.teacherProductionGate = { ...teacherFacts, routeState: teacher.state };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "teacher-production-gate.png"));

    await navigate({ role: "parent", tier: "free", catalogMode: "valid", overLimit: false }, "parent/home");
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-home.png"));
    await navigate({ role: "child", tier: "free", catalogMode: "valid", overLimit: false }, "child/home");
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "child-home.png"));

    const reportPath = resolve(freshOutputDir, "report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (report.problems.length > 0) {
      throw new Error(`최종 브라우저 QA 실패 ${report.problems.length}건 — ${reportPath}`);
    }
    return { reportPath, report };
  } catch (error) {
    if (interruptedSignal) {
      const interruptedError = new Error(`최종 브라우저 QA가 ${interruptedSignal} 신호로 중단되었습니다`);
      interruptedError.code = "QA_INTERRUPTED";
      throw interruptedError;
    }
    throw error;
  } finally {
    removeSignalHandlers();
    await cleanup();
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    const outputDir = resolveBrowserQaOutputDir();
    const { reportPath, report } = await runFinalBrowserQa({ outputDir });
    process.stdout.write(`브라우저 QA 완료: 부모 ${report.routes.parent.length}화면 · 아이 ${report.routes.child.length}화면 · 문제 0건\n${reportPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error?.code === "QA_INTERRUPTED" ? 130 : 1;
  }
}
