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
import { chromium } from "@playwright/test";
import {
  prepareFreshQaOutputDir,
  resolveQaOutputDir,
} from "./lib/qaArtifactOutput.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = resolve(ROOT_DIR, "dist/index.html");
const VITE_BIN = resolve(ROOT_DIR, "node_modules/vite/bin/vite.js");
const PACKAGE_VERSION = JSON.parse(await readFile(resolve(ROOT_DIR, "package.json"), "utf8")).version;
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
const CO_PARENT_ID = "qa-co-parent";
const CHILD_ID = "qa-child";
const TEACHER_ID = "qa-teacher";
const PARENT_MEMBER_ID = "qa-parent-member";
const CO_PARENT_MEMBER_ID = "qa-co-parent-member";
const CHILD_MEMBER_ID = "qa-child-member";
const SECOND_CHILD_ID = "qa-child-2";
const SECOND_CHILD_MEMBER_ID = "qa-child-member-2";
const INACTIVE_GHOST_MEMBER_ID = "qa-child-ghost";
const STUDY_QA_TOKEN = "study-qa-token-abcdefghijklmnopqrstuvwxyz012345";
/** 서버가 저장하는 비공개 객체 키 모양 — 그대로 <img src> 에 넣으면 안 되는 값이다. */
const PARENT_PHOTO_KEY = `${FAMILY_ID}/uploads/${PARENT_ID}/qa-parent-profile.jpg`;
/** 1×1 PNG — 사진이 실제로 디코딩되는지(naturalWidth>0) 확인하기 위한 최소 바이트. */
const QA_PHOTO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const QA_REFERRAL_CODE = "HYENI-QA34567890ABCDEF";
let qaReferralCode = null;

function referralStatusFixture() {
  return {
    code: qaReferralCode,
    rewardChildUserId: qaReferralCode ? CHILD_ID : null,
    rewardCredits: 50,
    qualificationHours: 72,
    locationRetentionHours: 168,
    successfulCount: 0,
    pendingCount: 0,
    canManage: true,
  };
}
const HOME = Object.freeze({ lat: 37.3021, lng: 127.1043 });
const SCHOOL = Object.freeze({ lat: 37.2925, lng: 127.1191 });

export const PARENT_BROWSER_QA_ROUTES = Object.freeze([
  "parent/home", "parent/calendar", "parent/location", "parent/memo", "parent/settings",
  "parent/family", "subscription", "trial-lock", "study-management", "study-management/claim", "notifications", "remote-audio",
  "place-manager", "friend-play", "ai-schedule", "ai-credit", "phone-setup",
  "sticker-send", "profile-edit", "place-form", "child-invite", "event-form",
  "danger-zone-form", "location-status", "child-detail", "pairing-wizard",
  "family-connection", "location-settings", "account", "data-sync",
  "notification-settings", "arrival-alerts", "danger-alert", "day-summary",
  "daily-report", "weekly-report", "child-digest", "remote-audio-audit", "remote-ring",
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

function safeAccessToken(role, familyId = FAMILY_ID) {
  const userId = role === "child" ? CHILD_ID : role === "teacher" ? TEACHER_ID : PARENT_ID;
  const payload = {
    sub: userId,
    role,
    exp: Math.floor(Date.now() / 1000) + 3_600,
  };
  if (familyId) payload.family_id = familyId;
  return `${toBase64Url({ alg: "HS256", typ: "JWT" })}.${toBase64Url(payload)}.qa`;
}

function familyResponse(role, {
  coParentConnected = false,
  coParentViewer = false,
  studyFamilyMode = "one",
} = {}) {
  const myId = role === "child" ? CHILD_ID : role === "teacher" ? TEACHER_ID : PARENT_ID;
  return {
    familyId: FAMILY_ID,
    pairCode: "KID-QA123456",
    pairCodeExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    myRole: role,
    myName: role === "child" ? "데모 자녀" : role === "teacher" ? "데모 선생님" : "데모 보호자",
    parentName: "데모 보호자",
    primaryParentId: coParentViewer ? CO_PARENT_ID : PARENT_ID,
    isPrimaryParent: role === "parent" && !coParentViewer,
    isCoParent: role === "parent" && coParentViewer,
    members: [
      {
        id: PARENT_MEMBER_ID,
        user_id: PARENT_ID,
        role: "parent",
        name: "데모 보호자",
        phone: null,
        // 서버는 비공개 객체 키를 준다 — 화면이 이걸 표시용 URL로 바꾸는지 함께 본다.
        photo_url: PARENT_PHOTO_KEY,
        gender: "dad",
      },
      ...(coParentConnected || coParentViewer ? [{
        id: CO_PARENT_MEMBER_ID,
        user_id: CO_PARENT_ID,
        role: "parent",
        name: "연결된 보호자",
        phone: null,
        photo_url: null,
        gender: "mom",
      }] : []),
      ...(studyFamilyMode === "empty" ? [] : [{
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
      }]),
      ...(studyFamilyMode === "many" ? [
        {
          id: SECOND_CHILD_MEMBER_ID,
          user_id: SECOND_CHILD_ID,
          role: "child",
          name: "데모 둘째",
          phone: null,
          photo_url: null,
          child_order: 2,
          color_hex: "#8B6BEC",
          birthdate: "2017-05-04",
          gender: "female",
          is_active: true,
        },
        {
          id: INACTIVE_GHOST_MEMBER_ID,
          user_id: "qa-child-old",
          role: "child",
          name: "비활성 아이",
          phone: null,
          photo_url: null,
          child_order: 3,
          is_active: false,
        },
      ] : []),
    ],
    user: { id: myId },
  };
}

function studyChildrenFixture(scenario) {
  if (scenario.studyFamilyMode === "empty") return [];
  const linked = scenario.studyMode !== "unlinked";
  const canManageLinks = !scenario.coParentViewer;
  const children = [{
    memberId: CHILD_MEMBER_ID,
    displayName: "데모 자녀",
    photoAvailable: false,
    linked,
    grade: linked ? 4 : null,
    canManageLinks,
  }];
  if (scenario.studyFamilyMode === "many") {
    children.push({
      memberId: SECOND_CHILD_MEMBER_ID,
      displayName: "데모 둘째",
      photoAvailable: false,
      linked: true,
      grade: 5,
      canManageLinks,
    });
  }
  return children;
}

function studyReportFixture(memberId, scenario) {
  const child = studyChildrenFixture(scenario).find((entry) => entry.memberId === memberId);
  const linked = child?.linked === true;
  return {
    apiVersion: "2026-08-24",
    memberId,
    linked,
    grade: linked ? child.grade : null,
    range: "7d",
    todayProblemCount: memberId === SECOND_CHILD_MEMBER_ID ? 5 : 8,
    completedToday: true,
    lastStudiedAt: "2026-08-27T01:00:00.000Z",
    accuracy: memberId === SECOND_CHILD_MEMBER_ID ? 82 : 75,
    conceptMastery: linked ? [{ conceptId: "fraction", label: "분수", mastery: 80 }] : [],
    reviewDueCount: linked ? 1 : 0,
    recentSessions: linked ? [{
      sessionId: `qa-study-session-${memberId}`,
      startedAt: "2026-08-27T00:30:00.000Z",
      problemCount: memberId === SECOND_CHILD_MEMBER_ID ? 5 : 8,
      accuracy: memberId === SECOND_CHILD_MEMBER_ID ? 82 : 75,
    }] : [],
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

export function mockApi(pathname, scenario, method = "GET", requestBody = null) {
  const {
    role,
    tier,
    catalogMode = "valid",
    overLimit = false,
    aiScheduleExhausted = false,
  } = scenario;
  if (pathname === "/api/access-region") {
    return { country: scenario.country ?? "KR" };
  }
  if (pathname === "/auth/check-login-id") {
    return scenario.authCase === "id-check-error"
      ? { error: "temporary_unavailable" }
      : { available: true };
  }
  if (pathname === "/auth/refresh" && scenario.authCase === "device-inactive") {
    return { error: "device_session_inactive" };
  }
  if (pathname === "/auth/login-password" && scenario.authCase === "wrong-password") {
    return { error: "invalid_credentials" };
  }
  if (pathname === "/auth/login-password" && scenario.authCase === "success") {
    const sessionFamilyId = FAMILY_ID;
    const accessToken = safeAccessToken("parent");
    return {
      user: {
        id: PARENT_ID,
        role: "parent",
        family_id: sessionFamilyId,
        is_anonymous: false,
        app_metadata: { role: "parent", family_id: sessionFamilyId },
        user_metadata: { role: "parent", family_id: sessionFamilyId },
      },
      session: {
        access_token: accessToken,
        refresh_token: "qa-refresh-not-valid",
        token_type: "bearer",
        expires_in: 3_600,
      },
    };
  }
  // 가족 없는 부모 세션(no-family=신규, success-no-family=가족이 없어진 기존 계정) —
  // family_id 없는 세션을 돌려 온보딩 connect 단계로 유도한다.
  if (pathname === "/auth/login-password" && (scenario.authCase === "no-family" || scenario.authCase === "success-no-family")) {
    return {
      user: {
        id: PARENT_ID,
        role: "parent",
        family_id: null,
        is_anonymous: false,
        app_metadata: { role: "parent" },
        user_metadata: { role: "parent", name: "데모 보호자" },
      },
      session: {
        access_token: safeAccessToken("parent", null),
        refresh_token: "qa-refresh-not-valid",
        token_type: "bearer",
        expires_in: 3_600,
      },
    };
  }
  if (pathname === "/api/family/mine") {
    if (scenario.authCase === "device-inactive") return { error: "device_session_inactive" };
    // no-family 시나리오는 204(null) 응답으로 온보딩 connect 단계를 연다.
    if (scenario.authCase === "no-family") return null;
    return scenario.familyState === "none" ? null : familyResponse(role, scenario);
  }
  if (pathname === "/api/family/join-as-parent" && method === "POST") {
    scenario.familyState = "joined";
    scenario.lastJoinAsParentBody = requestBody;
    const accessToken = safeAccessToken("parent");
    return {
      family_id: FAMILY_ID,
      user: {
        id: PARENT_ID,
        role: "parent",
        family_id: FAMILY_ID,
        is_anonymous: false,
        app_metadata: { role: "parent", family_id: FAMILY_ID },
        user_metadata: { role: "parent", family_id: FAMILY_ID, name: "데모 보호자" },
      },
      session: {
        access_token: accessToken,
        refresh_token: "qa-refresh-after-family-join",
        token_type: "bearer",
        expires_in: 3_600,
      },
    };
  }
  if (pathname === "/api/study/status") {
    if (scenario.studyMode === "disabled") return { state: "disabled" };
    if (scenario.studyMode === "unavailable") {
      return { error: "study_unavailable", code: "study_unavailable" };
    }
    return { state: "ready" };
  }
  if (pathname === "/api/study/children") {
    return { children: studyChildrenFixture(scenario) };
  }
  const studyOverviewMatch = pathname.match(/^\/api\/study\/children\/([^/]+)\/overview$/);
  if (studyOverviewMatch) {
    const memberId = decodeURIComponent(studyOverviewMatch[1]);
    const child = studyChildrenFixture(scenario).find((entry) => entry.memberId === memberId);
    return {
      child: child
        ? { memberId: child.memberId, displayName: child.displayName, photoAvailable: child.photoAvailable }
        : { memberId, displayName: "아이", photoAvailable: false },
      overview: child ? {
        memberId,
        linked: child.linked,
        grade: child.grade,
        todayProblemCount: child.linked ? (memberId === SECOND_CHILD_MEMBER_ID ? 5 : 8) : 0,
        completedToday: child.linked,
        lastStudiedAt: child.linked ? "2026-08-27T01:00:00.000Z" : null,
      } : null,
      permissions: { canManageLinks: !scenario.coParentViewer },
    };
  }
  const studyReportMatch = pathname.match(/^\/api\/study\/children\/([^/]+)\/report$/);
  if (studyReportMatch) {
    const memberId = decodeURIComponent(studyReportMatch[1]);
    const child = studyChildrenFixture(scenario).find((entry) => entry.memberId === memberId);
    return {
      child: child
        ? { memberId: child.memberId, displayName: child.displayName, photoAvailable: child.photoAvailable }
        : { memberId, displayName: "아이", photoAvailable: false },
      report: studyReportFixture(memberId, scenario),
      permissions: { canManageLinks: !scenario.coParentViewer },
    };
  }
  const studyDevicesMatch = pathname.match(/^\/api\/study\/children\/([^/]+)\/devices$/);
  if (studyDevicesMatch && method === "GET") {
    return {
      devices: [{
        deviceSessionId: "qa-study-device-session",
        sessionKind: "paired",
        createdAt: "2026-08-20T01:00:00.000Z",
        lastUsedAt: "2026-08-27T01:00:00.000Z",
      }],
      permissions: { canManageLinks: !scenario.coParentViewer },
    };
  }
  const studyAttachMatch = pathname.match(/^\/api\/study\/children\/([^/]+)\/attach-challenges$/);
  if (studyAttachMatch && method === "POST") {
    scenario.studyMutationCalls ??= [];
    scenario.studyMutationCalls.push({ method, pathname, hasClaimToken: false });
    return {
      challenge: {
        apiVersion: "2026-08-24",
        purpose: "attach_child_device",
        qrUrl: "https://study.hyenicalendar.com/math/connect#qa-attach-token-abcdefghijklmnopqrstuvwxyz012345",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
      permissions: { canManageLinks: !scenario.coParentViewer },
    };
  }
  const studyClaimMatch = pathname.match(/^\/api\/study\/children\/([^/]+)\/claim$/);
  if (studyClaimMatch && method === "POST") {
    scenario.studyMutationCalls ??= [];
    scenario.studyMutationCalls.push({ method, pathname, hasClaimToken: Boolean(requestBody?.claimToken) });
    return {
      result: {
        apiVersion: "2026-08-24",
        requestId: "qa-study-claim-request",
        status: "merged",
        learnerState: "ready",
        preservedAttemptCount: 37,
      },
      permissions: { canManageLinks: !scenario.coParentViewer },
    };
  }
  const studyRevokeMatch = pathname.match(/^\/api\/study\/children\/([^/]+)\/devices\/([^/]+)$/);
  if (studyRevokeMatch && method === "DELETE") {
    scenario.studyMutationCalls ??= [];
    scenario.studyMutationCalls.push({ method, pathname, hasClaimToken: false });
    return {
      receipt: {
        apiVersion: "2026-08-24",
        requestId: "qa-study-revoke-request",
        status: "completed",
      },
      permissions: { canManageLinks: !scenario.coParentViewer },
    };
  }
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
  // 친구 초대 상태·발급은 서버 계약(rewardCredits·qualificationHours…)을 그대로 흉내 낸다.
  // 예전 fixture(shareUrl·successfulReferrals)는 클라 검증을 통과하지 못해 화면이 오류로 보였다.
  if (pathname === "/api/referrals/me") return referralStatusFixture();
  if (pathname === "/api/referrals/code") {
    if (method === "POST") qaReferralCode = QA_REFERRAL_CODE;
    return referralStatusFixture();
  }
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
    chromium.executablePath(),
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

export function newDocumentScript() {
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
        else if (role !== "preserve") localStorage.setItem("hyeni-api-session-v1", JSON.stringify(sessions[role] || sessions.parent));
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
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, disabled: element.matches(":disabled,[aria-disabled='true']") };
  })()`);
  if (!point || point.disabled) throw new Error(`클릭할 수 없는 요소입니다: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function setInputValue(cdp, selector, value) {
  const updated = await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      return {
        ok: false,
        tagName: input?.tagName ?? null,
        hash: location.hash,
        bodyClass: document.body.className,
        stepClass: document.querySelector(".ob-step")?.className ?? null,
        text: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 240),
      };
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  })()`);
  if (!updated?.ok) {
    throw new Error(`값을 입력할 수 없는 요소입니다: ${selector} ${JSON.stringify(updated)}`);
  }
}

async function inspectOnboardingAtViewport(cdp, viewport, native) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.evaluate(`(() => {
    if (${native ? "true" : "false"}) document.documentElement.setAttribute("data-hy-native", "");
    else document.documentElement.removeAttribute("data-hy-native");
    return true;
  })()`);
  await wait(100);
  return cdp.evaluate(`(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const controls = [...document.querySelectorAll(".ob-step button")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          height: Math.round(rect.height),
        };
      });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      native: document.documentElement.hasAttribute("data-hy-native"),
      stepClass: document.querySelector(".ob-step")?.className ?? null,
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      rootOverflowX: getComputedStyle(document.querySelector("#root")).overflowX,
      outOfBounds: controls.filter((control) => control.left < -1 || control.right > innerWidth + 1),
      smallButtons: controls.filter((control) => control.height < 44),
    };
  })()`);
}

async function restoreBrowserQaViewport(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...BROWSER_QA_VIEWPORT,
    screenWidth: BROWSER_QA_VIEWPORT.width,
    screenHeight: BROWSER_QA_VIEWPORT.height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.evaluate('document.documentElement.removeAttribute("data-hy-native"); true');
  await wait(100);
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
    // 이 하니스의 검사는 한국어 정본 문구 기준이다. 브라우저 기본 언어를 따라가면
    // Linux CI(en-US)에서 영어 화면을 한국어로 검사하게 되므로 표시 언어를 고정한다.
    "--lang=ko-KR",
    "--accept-lang=ko-KR,ko",
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
    let externalRequests = [];
    const expectedAuthResponses = [];
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
        const responseUrl = new URL(message.params.response.url);
        if (
          (message.params.response.status === 401 && responseUrl.pathname === "/auth/login-password")
          || (
            message.params.response.status === 401
            && activeScenario.authCase === "device-inactive"
            && ["/api/family/mine", "/auth/refresh"].includes(responseUrl.pathname)
          )
          || (message.params.response.status === 503 && responseUrl.pathname === "/auth/check-login-id")
          || (
            message.params.response.status === 503
            && activeScenario.studyMode === "unavailable"
            && responseUrl.pathname.startsWith("/api/study/")
          )
        ) {
          expectedAuthResponses.push(`${message.params.response.status} ${message.params.response.url}`);
          return;
        }
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
          externalRequests.push(`${request.method} ${url.pathname}`);
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
          // 비공개 사진은 JSON이 아니라 이미지다 — 부모·아이 아바타가 실제로 그려지는지 보려면
          // 이 경로도 진짜 바이트로 응답해야 한다(2026-08-18 부모 프로필 사진 제보).
          if (url.pathname.startsWith("/api/storage/child-photos/")) {
            await cdp.send("Fetch.fulfillRequest", {
              requestId,
              responseCode: 200,
              responseHeaders: [...cors, { name: "content-type", value: "image/png" }, { name: "cache-control", value: "private, no-store" }],
              body: QA_PHOTO_PNG_BASE64,
            });
            return;
          }
          let requestBody = null;
          if (typeof request.postData === "string" && request.postData) {
            try {
              requestBody = JSON.parse(request.postData);
            } catch {
              requestBody = null;
            }
          }
          const payload = mockApi(url.pathname, activeScenario, request.method, requestBody);
          const responseCode = url.pathname === "/api/family/mine"
            && activeScenario.authCase === "no-family"
            ? 204
            : activeScenario.authCase === "device-inactive"
              && ["/api/family/mine", "/auth/refresh"].includes(url.pathname)
              ? 401
            : url.pathname === "/api/ai/voice-parse"
              && activeScenario.aiScheduleExhausted === true
              ? 429
            : url.pathname === "/auth/login-password" && activeScenario.authCase === "wrong-password"
              ? 401
            : url.pathname === "/auth/check-login-id" && activeScenario.authCase === "id-check-error"
              ? 503
              : activeScenario.studyMode === "unavailable" && url.pathname.startsWith("/api/study/")
                ? 503
                : 200;
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode,
            responseHeaders: [...cors, { name: "content-type", value: "application/json; charset=utf-8" }],
            // 204 는 body 를 보낼 수 없다(HTTP 사양) — 가족 없음 시나리오가 이 분기다.
            body: responseCode === 204 ? undefined : jsonBody(payload),
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
      externalRequests = [];
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
        requests: uniqueStrings(externalRequests),
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
      languageCurrent: document.querySelector(".hy-language__current")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      languageExpanded: document.querySelector(".hy-language__current")?.getAttribute("aria-expanded") ?? null,
      languageOptionsCollapsed: (() => {
        const collapse = document.querySelector(".hy-language__collapse");
        return collapse?.getAttribute("aria-hidden") === "true"
          && getComputedStyle(collapse).visibility === "hidden"
          && !collapse.querySelector('.hy-language__option:not([tabindex="-1"])');
      })(),
      languageAfterRoles: (document.querySelector(".ob-role-list")?.getBoundingClientRect().bottom ?? Infinity)
        <= (document.querySelector(".ob-role-language")?.getBoundingClientRect().top ?? -Infinity),
      languageBeforeTerms: (document.querySelector(".ob-role-language")?.getBoundingClientRect().bottom ?? Infinity)
        <= (document.querySelector(".ob-role-terms")?.getBoundingClientRect().top ?? -Infinity),
    }))()`);
    await clickSelector(cdp, ".hy-language__current");
    await wait(100);
    const onboardingLanguageExpandedFacts = await cdp.evaluate(`(() => ({
      expanded: document.querySelector(".hy-language__current")?.getAttribute("aria-expanded") ?? null,
      optionCount: document.querySelectorAll(".hy-language__options .hy-language__option").length,
      currentRepeated: [...document.querySelectorAll(".hy-language__options .hy-language__option")]
        .some((option) => option.textContent?.trim() === "한국어"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))()`);
    await clickSelector(cdp, ".hy-language__current");
    if (
      onboardingAntiSlopFacts.badgePresent
      || onboardingAntiSlopFacts.subtitle !== "함께 보는 우리 가족 일정"
      || !onboardingAntiSlopFacts.languageCurrent?.includes("한국어")
      || onboardingAntiSlopFacts.languageExpanded !== "false"
      || !onboardingAntiSlopFacts.languageOptionsCollapsed
      || !onboardingAntiSlopFacts.languageAfterRoles
      || !onboardingAntiSlopFacts.languageBeforeTerms
      || onboardingLanguageExpandedFacts.expanded !== "true"
      || onboardingLanguageExpandedFacts.optionCount !== 9
      || onboardingLanguageExpandedFacts.currentRepeated
      || onboardingLanguageExpandedFacts.overflow > 0
      || rowProblems(onboarding).length > 0
    ) {
      report.problems.push({
        scope: "onboarding-decorative-badge",
        facts: { ...onboardingAntiSlopFacts, expanded: onboardingLanguageExpandedFacts },
        routeProblems: rowProblems(onboarding),
      });
    }
    report.focused.antiSlop = {
      onboarding: { ...onboardingAntiSlopFacts, expanded: onboardingLanguageExpandedFacts },
    };

    // 한국 외 접속은 국내 전용 OAuth를 숨기고 전 지역 공용 Google만 남긴다.
    // 저장한 사용자 선택이 없는 새 접속을 만들어 국가 기본 언어까지 함께 확인한다.
    await cdp.evaluate("localStorage.clear(); sessionStorage.clear(); true");
    await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false, country: "JP" },
      "onboarding",
    );
    const japanLanguageCurrent = await cdp.evaluate(
      'document.querySelector(".hy-language__current")?.textContent?.replace(/\\s+/g, " ").trim() ?? null',
    );
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(350);
    const japanSocialFacts = await cdp.evaluate(`(() => ({
      locale: document.documentElement.lang,
      google: Boolean(document.querySelector(".ob-social--google")),
      kakao: Boolean(document.querySelector(".ob-social--kakao")),
      naver: Boolean(document.querySelector(".ob-social--naver")),
    }))()`);
    if (
      japanSocialFacts.locale !== "ja"
      || !japanLanguageCurrent?.includes("日本語")
      || !japanSocialFacts.google
      || japanSocialFacts.kakao
      || japanSocialFacts.naver
    ) {
      report.problems.push({
        scope: "access-country-social-login",
        facts: { ...japanSocialFacts, languageCurrent: japanLanguageCurrent },
      });
    }
    report.focused.accessCountrySocialLogin = {
      country: "JP",
      ...japanSocialFacts,
      languageCurrent: japanLanguageCurrent,
    };

    // as가 없던 구형 링크는 역할을 단정하지 않고 학부모·아이 선택을 받는다.
    await cdp.evaluate("localStorage.clear(); sessionStorage.clear(); true");
    const legacyInviteOnboarding = await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false },
      "onboarding?pair=KID-QA123456",
      1_000,
    );
    const legacyInviteFacts = await cdp.evaluate('(() => ({ hash: location.hash, roleVisible: Boolean(document.querySelector(".ob-role")), inviteContext: document.querySelector(".ob-invite-context")?.textContent?.replace(/\\s+/g, " ").trim() ?? null, pairingVisible: Boolean(document.querySelector(".ob-pairing")) }))()');
    const legacyAnonymousRequested = legacyInviteOnboarding.requests.some(
      (request) => request === "POST /auth/anonymous",
    );
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(300);
    const legacyParentChoiceFacts = await cdp.evaluate('({ loginVisible: Boolean(document.querySelector(".ob-login")), pairingVisible: Boolean(document.querySelector(".ob-pairing")) })');
    if (
      !legacyInviteFacts.roleVisible
      || !legacyInviteFacts.inviteContext?.includes("다른 보호자로 연결하려면 반드시 학부모")
      || legacyInviteFacts.pairingVisible
      || legacyInviteFacts.hash.includes("pair=")
      || legacyAnonymousRequested
      || !legacyParentChoiceFacts.loginVisible
      || legacyParentChoiceFacts.pairingVisible
      || rowProblems(legacyInviteOnboarding).length > 0
    ) {
      report.problems.push({
        scope: "legacy-pair-invite-role-choice",
        facts: {
          entry: legacyInviteFacts,
          parentChoice: legacyParentChoiceFacts,
          anonymousRequested: legacyAnonymousRequested,
        },
        requests: legacyInviteOnboarding.requests,
        routeProblems: rowProblems(legacyInviteOnboarding),
      });
    }
    report.focused.legacyPairInviteRoleChoice = {
      entry: legacyInviteFacts,
      parentChoice: legacyParentChoiceFacts,
      anonymousRequested: legacyAnonymousRequested,
      requests: legacyInviteOnboarding.requests,
    };

    // 공동 보호자 딥링크는 인증 화면을 열고, 아이용 익명 세션을 만들지 않는다.
    await cdp.evaluate("localStorage.clear(); sessionStorage.clear(); true");
    const coParentOnboarding = await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false },
      "onboarding?pair=KID-QA123456&as=parent",
      1_200,
    );
    const coParentOnboardingFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      loginVisible: Boolean(document.querySelector(".ob-login")),
      pairingVisible: Boolean(document.querySelector(".ob-pairing")),
      inviteContext: document.querySelector(".ob-invite-context")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
    }))()`);
    const anonymousRequested = coParentOnboarding.requests.some((request) => request === "POST /auth/anonymous");
    if (
      !coParentOnboardingFacts.loginVisible
      || coParentOnboardingFacts.pairingVisible
      || !coParentOnboardingFacts.inviteContext?.includes("공동 보호자 초대")
      || coParentOnboardingFacts.hash.includes("pair=")
      || coParentOnboardingFacts.hash.includes("as=parent")
      || anonymousRequested
      || rowProblems(coParentOnboarding).length > 0
    ) {
      report.problems.push({
        scope: "co-parent-invite-onboarding",
        facts: { ...coParentOnboardingFacts, anonymousRequested },
        requests: coParentOnboarding.requests,
        routeProblems: rowProblems(coParentOnboarding),
      });
    }
    report.focused.coParentInviteOnboarding = {
      ...coParentOnboardingFacts,
      anonymousRequested,
      requests: coParentOnboarding.requests,
    };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "onboarding-co-parent-invite.png"));

    await cdp.evaluate("localStorage.clear(); sessionStorage.clear(); true");
    await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false, country: "KR" },
      "onboarding",
    );

    // 인증 진입점: 로그인/회원가입이 명확히 분리되고, 잘못된 비밀번호 뒤에도 입력·재시도 상태가 남는다.
    activeScenario.authCase = "wrong-password";
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(350);
    const loginEntryFacts = await cdp.evaluate(`(() => ({
      title: document.querySelector(".ob-h1")?.textContent?.trim() ?? null,
      paddingLeft: Math.round(Number.parseFloat(getComputedStyle(document.querySelector(".ob-login")).paddingLeft)),
      paddingRight: Math.round(Number.parseFloat(getComputedStyle(document.querySelector(".ob-login")).paddingRight)),
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
        text: tab.textContent?.trim() ?? "",
        selected: tab.getAttribute("aria-selected") === "true",
      })),
      hasLoginForm: Boolean(document.querySelector(".ob-login-form")),
      hasKakao: (document.querySelector(".ob-social--kakao")?.textContent || "").includes("카카오로 계속하기"),
    }))()`);
    await setInputValue(cdp, "#hyeni-login-username", "mindlady");
    await setInputValue(cdp, "#hyeni-login-password", "incorrect-password");
    await cdp.evaluate(`(() => {
      const form = document.querySelector(".ob-login-form");
      if (!(form instanceof HTMLFormElement)) return false;
      form.requestSubmit();
      return true;
    })()`);
    await wait(900);
    const wrongPasswordFacts = await cdp.evaluate(`(() => ({
      alert: document.querySelector(".ob-auth-alert")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      loginId: document.querySelector("#hyeni-login-username")?.value ?? null,
      password: document.querySelector("#hyeni-login-password")?.value ?? null,
      focusedId: document.activeElement?.id ?? null,
      submitDisabled: Boolean(document.querySelector(".ob-login-form button[type=submit]")?.disabled),
      sessionAbsent: localStorage.getItem("hyeni-api-session-v1") === null,
    }))()`);
    const wrongPasswordExpected401 = expectedAuthResponses.some((value) => value.includes("401") && value.includes("/auth/login-password"));
    if (
      loginEntryFacts.title !== "다시 만나 반가워요"
      || JSON.stringify(loginEntryFacts.tabs) !== JSON.stringify([
        { text: "로그인", selected: true },
        { text: "회원가입", selected: false },
      ])
      || !loginEntryFacts.hasLoginForm
      || !loginEntryFacts.hasKakao
      || loginEntryFacts.paddingLeft !== 16
      || loginEntryFacts.paddingRight !== 16
      || !wrongPasswordFacts.alert?.includes("아이디 또는 비밀번호가 맞지 않아요")
      || wrongPasswordFacts.loginId !== "mindlady"
      || wrongPasswordFacts.password !== "incorrect-password"
      || wrongPasswordFacts.focusedId !== "hyeni-login-password"
      || wrongPasswordFacts.submitDisabled
      || !wrongPasswordFacts.sessionAbsent
      || !wrongPasswordExpected401
    ) {
      report.problems.push({
        scope: "auth-wrong-password-recovery",
        facts: { entry: loginEntryFacts, wrongPassword: wrongPasswordFacts, expected401: wrongPasswordExpected401 },
      });
    }
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "auth-wrong-password.png"));

    // 인증 성공 회귀: API가 유효한 부모 세션을 돌려주면 정적 부팅 셸이나 로그인 화면에
    // 머물지 않고 가족 조회를 거쳐 부모 홈까지 한 번에 전환되어야 한다.
    await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false },
      "onboarding",
    );
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(250);
    activeScenario = {
      role: "parent",
      tier: "free",
      catalogMode: "valid",
      overLimit: false,
      authCase: "success",
    };
    // 저장된 ID·비밀번호가 브라우저 자동완성으로 함께 들어온 상황을 재현한다.
    // 버튼·requestSubmit 없이 autofill animation만 전달해 실제 React wiring을 검증한다.
    await cdp.evaluate(`(() => {
      const username = document.querySelector("#hyeni-login-username");
      const password = document.querySelector("#hyeni-login-password");
      if (!(username instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) return false;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!valueSetter) return false;
      valueSetter.call(username, "qa-parent");
      valueSetter.call(password, "correct-password");
      const nativeMatches = Element.prototype.matches;
      for (const input of [username, password]) {
        Object.defineProperty(input, "matches", {
          configurable: true,
          value(selector) {
            return selector === ":autofill" || selector === ":-webkit-autofill"
              ? true
              : nativeMatches.call(this, selector);
          },
        });
        input.dispatchEvent(new AnimationEvent("animationstart", {
          bubbles: true,
          animationName: "hy-login-autofill-detected",
        }));
      }
      return true;
    })()`);
    await wait(2_200);
    const successfulLoginPasswordRequests = externalRequests.filter((request) => request === "POST /auth/login-password").length;
    const successfulLoginFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      sessionPresent: localStorage.getItem("hyeni-api-session-v1") !== null,
      staticBootShellPresent: Boolean(document.querySelector(".boot-shell")),
      splashPresent: Boolean(document.querySelector(".sp-root")),
      parentHomePresent: Boolean(document.querySelector(".ph-page")),
      loginFormPresent: Boolean(document.querySelector(".ob-login-form")),
    }))()`);
    const successfulLoginProblems = [
      ...uniqueStrings(consoleMessages).map((value) => `console:${value}`),
      ...uniqueStrings(networkFailures).map((value) => `network:${value}`),
    ];
    await cdp.evaluate(`(() => {
      const url = new URL(location.href);
      url.searchParams.set("qaRole", "preserve");
      history.replaceState(history.state, "", url.href);
    })()`);
    consoleMessages = [];
    networkFailures = [];
    await cdp.send("Page.reload", { ignoreCache: true });
    await wait(3_200);
    const successfulLoginReloadFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      sessionPresent: localStorage.getItem("hyeni-api-session-v1") !== null,
      staticBootShellPresent: Boolean(document.querySelector(".boot-shell")),
      splashPresent: Boolean(document.querySelector(".sp-root")),
      parentHomePresent: Boolean(document.querySelector(".ph-page")),
      loginFormPresent: Boolean(document.querySelector(".ob-login-form")),
    }))()`);
    const successfulLoginReloadProblems = [
      ...uniqueStrings(consoleMessages).map((value) => `console:${value}`),
      ...uniqueStrings(networkFailures).map((value) => `network:${value}`),
    ];
    if (
      successfulLoginFacts.hash !== "#/parent/home"
      || !successfulLoginFacts.sessionPresent
      || successfulLoginFacts.staticBootShellPresent
      || successfulLoginFacts.splashPresent
      || !successfulLoginFacts.parentHomePresent
      || successfulLoginFacts.loginFormPresent
      || successfulLoginPasswordRequests !== 1
      || successfulLoginProblems.length > 0
      || successfulLoginReloadFacts.hash !== "#/parent/home"
      || !successfulLoginReloadFacts.sessionPresent
      || successfulLoginReloadFacts.staticBootShellPresent
      || successfulLoginReloadFacts.splashPresent
      || !successfulLoginReloadFacts.parentHomePresent
      || successfulLoginReloadFacts.loginFormPresent
      || successfulLoginReloadProblems.length > 0
    ) {
      report.problems.push({
        scope: "auth-successful-parent-home-transition",
        facts: { initial: successfulLoginFacts, reload: successfulLoginReloadFacts, loginPasswordRequests: successfulLoginPasswordRequests },
        problems: { initial: successfulLoginProblems, reload: successfulLoginReloadProblems },
      });
    }
    report.focused.successfulLogin = {
      initial: successfulLoginFacts,
      reload: successfulLoginReloadFacts,
      loginPasswordRequests: successfulLoginPasswordRequests,
      problems: { initial: successfulLoginProblems, reload: successfulLoginReloadProblems },
    };

    // 단일 활성 설치 회귀: 같은 계정을 PC에서 다시 인증해 기존 iPhone 설치가 비활성화된
    // 상황을 재현한다. 가족 조회 401 → refresh 401 이후 세션만 지우고 역할 선택은 보존하며,
    // 온보딩에는 사용자가 이해할 수 있는 자동 로그아웃 사유를 정확히 한 번 보여야 한다.
    activeScenario = {
      role: "parent",
      tier: "free",
      catalogMode: "valid",
      overLimit: false,
      authCase: "device-inactive",
    };
    consoleMessages = [];
    networkFailures = [];
    await cdp.send("Page.reload", { ignoreCache: true });
    await wait(3_200);
    const deviceTakeoverFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      sessionAbsent: localStorage.getItem("hyeni-api-session-v1") === null,
      roleSelectionPresent: Boolean(document.querySelector(".ob-role-card--parent"))
        && Boolean(document.querySelector(".ob-role-card--child")),
      noticeText: document.querySelector(".ob-session-end")?.textContent?.trim() ?? "",
      reasonConsumed: localStorage.getItem("hyeni-session-end-reason-v1") === null,
      parentHomePresent: Boolean(document.querySelector(".ph-page")),
    }))()`);
    const deviceTakeoverExpected401 = expectedAuthResponses.filter((value) => (
      value.includes("401")
      && (value.includes("/api/family/mine") || value.includes("/auth/refresh"))
    ));
    const deviceTakeoverProblems = [
      ...uniqueStrings(consoleMessages).map((value) => `console:${value}`),
      ...uniqueStrings(networkFailures).map((value) => `network:${value}`),
    ];
    if (
      deviceTakeoverFacts.hash !== "#/onboarding"
      || !deviceTakeoverFacts.sessionAbsent
      || !deviceTakeoverFacts.roleSelectionPresent
      || !deviceTakeoverFacts.noticeText.includes("다른 기기에서 다시 로그인")
      || !deviceTakeoverFacts.reasonConsumed
      || deviceTakeoverFacts.parentHomePresent
      || !deviceTakeoverExpected401.some((value) => value.includes("/api/family/mine"))
      || !deviceTakeoverExpected401.some((value) => value.includes("/auth/refresh"))
      || deviceTakeoverProblems.length > 0
    ) {
      report.problems.push({
        scope: "auth-device-takeover-logout-notice",
        facts: deviceTakeoverFacts,
        expected401: deviceTakeoverExpected401,
        problems: deviceTakeoverProblems,
      });
    }
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "auth-device-takeover.png"));

    consoleMessages = [];
    networkFailures = [];
    await cdp.send("Page.reload", { ignoreCache: true });
    await wait(1_800);
    const deviceTakeoverReloadFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      sessionAbsent: localStorage.getItem("hyeni-api-session-v1") === null,
      roleSelectionPresent: Boolean(document.querySelector(".ob-role-card--parent"))
        && Boolean(document.querySelector(".ob-role-card--child")),
      noticePresent: Boolean(document.querySelector(".ob-session-end")),
    }))()`);
    const deviceTakeoverReloadProblems = [
      ...uniqueStrings(consoleMessages).map((value) => `console:${value}`),
      ...uniqueStrings(networkFailures).map((value) => `network:${value}`),
    ];
    if (
      deviceTakeoverReloadFacts.hash !== "#/onboarding"
      || !deviceTakeoverReloadFacts.sessionAbsent
      || !deviceTakeoverReloadFacts.roleSelectionPresent
      || deviceTakeoverReloadFacts.noticePresent
      || deviceTakeoverReloadProblems.length > 0
    ) {
      report.problems.push({
        scope: "auth-device-takeover-logout-notice-once",
        facts: deviceTakeoverReloadFacts,
        problems: deviceTakeoverReloadProblems,
      });
    }
    report.focused.deviceTakeover = {
      initial: deviceTakeoverFacts,
      reload: deviceTakeoverReloadFacts,
      expected401: deviceTakeoverExpected401,
      problems: { initial: deviceTakeoverProblems, reload: deviceTakeoverReloadProblems },
    };
    await cdp.evaluate("localStorage.clear(); sessionStorage.clear(); true");
    // 가족 없는 신규 부모 → connect 단계 → 페어링(pairing) 단계 UI 계약(2026-08-22 TK
    // iPhone 제보 수정 회귀): 16px 입력(iOS 자동확대 차단), KID 코드 입력란 CSS 이관,
    // QR 스캔 버튼 존재, Enter 제출 배선을 정적 QA로 고정한다.
    await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false, authCase: "no-family" },
      "onboarding",
    );
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(250);
    activeScenario = { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, authCase: "no-family" };
    await setInputValue(cdp, "#hyeni-login-username", "qa-new-parent");
    await setInputValue(cdp, "#hyeni-login-password", "correct-password");
    await cdp.evaluate(`(() => {
      const form = document.querySelector(".ob-login-form");
      if (!(form instanceof HTMLFormElement)) return false;
      form.requestSubmit();
      return true;
    })()`);
    await wait(1_800);
    const connectStepFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      connectPresent: Boolean(document.querySelector(".ob-connect")),
      newFamilyButton: [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("새 가족")) || Boolean(document.querySelector(".ob-connect-list")),
      joinButton: [...document.querySelectorAll("button")].filter((button) => button.offsetParent !== null).map((button) => button.textContent?.trim()).join("|"),
    }))()`);
    const entryClicked = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((node) => node.offsetParent !== null && node.textContent?.includes("합류"));
      if (button instanceof HTMLElement) {
        button.click();
        return true;
      }
      return false;
    })()`);
    await wait(500);
    const pairingStepFacts = await cdp.evaluate(`(() => ({
      pairingPresent: Boolean(document.querySelector(".ob-pairing")),
      qrButtonPresent: Boolean(document.querySelector(".ob-qr")),
      codeInputClass: document.querySelector(".ob-pair-code-input")?.className ?? null,
      codeInputFontSize: document.querySelector(".ob-pair-code-input") ? getComputedStyle(document.querySelector(".ob-pair-code-input")).fontSize : null,
      codePlaceholder: document.querySelector(".ob-pair-code-input")?.getAttribute("placeholder") ?? null,
      inlineStyleGone: !(document.querySelector(".ob-pairing input")?.hasAttribute("style")),
      enterKeyHint: document.querySelector(".ob-pair-code-input")?.getAttribute("enterkeyhint") ?? null,
    }))()`);
    if (
      !connectStepFacts.connectPresent
      || !pairingStepFacts.pairingPresent
      || !pairingStepFacts.qrButtonPresent
      || !String(pairingStepFacts.codeInputFontSize ?? "").startsWith("16px")
      || pairingStepFacts.codePlaceholder !== "KID-XXXXXXXX"
      || !pairingStepFacts.inlineStyleGone
      || pairingStepFacts.enterKeyHint !== "done"
    ) {
      report.problems.push({
        scope: "onboarding-pairing-step-contract",
        facts: { connect: connectStepFacts, pairing: pairingStepFacts, entryClicked },
      });
    }
    report.focused.onboardingPairing = {
      connect: connectStepFacts,
      pairing: pairingStepFacts,
    };

    // 가족이 없는 기존 부모 계정: 로그인 → 기존 가족 선택 → 코드 합류 → 새 세션 → 부모 홈.
    // 운영 계정이나 실사용 페어링을 건드리지 않고, 요청 payload와 화면 전환을 함께 검증한다.
    await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false },
      "onboarding",
    );
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(250);
    activeScenario = {
      role: "parent",
      tier: "free",
      catalogMode: "valid",
      overLimit: false,
      authCase: "success-no-family",
      familyState: "none",
      lastJoinAsParentBody: null,
    };
    await setInputValue(cdp, "#hyeni-login-username", "qa-parent-without-family");
    await setInputValue(cdp, "#hyeni-login-password", "correct-password");
    await cdp.evaluate(`document.querySelector(".ob-login-form")?.requestSubmit(); true`);
    await wait(1_200);
    const existingFamilyConnectFacts = await cdp.evaluate(`(() => ({
      connectVisible: Boolean(document.querySelector(".ob-connect")),
      joinLabel: document.querySelector(".ob-connect-list .ob-connect-card:nth-child(2)")
        ?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      joinDisabled: document.querySelector(".ob-connect-list .ob-connect-card:nth-child(2)")?.disabled ?? null,
      hash: location.hash,
    }))()`);
    await clickSelector(cdp, ".ob-connect-list .ob-connect-card:nth-child(2)");
    await wait(300);
    const existingFamilyPairingFacts = await cdp.evaluate(`(() => ({
      pairingVisible: Boolean(document.querySelector(".ob-pairing")),
      codeInputVisible: Boolean(document.querySelector(".ob-pair-code-input")),
      scanButtonHeight: Math.round(document.querySelector(".ob-qr")?.getBoundingClientRect().height ?? 0),
      paddingLeft: Math.round(Number.parseFloat(getComputedStyle(document.querySelector(".ob-pairing")).paddingLeft)),
      paddingRight: Math.round(Number.parseFloat(getComputedStyle(document.querySelector(".ob-pairing")).paddingRight)),
      viewportOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))()`);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "onboarding-existing-family-pairing.png"));

    const androidPairingPortrait = await inspectOnboardingAtViewport(cdp, { width: 360, height: 800 }, true);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "onboarding-pairing-android-portrait.png"));
    const androidPairingLandscape = await inspectOnboardingAtViewport(cdp, { width: 720, height: 360 }, true);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "onboarding-pairing-android-landscape.png"));
    await restoreBrowserQaViewport(cdp);
    const androidLayoutProblems = [androidPairingPortrait, androidPairingLandscape].filter((facts) => (
      !facts.native
      || facts.stepClass !== "ob-step ob-pairing"
      || facts.overflow > 0
      || facts.htmlOverflowX !== "hidden"
      || facts.bodyOverflowX !== "hidden"
      || facts.rootOverflowX !== "hidden"
      || facts.outOfBounds.length > 0
      || facts.smallButtons.length > 0
    ));

    await cdp.evaluate(`(() => {
      window.__qaCameraRequests = 0;
      if (navigator.mediaDevices) {
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async () => {
            window.__qaCameraRequests += 1;
            throw new DOMException("격리 QA에서는 카메라를 열지 않습니다", "NotAllowedError");
          },
        });
      }
      Object.defineProperty(window, "BarcodeDetector", { configurable: true, value: undefined });
      return true;
    })()`);
    await clickSelector(cdp, ".ob-qr");
    await wait(700);
    const qrFallbackFacts = await cdp.evaluate(`(() => ({
      overlayVisible: Boolean(document.querySelector(".qrs-root")),
      manualVisible: Boolean(document.querySelector(".qrs-manual")),
      settingsVisible: Boolean(document.querySelector(".qrs-settings")),
      cameraRequests: Number(window.__qaCameraRequests ?? 0),
    }))()`);
    await clickSelector(cdp, ".qrs-manual");
    await wait(150);
    const qrManualReturnFacts = await cdp.evaluate(`({
      overlayVisible: Boolean(document.querySelector(".qrs-root")),
      codeInputVisible: Boolean(document.querySelector(".ob-pair-code-input")),
    })`);

    await setInputValue(cdp, ".ob-pair-code-input", "잘못된 코드");
    await clickSelector(cdp, ".ob-pairing .ob-cta");
    await wait(150);
    const invalidPairingFacts = await cdp.evaluate(`(() => ({
      alert: document.querySelector(".ob-pairing .ob-auth-alert")?.textContent?.trim() ?? null,
      inputValue: document.querySelector(".ob-pair-code-input")?.value ?? null,
    }))()`);
    await setInputValue(cdp, ".ob-pair-code-input", "KID-QA123456");
    await wait(50);
    const pairingErrorCleared = await cdp.evaluate('!document.querySelector(".ob-pairing .ob-auth-alert")');
    await cdp.evaluate(`document.querySelector(".ob-pairing .ob-cta")?.click(); true`);
    await wait(2_200);
    const existingFamilyPermissionFacts = await cdp.evaluate(`(() => {
      let familyId = null;
      try {
        const session = JSON.parse(localStorage.getItem("hyeni-api-session-v1") || "null");
        familyId = session?.user?.app_metadata?.family_id ?? session?.user?.user_metadata?.family_id ?? null;
      } catch {}
      return {
        familyId,
        hash: location.hash,
        pairingVisible: Boolean(document.querySelector(".ob-pairing")),
        permissionVisible: Boolean(document.querySelector(".ob-perms")),
      };
    })()`);
    await clickSelector(cdp, ".ob-perms .ob-cta");
    await wait(2_200);
    const existingFamilyJoinedFacts = await cdp.evaluate(`(() => {
      let familyId = null;
      try {
        const session = JSON.parse(localStorage.getItem("hyeni-api-session-v1") || "null");
        familyId = session?.user?.app_metadata?.family_id ?? session?.user?.user_metadata?.family_id ?? null;
      } catch {}
      return {
        familyId,
        hash: location.hash,
        permissionVisible: Boolean(document.querySelector(".ob-perms")),
        parentHomePresent: Boolean(document.querySelector(".ph-page")),
      };
    })()`);
    const joinBody = activeScenario.lastJoinAsParentBody;
    if (
      !existingFamilyConnectFacts.connectVisible
      || !existingFamilyConnectFacts.joinLabel?.includes("기존 가족")
      || existingFamilyConnectFacts.joinDisabled !== false
      || !existingFamilyPairingFacts.pairingVisible
      || !existingFamilyPairingFacts.codeInputVisible
      || existingFamilyPairingFacts.scanButtonHeight < 44
      || existingFamilyPairingFacts.paddingLeft !== 16
      || existingFamilyPairingFacts.paddingRight !== 16
      || existingFamilyPairingFacts.viewportOverflow > 0
      || androidLayoutProblems.length > 0
      || !qrFallbackFacts.overlayVisible
      || !qrFallbackFacts.manualVisible
      || qrFallbackFacts.settingsVisible
      || qrFallbackFacts.cameraRequests !== 1
      || qrManualReturnFacts.overlayVisible
      || !qrManualReturnFacts.codeInputVisible
      || !invalidPairingFacts.alert?.includes("KID-XXXXXXXX")
      || invalidPairingFacts.inputValue !== "잘못된 코드"
      || !pairingErrorCleared
      || joinBody?.pairCode !== "KID-QA123456"
      || typeof joinBody?.device_install_id !== "string"
      || !joinBody.device_install_id
      || joinBody?.device_platform !== "web"
      || existingFamilyPermissionFacts.familyId !== FAMILY_ID
      || existingFamilyPermissionFacts.pairingVisible
      || !existingFamilyPermissionFacts.permissionVisible
      || existingFamilyJoinedFacts.hash !== "#/parent/home"
      || existingFamilyJoinedFacts.familyId !== FAMILY_ID
      || existingFamilyJoinedFacts.permissionVisible
      || !existingFamilyJoinedFacts.parentHomePresent
    ) {
      report.problems.push({
        scope: "existing-family-parent-pairing",
        facts: {
          connect: existingFamilyConnectFacts,
          pairing: existingFamilyPairingFacts,
          android: { portrait: androidPairingPortrait, landscape: androidPairingLandscape },
          qrFallback: { open: qrFallbackFacts, returned: qrManualReturnFacts },
          invalidPairing: { ...invalidPairingFacts, errorCleared: pairingErrorCleared },
          permission: existingFamilyPermissionFacts,
          joined: existingFamilyJoinedFacts,
          joinBody,
        },
      });
    }
    report.focused.existingFamilyPairing = {
      connect: existingFamilyConnectFacts,
      pairing: existingFamilyPairingFacts,
      android: { portrait: androidPairingPortrait, landscape: androidPairingLandscape },
      qrFallback: { open: qrFallbackFacts, returned: qrManualReturnFacts },
      invalidPairing: { ...invalidPairingFacts, errorCleared: pairingErrorCleared },
      permission: existingFamilyPermissionFacts,
      joined: existingFamilyJoinedFacts,
      joinBody,
    };

    const signupOnboarding = await navigate(
      { role: "public", tier: "free", catalogMode: "valid", overLimit: false },
      "onboarding",
    );
    await clickSelector(cdp, ".ob-role-card--parent");
    await wait(250);
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.trim() === "회원가입");
      if (!(tab instanceof HTMLElement)) return false;
      tab.click();
      return true;
    })()`);
    await wait(250);
    const phoneSignupButtonFacts = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")]
        .find((node) => node.textContent?.trim() === "휴대폰 번호로 가입하기");
      if (!(button instanceof HTMLElement)) return { exists: false };
      const style = getComputedStyle(button);
      return {
        exists: true,
        text: button.textContent?.trim() ?? null,
        childElementCount: button.childElementCount,
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        height: Math.round(button.getBoundingClientRect().height),
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
      };
    })()`);
    const signupEntryFacts = await cdp.evaluate(`(() => ({
      title: document.querySelector(".ob-h1")?.textContent?.trim() ?? null,
      selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
      phoneButton: [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "휴대폰 번호로 가입하기"),
      loginFormAbsent: !document.querySelector(".ob-login-form"),
    }))()`);
    signupEntryFacts.phoneSignupButton = phoneSignupButtonFacts;
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "auth-signup-entry.png"));
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "휴대폰 번호로 가입하기");
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    await wait(250);
    await cdp.evaluate(`(() => {
      const button = document.querySelector(".ob-survey .ob-cta");
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    await wait(300);
    await setInputValue(cdp, "#hyeni-signup-username", "mindlady");
    await cdp.evaluate(`document.querySelector(".ob-inline-control__button")?.click(); true`);
    await wait(650);
    const loginIdAvailableFacts = await cdp.evaluate(`(() => ({
      value: document.querySelector("#hyeni-signup-username")?.value ?? null,
      available: document.querySelector(".ob-field-success")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      fieldError: document.querySelector("#ob-signup-login-id-error")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      formAlert: document.querySelector(".ob-auth-alert")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
    }))()`);
    activeScenario.authCase = "id-check-error";
    await setInputValue(cdp, "#hyeni-signup-username", "networklady");
    await cdp.evaluate(`document.querySelector(".ob-inline-control__button")?.click(); true`);
    await wait(650);
    const loginIdNetworkFacts = await cdp.evaluate(`(() => ({
      markedTaken: (document.querySelector("#ob-signup-login-id-error")?.textContent || "").includes("이미 사용 중"),
      markedAvailable: Boolean(document.querySelector(".ob-field-success")),
      hasRetryAlert: Boolean(document.querySelector(".ob-auth-alert")),
    }))()`);
    const loginIdExpected503 = expectedAuthResponses.some((value) => value.includes("503") && value.includes("/auth/check-login-id"));
    if (
      signupEntryFacts.title !== "혜니 가족 시작하기"
      || signupEntryFacts.selectedTab !== "회원가입"
      || !signupEntryFacts.phoneButton
      || !signupEntryFacts.loginFormAbsent
      || !phoneSignupButtonFacts.exists
      || phoneSignupButtonFacts.text !== "휴대폰 번호로 가입하기"
      || phoneSignupButtonFacts.childElementCount !== 0
      || phoneSignupButtonFacts.display !== "flex"
      || phoneSignupButtonFacts.alignItems !== "center"
      || phoneSignupButtonFacts.justifyContent !== "center"
      || phoneSignupButtonFacts.height !== 52
      || phoneSignupButtonFacts.backgroundColor !== "rgb(253, 231, 241)"
      || phoneSignupButtonFacts.backgroundImage !== "none"
      || phoneSignupButtonFacts.color !== "rgb(169, 68, 117)"
      || phoneSignupButtonFacts.borderColor !== "rgb(255, 208, 221)"
      || phoneSignupButtonFacts.borderRadius !== "16px"
      || loginIdAvailableFacts.value !== "mindlady"
      || !loginIdAvailableFacts.available?.includes("사용할 수 있는 아이디예요")
      || loginIdAvailableFacts.fieldError !== null
      || loginIdAvailableFacts.formAlert !== null
      || loginIdNetworkFacts.markedTaken
      || loginIdNetworkFacts.markedAvailable
      || !loginIdNetworkFacts.hasRetryAlert
      || !loginIdExpected503
      || rowProblems(signupOnboarding).length > 0
    ) {
      report.problems.push({
        scope: "auth-signup-entry-and-id-check",
        facts: {
          entry: signupEntryFacts,
          available: loginIdAvailableFacts,
          network: loginIdNetworkFacts,
          expected503: loginIdExpected503,
        },
        routeProblems: rowProblems(signupOnboarding),
      });
    }
    report.focused.authEntry = {
      login: loginEntryFacts,
      wrongPassword: { ...wrongPasswordFacts, expected401: wrongPasswordExpected401 },
      signup: signupEntryFacts,
      loginIdAvailable: loginIdAvailableFacts,
      loginIdNetworkFailure: { ...loginIdNetworkFacts, expected503: loginIdExpected503 },
    };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "auth-signup-id-check.png"));

    // 아이관리는 역할 선택 전 QR을 노출하지 않고, 아이 전용 링크에 as=child만 넣는다.
    const familyRoleSpecificInvite = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false },
      "parent/family",
    );
    const familyRoleSpecificEntryFacts = await cdp.evaluate(`(() => ({
      label: document.querySelector(".pf-paircode__label")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      intro: document.querySelector(".pf-paircode__intro")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      genericQrVisible: Boolean(document.querySelector('.pf-paircode canvas[role="img"]')),
      targetCount: document.querySelectorAll(".pf-paircode__target").length,
      childTarget: document.querySelector(".pf-paircode__target--child")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      parentTarget: document.querySelector(".pf-paircode__target--parent")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
    }))()`);
    await clickSelector(cdp, ".pf-paircode__target--child");
    await wait(500);
    await cdp.evaluate(`(() => {
      window.__qaSharedInvite = null;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => { window.__qaSharedInvite = data; },
      });
      return true;
    })()`);
    await clickSelector(cdp, ".ci-btn--share");
    await wait(200);
    const childInviteFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      title: document.querySelector(".ci-title")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      lead: document.querySelector(".ci-lead")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      qrVisible: Boolean(document.querySelector('.ci-qr-card canvas[role="img"]')),
      sharedText: window.__qaSharedInvite?.text ?? "",
    }))()`);
    const childInviteSharedText = childInviteFacts.sharedText ?? "";
    if (
      familyRoleSpecificEntryFacts.label !== "누구를 연결할까요?"
      || !familyRoleSpecificEntryFacts.intro?.includes("연결할 사람을 먼저 선택")
      || familyRoleSpecificEntryFacts.genericQrVisible
      || familyRoleSpecificEntryFacts.targetCount !== 2
      || !familyRoleSpecificEntryFacts.childTarget?.includes("아이")
      || !familyRoleSpecificEntryFacts.parentTarget?.includes("보호자")
      || childInviteFacts.hash !== "#/child-invite?role=child"
      || !childInviteFacts.title?.includes("아이 초대")
      || !childInviteFacts.lead?.includes("아이 기기")
      || !childInviteFacts.qrVisible
      || !childInviteSharedText.includes("pair=KID-QA123456")
      || !childInviteSharedText.includes("as=child")
      || childInviteSharedText.includes("as=parent")
      || rowProblems(familyRoleSpecificInvite).length > 0
    ) {
      report.problems.push({
        scope: "family-management-role-specific-invites",
        facts: { entry: familyRoleSpecificEntryFacts, childInvite: childInviteFacts },
        routeProblems: rowProblems(familyRoleSpecificInvite),
      });
    }
    report.focused.familyManagementRoleSpecificInvites = {
      entry: familyRoleSpecificEntryFacts,
      childInvite: childInviteFacts,
      routeState: familyRoleSpecificInvite.state,
    };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "family-child-role-invite.png"));

    // 가족 화면의 공동 보호자 CTA는 아이 초대와 다른 역할 링크·문구를 공유한다.
    const coParentInvite = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false },
      "parent/family",
    );
    await clickSelector(cdp, ".pf-paircode__target--parent");
    await wait(500);
    await cdp.evaluate(`(() => {
      window.__qaSharedInvite = null;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => { window.__qaSharedInvite = data; },
      });
      return true;
    })()`);
    await clickSelector(cdp, ".ci-btn--share");
    await wait(200);
    const coParentInviteFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      title: document.querySelector(".ci-title")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      lead: document.querySelector(".ci-lead")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      waiting: document.querySelector(".ci-wait")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      qrVisible: Boolean(document.querySelector('.ci-qr-card canvas[role="img"]')),
      sharedTitle: window.__qaSharedInvite?.title ?? null,
      sharedText: window.__qaSharedInvite?.text ?? "",
    }))()`);
    const sharedText = coParentInviteFacts.sharedText ?? "";
    if (
      coParentInviteFacts.hash !== "#/child-invite?role=parent"
      || !coParentInviteFacts.title?.includes("공동 보호자")
      || !coParentInviteFacts.lead?.includes("초대받은 보호자")
      || !coParentInviteFacts.waiting?.includes("공동 보호자")
      || !coParentInviteFacts.qrVisible
      || !coParentInviteFacts.sharedTitle?.includes("공동 보호자")
      || !sharedText.includes("as=parent")
      || sharedText.includes("as=child")
      || rowProblems(coParentInvite).length > 0
    ) {
      report.problems.push({
        scope: "co-parent-invite-share-role",
        facts: coParentInviteFacts,
        routeProblems: rowProblems(coParentInvite),
      });
    }
    report.focused.coParentInviteShare = coParentInviteFacts;
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "co-parent-invite-share.png"));

    // 공동 보호자 슬롯이 찬 가족은 새 QR을 숨기고 기존 보호자 관리로만 연결한다.
    const occupiedCoParent = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, coParentConnected: true },
      "parent/family",
    );
    const occupiedCoParentEntryFacts = await cdp.evaluate(`(() => ({
      targetTitle: document.querySelector(".pf-paircode__target--parent .pf-paircode__target-title")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      targetDescription: document.querySelector(".pf-paircode__target--parent .pf-paircode__target-sub")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      genericQrVisible: Boolean(document.querySelector('.pf-paircode canvas[role="img"]')),
    }))()`);
    await clickSelector(cdp, ".pf-paircode__target--parent");
    await wait(500);
    const occupiedCoParentManagementFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      guardianName: document.querySelector(".fc-coparent .fc-device__name")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      replacementHint: document.querySelector(".fc-coparent .fc-note")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      removeAction: document.querySelector(".fc-unpair--coparent")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      parentInviteVisible: Boolean(document.querySelector(".fc-invite")),
    }))()`);
    if (
      occupiedCoParentEntryFacts.targetTitle !== "공동 보호자 연결됨"
      || !occupiedCoParentEntryFacts.targetDescription?.includes("연결된 보호자님이 이미 연결")
      || occupiedCoParentEntryFacts.genericQrVisible
      || occupiedCoParentManagementFacts.hash !== "#/family-connection"
      || occupiedCoParentManagementFacts.guardianName !== "연결된 보호자"
      || !occupiedCoParentManagementFacts.replacementHint?.includes("기존 보호자 연결을 먼저 해제")
      || !occupiedCoParentManagementFacts.removeAction?.includes("연결된 보호자 연결 해제")
      || occupiedCoParentManagementFacts.parentInviteVisible
      || rowProblems(occupiedCoParent).length > 0
    ) {
      report.problems.push({
        scope: "occupied-co-parent-replacement-flow",
        facts: { entry: occupiedCoParentEntryFacts, management: occupiedCoParentManagementFacts },
        routeProblems: rowProblems(occupiedCoParent),
      });
    }
    report.focused.occupiedCoParentReplacement = {
      entry: occupiedCoParentEntryFacts,
      management: occupiedCoParentManagementFacts,
      routeState: occupiedCoParent.state,
    };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "family-existing-coparent-management.png"));

    // 공동 보호자로 로그인해도 자신을 "다른 보호자"로 반복 표시하지 않고 대표 보호자와
    // 같은 가족의 아이를 정확히 보여야 한다. 대표 보호자 해제 권한도 노출하지 않는다.
    const coParentGuardianVisibility = await navigate(
      {
        role: "parent",
        tier: "free",
        catalogMode: "valid",
        overLimit: false,
        coParentConnected: true,
        coParentViewer: true,
      },
      "parent/family",
    );
    const coParentFamilyFacts = await cdp.evaluate(`(() => ({
      guardianRows: [...document.querySelectorAll(".pf-parent")].map((row) => row.textContent?.replace(/\\s+/g, " ").trim() ?? ""),
      childNames: [...document.querySelectorAll(".pf-child__name")].map((node) => node.textContent?.trim() ?? ""),
    }))()`);
    await clickSelector(cdp, ".pf-conn");
    await wait(500);
    const coParentGuardianVisibilityFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      otherGuardianName: document.querySelector(".fc-coparent .fc-device__name")?.textContent?.trim() ?? null,
      otherGuardianRole: document.querySelector(".fc-coparent .fc-device__sub")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      currentGuardianRepeated: [...document.querySelectorAll(".fc-coparent .fc-device__name")]
        .some((node) => node.textContent?.trim() === "데모 보호자"),
      childNames: [...document.querySelectorAll(".fc-device .fc-device__name")].map((node) => node.textContent?.trim() ?? ""),
      removeActionVisible: Boolean(document.querySelector(".fc-unpair--coparent")),
      inviteVisible: Boolean(document.querySelector(".fc-invite")),
    }))()`);
    if (
      coParentFamilyFacts.guardianRows.length !== 2
      || !coParentFamilyFacts.guardianRows.some((row) => row.includes("데모 보호자") && row.includes("나"))
      || !coParentFamilyFacts.guardianRows.some((row) => row.includes("연결된 보호자"))
      || !coParentFamilyFacts.childNames.includes("데모 자녀")
      || coParentFamilyFacts.childNames.includes("아이2")
      || coParentGuardianVisibilityFacts.hash !== "#/family-connection"
      || coParentGuardianVisibilityFacts.otherGuardianName !== "연결된 보호자"
      || !coParentGuardianVisibilityFacts.otherGuardianRole?.includes("대표 보호자")
      || coParentGuardianVisibilityFacts.currentGuardianRepeated
      || !coParentGuardianVisibilityFacts.childNames.includes("데모 자녀")
      || coParentGuardianVisibilityFacts.removeActionVisible
      || coParentGuardianVisibilityFacts.inviteVisible
      || rowProblems(coParentGuardianVisibility).length > 0
    ) {
      report.problems.push({
        scope: "co-parent-sees-primary-guardian-and-children",
        facts: { family: coParentFamilyFacts, connection: coParentGuardianVisibilityFacts },
        routeProblems: rowProblems(coParentGuardianVisibility),
      });
    }
    report.focused.coParentGuardianVisibility = {
      family: coParentFamilyFacts,
      connection: coParentGuardianVisibilityFacts,
      routeState: coParentGuardianVisibility.state,
    };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "family-coparent-sees-primary-and-child.png"));

    for (const route of PARENT_BROWSER_QA_ROUTES) {
      const row = await navigate({ role: "parent", tier: "free", catalogMode: "valid", overLimit: route === "place-manager" }, route);
      row.problems = rowProblems(row);
      report.routes.parent.push(row);
      if (row.problems.length > 0) report.problems.push({ scope: "parent-route", route, problems: row.problems });
      // 대화 화면은 프로필·글자 크기를 눈으로 확인할 일이 잦아 증거 화면을 남긴다.
      if (route === "parent/memo") {
        report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-memo-chat.png"));
      }
      process.stdout.write(`${row.problems.length ? "FAIL" : "OK  "} parent ${route}${row.problems.length ? ` — ${row.problems.join(",")}` : ""}\n`);
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
        subscriptionIsGlass: Boolean(
          (subscriptionStyle?.backdropFilter || "").includes("blur")
          && !(subscriptionStyle?.backgroundImage || "").includes("gradient")
        ),
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
      || !parentHomeFreeFacts.subscriptionIsGlass
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
      || parentHomePremiumFacts.subscriptionHeight < 90
      || parentHomePremiumFacts.subscriptionActionHeight < 36
      || !parentHomePremiumFacts.subscriptionIsGlass
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

    const inspectStudyHomeCard = () => cdp.evaluate(`(() => {
      const card = document.querySelector(".ph-study-card");
      const shortcuts = document.querySelector(".ph-shortcuts");
      const cardRect = card?.getBoundingClientRect();
      const shortcutRect = shortcuts?.getBoundingClientRect();
      return {
        title: card?.querySelector(".ph-study-card__copy strong")?.textContent?.trim() ?? null,
        description: card?.querySelector(".ph-study-card__copy small")?.textContent?.trim() ?? null,
        status: card?.querySelector(".ph-study-card__status")?.textContent?.trim() ?? null,
        shortcutCount: document.querySelectorAll(".ph-shortcut").length,
        beforeShortcuts: Boolean(cardRect && shortcutRect && cardRect.bottom <= shortcutRect.top),
        fullWidth: Boolean(cardRect && shortcutRect && Math.abs(cardRect.width - shortcutRect.width) <= 2),
      };
    })()`);

    const linkedStudyHome = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, studyMode: "linked" },
      "parent/home",
    );
    const linkedStudyHomeFacts = await inspectStudyHomeCard();
    if (
      linkedStudyHomeFacts.title !== "혜니스터디 학습관리"
      || linkedStudyHomeFacts.description !== "아이의 오늘 공부와 진도를 확인해요"
      || linkedStudyHomeFacts.status !== "8문제 풀었어요"
      || linkedStudyHomeFacts.shortcutCount !== 8
      || !linkedStudyHomeFacts.beforeShortcuts
      || !linkedStudyHomeFacts.fullWidth
      || rowProblems(linkedStudyHome).length > 0
    ) {
      report.problems.push({ scope: "study-home-linked", facts: linkedStudyHomeFacts, routeProblems: rowProblems(linkedStudyHome) });
    }

    const unlinkedStudyHome = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, studyMode: "unlinked" },
      "parent/home",
    );
    const unlinkedStudyHomeFacts = await inspectStudyHomeCard();
    if (unlinkedStudyHomeFacts.status !== "아이와 연결하기" || rowProblems(unlinkedStudyHome).length > 0) {
      report.problems.push({ scope: "study-home-unlinked", facts: unlinkedStudyHomeFacts, routeProblems: rowProblems(unlinkedStudyHome) });
    }

    const unavailableStudyHome = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, studyMode: "unavailable" },
      "parent/home",
      9_000,
    );
    const unavailableStudyHomeFacts = await inspectStudyHomeCard();
    if (unavailableStudyHomeFacts.status !== "일시적으로 확인 불가" || rowProblems(unavailableStudyHome).length > 0) {
      report.problems.push({ scope: "study-home-unavailable", facts: unavailableStudyHomeFacts, routeProblems: rowProblems(unavailableStudyHome) });
    }

    const linkedStudyScenario = {
      role: "parent",
      tier: "free",
      catalogMode: "valid",
      overLimit: false,
      studyMode: "linked",
      studyMutationCalls: [],
    };
    const linkedStudyManagement = await navigate(linkedStudyScenario, "study-management");
    const linkedStudyManagementFacts = await cdp.evaluate(`(() => ({
      heading: document.querySelector(".study-management__header h1")?.textContent?.trim() ?? null,
      report: document.querySelector(".study-report")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      gradeInputs: document.querySelectorAll('.study-report input, .study-report select').length,
      revokeVisible: Boolean(document.querySelector(".study-devices__revoke")),
      pairingVisible: Boolean(document.querySelector(".study-pairing__issue")),
    }))()`);
    await clickSelector(cdp, ".study-pairing__issue");
    await wait(500);
    const studyPairingFacts = await cdp.evaluate(`(() => ({
      qrVisible: Boolean(document.querySelector('.study-pairing__qr canvas[role="img"]')),
      rawUrlInDom: document.body.innerText.includes("study.hyenicalendar.com/math/connect"),
      copyVisible: Boolean(document.querySelector(".study-pairing__copy")),
    }))()`);
    await clickSelector(cdp, ".study-devices__revoke");
    await wait(100);
    await clickSelector(cdp, ".study-devices__confirm-button");
    await wait(500);
    const linkedStudyMutationFacts = {
      calls: linkedStudyScenario.studyMutationCalls,
      attachCalled: linkedStudyScenario.studyMutationCalls.some((call) => call.method === "POST" && call.pathname.endsWith("/attach-challenges")),
      revokeCalled: linkedStudyScenario.studyMutationCalls.some((call) => call.method === "DELETE" && call.pathname.includes("/devices/")),
    };
    if (
      linkedStudyManagementFacts.heading !== "학습관리"
      || !linkedStudyManagementFacts.report?.includes("4학년")
      || !linkedStudyManagementFacts.report?.includes("8문제")
      || !linkedStudyManagementFacts.report?.includes("75%")
      || !linkedStudyManagementFacts.report?.includes("분수")
      || linkedStudyManagementFacts.gradeInputs !== 0
      || !linkedStudyManagementFacts.revokeVisible
      || !linkedStudyManagementFacts.pairingVisible
      || !studyPairingFacts.qrVisible
      || studyPairingFacts.rawUrlInDom
      || !studyPairingFacts.copyVisible
      || !linkedStudyMutationFacts.attachCalled
      || !linkedStudyMutationFacts.revokeCalled
      || rowProblems(linkedStudyManagement).length > 0
    ) {
      report.problems.push({
        scope: "study-management-linked-mutations",
        facts: { screen: linkedStudyManagementFacts, pairing: studyPairingFacts, mutations: linkedStudyMutationFacts },
        routeProblems: rowProblems(linkedStudyManagement),
      });
    }
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "study-management-linked.png"));

    const manyStudyManagement = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, studyMode: "linked", studyFamilyMode: "many" },
      "study-management",
    );
    const manyStudyInitialFacts = await cdp.evaluate(`(() => ({
      tabs: [...document.querySelectorAll(".study-child-tabs__tab")]
        .map((node) => node.querySelector(":scope > span:last-child")?.textContent?.trim() ?? ""),
      body: document.body.innerText.replace(/\\s+/g, " ").trim(),
    }))()`);
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll(".study-child-tabs__tab")]
        .find((node) => node.textContent?.includes("데모 둘째"));
      if (!(tab instanceof HTMLButtonElement)) return false;
      tab.click();
      return true;
    })()`);
    await wait(700);
    const manyStudySecondFacts = await cdp.evaluate(`(() => ({
      selected: document.querySelector('.study-child-tabs__tab[data-selected="true"] > span:last-child')?.textContent?.trim() ?? null,
      report: document.querySelector(".study-report")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
    }))()`);
    if (
      JSON.stringify(manyStudyInitialFacts.tabs) !== JSON.stringify(["데모 자녀", "데모 둘째"])
      || manyStudyInitialFacts.body.includes("비활성 아이")
      || manyStudySecondFacts.selected !== "데모 둘째"
      || !manyStudySecondFacts.report?.includes("5학년")
      || !manyStudySecondFacts.report?.includes("5문제")
      || rowProblems(manyStudyManagement).length > 0
    ) {
      report.problems.push({ scope: "study-management-many-active-children", facts: { initial: manyStudyInitialFacts, second: manyStudySecondFacts }, routeProblems: rowProblems(manyStudyManagement) });
    }

    const emptyStudyManagement = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, studyMode: "linked", studyFamilyMode: "empty" },
      "study-management",
    );
    const emptyStudyFacts = await cdp.evaluate(`(() => ({
      text: document.body.innerText.replace(/\\s+/g, " ").trim(),
      reportVisible: Boolean(document.querySelector(".study-report")),
      metricCount: document.querySelectorAll(".study-report__metrics dd").length,
    }))()`);
    if (!emptyStudyFacts.text.includes("연결된 아이가 없어요") || emptyStudyFacts.reportVisible || emptyStudyFacts.metricCount !== 0 || rowProblems(emptyStudyManagement).length > 0) {
      report.problems.push({ scope: "study-management-honest-empty", facts: emptyStudyFacts, routeProblems: rowProblems(emptyStudyManagement) });
    }

    const guardianStudyManagement = await navigate(
      { role: "parent", tier: "free", catalogMode: "valid", overLimit: false, studyMode: "linked", coParentConnected: true, coParentViewer: true },
      "study-management",
    );
    const guardianStudyFacts = await cdp.evaluate(`(() => ({
      reportVisible: Boolean(document.querySelector(".study-report")),
      revokeVisible: Boolean(document.querySelector(".study-devices__revoke")),
      pairingVisible: Boolean(document.querySelector(".study-pairing__issue")),
      notices: [...document.querySelectorAll(".study-devices__notice, .study-pairing__notice")].map((node) => node.textContent?.trim() ?? ""),
    }))()`);
    if (
      !guardianStudyFacts.reportVisible
      || guardianStudyFacts.revokeVisible
      || guardianStudyFacts.pairingVisible
      || !guardianStudyFacts.notices.some((text) => text.includes("주 보호자만"))
      || rowProblems(guardianStudyManagement).length > 0
    ) {
      report.problems.push({ scope: "study-management-guardian-read-only", facts: guardianStudyFacts, routeProblems: rowProblems(guardianStudyManagement) });
    }

    const claimStudyScenario = {
      role: "parent",
      tier: "free",
      catalogMode: "valid",
      overLimit: false,
      studyMode: "linked",
      studyFamilyMode: "many",
      studyMutationCalls: [],
    };
    const claimStudyManagement = await navigate(
      claimStudyScenario,
      `study-management/claim?token=${STUDY_QA_TOKEN}`,
    );
    const claimStudyInitialFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      tokenInBody: document.body.innerText.includes(${JSON.stringify(STUDY_QA_TOKEN)}),
      stored: sessionStorage.getItem("hyeni-study-claim-v1") !== null,
      children: [...document.querySelectorAll(".study-claim__child")].map((node) => node.textContent?.trim() ?? ""),
      connectDisabled: Boolean(document.querySelector(".study-claim__primary")?.disabled),
    }))()`);
    await cdp.evaluate(`(() => {
      const target = [...document.querySelectorAll(".study-claim__child")]
        .find((node) => node.textContent?.includes("데모 둘째"));
      if (!(target instanceof HTMLButtonElement)) return false;
      target.click();
      return true;
    })()`);
    await wait(100);
    await clickSelector(cdp, ".study-claim__primary");
    await wait(700);
    const claimStudyFinalFacts = await cdp.evaluate(`(() => ({
      hash: location.hash,
      success: document.querySelector(".study-claim")?.textContent?.includes("학습기록을 연결했어요") ?? false,
      preserved: document.querySelector(".study-claim")?.textContent?.includes("37개") ?? false,
      storageCleared: sessionStorage.getItem("hyeni-study-claim-v1") === null,
      tokenInBody: document.body.innerText.includes(${JSON.stringify(STUDY_QA_TOKEN)}),
    }))()`);
    const claimMutation = claimStudyScenario.studyMutationCalls.find((call) => call.pathname.endsWith("/claim"));
    const claimTokenLeaked = [
      ...consoleMessages,
      ...networkFailures,
      ...externalRequests,
      JSON.stringify(claimStudyScenario.studyMutationCalls),
    ].some((value) => value.includes(STUDY_QA_TOKEN));
    if (
      claimStudyInitialFacts.hash !== "#/study-management/claim"
      || claimStudyInitialFacts.tokenInBody
      || !claimStudyInitialFacts.stored
      || JSON.stringify(claimStudyInitialFacts.children) !== JSON.stringify(["데모 자녀", "데모 둘째"])
      || !claimStudyInitialFacts.connectDisabled
      || claimStudyFinalFacts.hash !== "#/study-management/claim"
      || !claimStudyFinalFacts.success
      || !claimStudyFinalFacts.preserved
      || !claimStudyFinalFacts.storageCleared
      || claimStudyFinalFacts.tokenInBody
      || !claimMutation?.hasClaimToken
      || claimTokenLeaked
      || rowProblems(claimStudyManagement).length > 0
    ) {
      report.problems.push({
        scope: "study-claim-url-erased-one-shot",
        facts: { initial: claimStudyInitialFacts, final: claimStudyFinalFacts, mutation: claimMutation, tokenLeaked: claimTokenLeaked },
        routeProblems: rowProblems(claimStudyManagement),
      });
    }
    await cdp.evaluate('sessionStorage.removeItem("hyeni-study-claim-v1"); true');
    report.focused.studyManagement = {
      home: { linked: linkedStudyHomeFacts, unlinked: unlinkedStudyHomeFacts, unavailable: unavailableStudyHomeFacts },
      linked: { ...linkedStudyManagementFacts, pairing: studyPairingFacts, mutations: linkedStudyMutationFacts },
      many: { initial: manyStudyInitialFacts, second: manyStudySecondFacts },
      empty: emptyStudyFacts,
      guardian: guardianStudyFacts,
      claim: { initial: claimStudyInitialFacts, final: claimStudyFinalFacts, mutation: claimMutation, tokenLeaked: claimTokenLeaked },
    };
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "study-claim-success.png"));

    const locationHistory = await navigate(
      { role: "parent", tier: "premium", catalogMode: "valid", overLimit: false },
      "parent/location?view=history",
    );
    const locationHistoryFacts = await cdp.evaluate(`(() => {
      const panel = document.querySelector(".pl-visited");
      const stays = [...document.querySelectorAll(".pl-visited__row")];
      const text = (panel?.innerText || "").replace(/\\s+/g, " ").trim();
      return {
        hash: location.hash,
        panelVisible: Boolean(panel),
        stayCount: stays.length,
        stayTexts: stays.map((stay) => (stay.textContent || "").replace(/\\s+/g, " ").trim()),
        hasToolbar: Boolean(document.querySelector(".pl-history-toolbar")),
        hasLegacyReplay: Boolean(document.querySelector(".pl-journey__replay, .pl-journey__toggle, .pl-journey__range")),
        heading: document.querySelector(".pl-visited__head strong")?.textContent?.trim() || "",
        count: document.querySelector(".pl-visited__head span")?.textContent?.trim() || "",
        text,
      };
    })()`);
    if (
      locationHistoryFacts.hash !== "#/parent/location?view=history"
      || !locationHistoryFacts.panelVisible
      || locationHistoryFacts.stayCount !== 2
      || !locationHistoryFacts.hasToolbar
      || locationHistoryFacts.hasLegacyReplay
      || locationHistoryFacts.heading !== "다녀온 곳"
      || locationHistoryFacts.count !== "2곳"
      || !locationHistoryFacts.stayTexts.some((text) => text.includes("우리 집"))
      // SCHOOL 좌표 visit은 시간대에 따라 "데모 학교"(장소) 또는 "가족 일정"(event visit)으로
      // 표기된다 — 둘 다 정상이므로 어느 쪽이든 통과시킨다(2026-08-22 기준선 재현 확인).
      || !(locationHistoryFacts.stayTexts.some((text) => text.includes("데모 학교")) || locationHistoryFacts.stayTexts.some((text) => text.includes("가족 일정")))
      || rowProblems(locationHistory).length > 0
    ) {
      report.problems.push({
        scope: "parent-location-history",
        facts: locationHistoryFacts,
        routeProblems: rowProblems(locationHistory),
      });
    }
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-location-history.png"));

    const legacyJourneyPresent = await cdp.evaluate(`Boolean(document.querySelector(".pl-journey__toggle"))`);
    if (legacyJourneyPresent) {
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
    } else {
      await clickSelector(cdp, ".pl-visited__row");
      await wait(260);
      const selectedStay = await cdp.evaluate(`(() => ({
        pressed: document.querySelector(".pl-visited__row")?.getAttribute("aria-pressed"),
        selectedCount: document.querySelectorAll(".pl-visited__row--selected").length,
        selectedText: document.querySelector(".pl-visited__row--selected")?.textContent?.replace(/\\s+/g, " ").trim() || null,
        legacyReplayPresent: Boolean(document.querySelector(".pl-journey__replay, .pl-journey__range")),
      }))()`);
      await clickSelector(cdp, ".pl-visited__row");
      await wait(260);
      const deselectedStay = await cdp.evaluate(`(() => ({
        pressed: document.querySelector(".pl-visited__row")?.getAttribute("aria-pressed"),
        selectedCount: document.querySelectorAll(".pl-visited__row--selected").length,
        fallbackText: document.querySelector(".pl-visited__row--selected")?.textContent?.replace(/\\s+/g, " ").trim() || null,
      }))()`);
      if (
        selectedStay.pressed !== "true"
        || selectedStay.selectedCount !== 1
        || !selectedStay.selectedText
        || selectedStay.legacyReplayPresent
        || deselectedStay.pressed !== "false"
        || deselectedStay.selectedCount !== 1
        || !deselectedStay.fallbackText
        || deselectedStay.fallbackText === selectedStay.selectedText
      ) {
        report.problems.push({
          scope: "parent-location-history-interaction",
          facts: { selected: selectedStay, deselected: deselectedStay },
        });
      }
      report.focused.parentLocationHistory = {
        ...locationHistoryFacts,
        selected: selectedStay,
        deselected: deselectedStay,
      };
    }

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

    // 부모 프로필 사진: 서버가 준 객체 키를 표시용 URL로 바꿔 실제로 그려지는지(디코딩까지) 본다.
    const parentProfilePhotoFacts = await cdp.evaluate(`(() => {
      const img = document.querySelector(".ps-profile__avatar img");
      if (!img) return { found: false, src: "", naturalWidth: 0 };
      const src = img.getAttribute("src") || "";
      return {
        found: true,
        src: src.slice(0, 16),
        isDisplayUrl: src.startsWith("blob:") || src.startsWith("http"),
        naturalWidth: img.naturalWidth,
        complete: img.complete,
      };
    })()`);
    if (
      !parentProfilePhotoFacts.found
      || !parentProfilePhotoFacts.isDisplayUrl
      || parentProfilePhotoFacts.naturalWidth <= 0
    ) {
      report.problems.push({ scope: "parent-profile-photo", facts: parentProfilePhotoFacts });
    }
    report.focused.parentProfilePhoto = parentProfilePhotoFacts;
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-settings-icons.png"));
    // 아래쪽 가족·안전, 약관·계정 그룹 아이콘까지 한 장 더 남긴다.
    await cdp.evaluate(`(() => { document.querySelector(".ps-content")?.scrollIntoView(false); window.scrollTo(0, document.body.scrollHeight); return true; })()`);
    await wait(600);
    report.screenshots.push(await screenshot(cdp, freshOutputDir, "parent-settings-icons-bottom.png"));

    // 친구 초대: 설정 행 → 패널 → 코드 발급까지 실제로 눌러 본다.
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll(".ps-nav")].find((node) => (node.textContent || "").includes("초대"));
      if (row instanceof HTMLElement) row.click();
      return true;
    })()`);
    await wait(900);
    const referralPanelFacts = await cdp.evaluate(`(() => ({
      open: Boolean(document.querySelector(".rrp__body")),
      state: document.querySelector(".rrp__state")?.textContent?.trim().slice(0, 40) ?? null,
      childOptions: document.querySelectorAll("#referral-reward-child option").length,
      code: document.querySelector(".rrp__code")?.textContent?.trim() ?? null,
      hasSave: Boolean(document.querySelector(".rrp__save")),
    }))()`);
    await cdp.evaluate(`(() => {
      const save = document.querySelector(".rrp__save");
      if (save instanceof HTMLElement) save.click();
      return true;
    })()`);
    await wait(1_400);
    const referralIssuedFacts = await cdp.evaluate(`(() => ({
      code: document.querySelector(".rrp__code")?.textContent?.trim() ?? null,
      stillAsksToIssue: Boolean(document.querySelector(".rrp__save")),
      copyEnabled: !document.querySelector(".rrp__action--copy")?.disabled,
    }))()`);
    if (
      !referralPanelFacts.open
      || referralPanelFacts.state !== null
      || referralPanelFacts.childOptions < 1
      || !/^HYENI-[0-9A-HJKMNP-TV-Z]{16}$/.test(referralIssuedFacts.code ?? "")
      || referralIssuedFacts.stillAsksToIssue
      || !referralIssuedFacts.copyEnabled
    ) {
      report.problems.push({
        scope: "referral-code-issue",
        facts: { panel: referralPanelFacts, issued: referralIssuedFacts },
      });
    }
    report.focused.referralCodeIssue = { panel: referralPanelFacts, issued: referralIssuedFacts };

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
        hasVersion: text.includes(${JSON.stringify(`혜니캘린더 v${PACKAGE_VERSION}`)}),
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
