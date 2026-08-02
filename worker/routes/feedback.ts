// 인증된 사용자의 신고·문의·제안을 D1에 먼저 내구 접수한 뒤 Resend로 전달한다.
// 진단 정보는 허용된 구조만 다시 조립해 저장하며 원문 오류·토큰·좌표는 보존하지 않는다.
import { Hono } from "hono";
import { resolveVerifiedFamilyMembership } from "../db/authz";
import { requireAuth } from "../middleware/auth";
import type { AuthUser, Env, Vars } from "../types";

const feedback = new Hono<{ Bindings: Env; Variables: Vars }>();

const MAX_CONTENT_LENGTH = 4000;
const MAX_APP_ORIGIN_LENGTH = 200;
const MAX_FAMILY_ID_LENGTH = 128;
const MAX_CURRENT_SCREEN_LENGTH = 180;
const MAX_ERROR_LOGS = 12;
const MAX_FEEDBACK_PER_HOUR = 5;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAMILY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_VERSION_PATTERN = /^[A-Za-z0-9.+-]{1,32}$/;
const LANGUAGE_PATTERN = /^[A-Za-z0-9-]{1,35}$/;
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+./-]{1,64}$/;
const DIAGNOSTIC_PATH_PATTERN = /^\/[A-Za-z0-9._:/-]*$/;
const DIAGNOSTIC_CODE_PATTERN = /^(?:[A-Za-z][A-Za-z0-9]*(?:[._:-][A-Za-z0-9]+)+|[A-Z][A-Za-z0-9]*(?:Error|Exception))$/;
const DIAGNOSTIC_SOURCE_PATTERN = /^[A-Za-z0-9._-]{1,92}\.(?:css|js|jsx|mjs|ts|tsx)(?::\d{1,8}){0,2}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DIAGNOSTIC_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i;
const DIAGNOSTIC_OPAQUE_SEGMENT_PATTERN = /^(?:KID-|eyJ|[A-Za-z0-9_-]{24,})/;
const DIAGNOSTIC_SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._:-]{1,40}$/;

const FEEDBACK_KINDS = new Set(["problem", "question", "suggestion"]);
const FEEDBACK_CATEGORIES = new Set([
  "account",
  "calendar",
  "chat_ai",
  "design",
  "location_safety",
  "notification",
  "other",
]);
const DIAGNOSTIC_KINDS = new Set(["api", "mutation", "rejection", "render", "runtime"]);
const DIAGNOSTIC_METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);
const DIAGNOSTIC_RUNTIMES = new Set([
  "android-native",
  "ios-browser",
  "ios-pwa",
  "web",
  "web-pwa",
]);
const DIAGNOSTIC_PLATFORMS = new Set(["android", "ios", "web"]);
const SERVICE_WORKER_STATES = new Set([
  "activated",
  "installing",
  "none",
  "unsupported",
  "waiting",
]);
const NOTIFICATION_PERMISSIONS = new Set(["default", "denied", "granted", "unsupported"]);
const NETWORK_TYPES = new Set(["2g", "3g", "4g", "slow-2g", "unknown"]);

type FeedbackKind = "problem" | "question" | "suggestion";
type FeedbackCategory =
  | "account"
  | "calendar"
  | "chat_ai"
  | "design"
  | "location_safety"
  | "notification"
  | "other";

interface CanonicalFeedbackSender {
  email: string | null;
  display_name: string | null;
}

interface StoredFeedbackRow {
  status: string;
}

interface NormalizedDeviceInfo {
  appVersion: string;
  runtime: string;
  platform: string;
  userAgent: string;
  language: string;
  timezone: string;
  viewport: {
    width: number;
    height: number;
    pixelRatio: number;
  };
  online: boolean;
  pwaStandalone: boolean;
  serviceWorker: string;
  notificationPermission: string;
  networkType: string;
}

interface NormalizedErrorLog {
  at: string;
  kind: string;
  code: string;
  screen: string;
  count?: number;
  status?: number;
  method?: string;
  path?: string;
  source?: string;
}

interface NormalizedFeedbackInput {
  requestId: string;
  familyId: string | null;
  feedbackKind: FeedbackKind;
  category: FeedbackCategory | null;
  content: string;
  appOrigin: string;
  diagnosticSchemaVersion: 1 | null;
  currentScreen: string;
  deviceInfo: NormalizedDeviceInfo | null;
  errorLogs: NormalizedErrorLog[] | null;
}

type FeedbackLogFields = Record<string, boolean | number | string | null>;

function feedbackNow(date = new Date()): string {
  return date.toISOString();
}

function writeFeedbackLog(
  level: "error" | "info" | "warn",
  event: string,
  requestId: string,
  fields: FeedbackLogFields = {},
): void {
  const entry = JSON.stringify({
    scope: "feedback",
    event,
    requestId,
    ...fields,
  });
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}

function normalizeFamilyId(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_FAMILY_ID_LENGTH
    || !FAMILY_ID_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeAppOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_APP_ORIGIN_LENGTH) return null;
  try {
    const parsed = new URL(normalized);
    const localHttp = parsed.protocol === "http:"
      && (parsed.hostname === "localhost"
        || parsed.hostname === "127.0.0.1"
        || parsed.hostname === "[::1]");
    if (parsed.protocol !== "https:" && !localHttp) return null;
    if (parsed.username || parsed.password || parsed.origin !== normalized) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeDiagnosticPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_CURRENT_SCREEN_LENGTH
    || !DIAGNOSTIC_PATH_PATTERN.test(normalized)
    || normalized.includes("//")
    || normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of normalized.split("/").filter(Boolean)) {
    if (/^-?\d+(?:\.\d+)?$/.test(segment)) {
      segments.push(":n");
    } else if (
      DIAGNOSTIC_UUID_PATTERN.test(segment)
      || DIAGNOSTIC_OPAQUE_SEGMENT_PATTERN.test(segment)
    ) {
      segments.push(":id");
    } else if (DIAGNOSTIC_SAFE_SEGMENT_PATTERN.test(segment)) {
      segments.push(segment);
    } else {
      return null;
    }
  }
  return `/${segments.join("/")}` || "/";
}

function normalizeObservedUserAgent(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  if (
    !normalized
    || normalized.length > 320
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return "unknown";
  }
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
): number | null {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isInteger(value))
  ) {
    return null;
  }
  return value;
}

function normalizeDeviceInfo(
  value: unknown,
  observedUserAgent: string,
): NormalizedDeviceInfo | null {
  if (!isPlainObject(value) || !isPlainObject(value.viewport)) return null;
  const appVersion = typeof value.appVersion === "string" ? value.appVersion.trim() : "";
  const runtime = typeof value.runtime === "string" ? value.runtime : "";
  const platform = typeof value.platform === "string" ? value.platform : "";
  const language = typeof value.language === "string" ? value.language.trim() : "";
  const timezone = typeof value.timezone === "string" ? value.timezone.trim() : "";
  const serviceWorker = typeof value.serviceWorker === "string" ? value.serviceWorker : "";
  const notificationPermission = typeof value.notificationPermission === "string"
    ? value.notificationPermission
    : "";
  const networkType = typeof value.networkType === "string" ? value.networkType : "";
  const width = finiteNumber(value.viewport.width, 0, 10_000, true);
  const height = finiteNumber(value.viewport.height, 0, 10_000, true);
  const pixelRatio = finiteNumber(value.viewport.pixelRatio, 0.1, 10);

  if (
    !APP_VERSION_PATTERN.test(appVersion)
    || !DIAGNOSTIC_RUNTIMES.has(runtime)
    || !DIAGNOSTIC_PLATFORMS.has(platform)
    || !LANGUAGE_PATTERN.test(language)
    || !TIMEZONE_PATTERN.test(timezone)
    || width === null
    || height === null
    || pixelRatio === null
    || typeof value.online !== "boolean"
    || typeof value.pwaStandalone !== "boolean"
    || !SERVICE_WORKER_STATES.has(serviceWorker)
    || !NOTIFICATION_PERMISSIONS.has(notificationPermission)
    || !NETWORK_TYPES.has(networkType)
  ) {
    return null;
  }

  return {
    appVersion,
    runtime,
    platform,
    userAgent: observedUserAgent,
    language,
    timezone,
    viewport: { width, height, pixelRatio },
    online: value.online,
    pwaStandalone: value.pwaStandalone,
    serviceWorker,
    notificationPermission,
    networkType,
  };
}

function normalizeErrorLog(value: unknown): NormalizedErrorLog | null {
  if (!isPlainObject(value)) return null;
  const at = typeof value.at === "string" ? value.at.trim() : "";
  const kind = typeof value.kind === "string" ? value.kind : "";
  const code = typeof value.code === "string" ? value.code.trim() : "";
  const screen = normalizeDiagnosticPath(value.screen);
  if (
    !ISO_DATE_PATTERN.test(at)
    || !Number.isFinite(Date.parse(at))
    || !DIAGNOSTIC_KINDS.has(kind)
    || !DIAGNOSTIC_CODE_PATTERN.test(code)
    || !screen
  ) {
    return null;
  }

  const normalized: NormalizedErrorLog = { at, kind, code, screen };
  if (value.count !== undefined) {
    const count = finiteNumber(value.count, 1, 999, true);
    if (count === null) return null;
    normalized.count = count;
  }
  if (value.status !== undefined) {
    const status = finiteNumber(value.status, 0, 599, true);
    if (status === null) return null;
    normalized.status = status;
  }
  if (value.method !== undefined) {
    const method = typeof value.method === "string" ? value.method : "";
    if (!DIAGNOSTIC_METHODS.has(method)) return null;
    normalized.method = method;
  }
  if (value.path !== undefined) {
    const path = normalizeDiagnosticPath(value.path);
    if (!path) return null;
    normalized.path = path;
  }
  if (value.source !== undefined) {
    const source = typeof value.source === "string" ? value.source.trim() : "";
    if (!DIAGNOSTIC_SOURCE_PATTERN.test(source)) return null;
    normalized.source = source;
  }
  return normalized;
}

function normalizeFeedbackInput(
  payload: Record<string, unknown>,
  observedUserAgent: string,
):
  | { ok: true; value: NormalizedFeedbackInput }
  | { ok: false; error: string } {
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return { ok: false, error: "invalid_feedback_request_id" };
  }
  const familyId = normalizeFamilyId(payload.familyId);
  if (familyId === undefined) return { ok: false, error: "invalid_family_id" };

  // 구버전 클라이언트의 기능 제안은 기존 의미를 보존한다.
  const rawFeedbackKind = payload.feedbackKind ?? "suggestion";
  if (typeof rawFeedbackKind !== "string" || !FEEDBACK_KINDS.has(rawFeedbackKind)) {
    return { ok: false, error: "invalid_feedback_kind" };
  }
  const feedbackKind = rawFeedbackKind as FeedbackKind;

  let category: FeedbackCategory | null = null;
  if (payload.category != null && payload.category !== "") {
    if (typeof payload.category !== "string" || !FEEDBACK_CATEGORIES.has(payload.category)) {
      return { ok: false, error: "invalid_feedback_category" };
    }
    category = payload.category as FeedbackCategory;
  }

  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: "invalid_feedback_content" };
  }
  const appOrigin = normalizeAppOrigin(payload.appOrigin);
  if (!appOrigin) return { ok: false, error: "invalid_app_origin" };

  const hasDiagnosticPayload = payload.deviceInfo != null
    || payload.errorLogs != null
    || payload.currentScreen != null;
  let diagnosticSchemaVersion: 1 | null = null;
  if (payload.diagnosticSchemaVersion != null) {
    if (payload.diagnosticSchemaVersion !== 1) {
      return { ok: false, error: "invalid_feedback_diagnostics" };
    }
    diagnosticSchemaVersion = 1;
  } else if (hasDiagnosticPayload) {
    // 진단 확장 배포 직전 빌드와의 짧은 전환 구간도 같은 v1 계약으로 해석한다.
    diagnosticSchemaVersion = 1;
  }

  const currentScreen = payload.currentScreen == null
    ? "/feedback"
    : normalizeDiagnosticPath(payload.currentScreen);
  if (!currentScreen) return { ok: false, error: "invalid_feedback_diagnostics" };

  let deviceInfo: NormalizedDeviceInfo | null = null;
  if (payload.deviceInfo != null) {
    deviceInfo = normalizeDeviceInfo(payload.deviceInfo, observedUserAgent);
    if (!deviceInfo) return { ok: false, error: "invalid_feedback_diagnostics" };
  }

  let errorLogs: NormalizedErrorLog[] | null = null;
  if (payload.errorLogs != null) {
    if (!Array.isArray(payload.errorLogs) || payload.errorLogs.length > MAX_ERROR_LOGS) {
      return { ok: false, error: "invalid_feedback_diagnostics" };
    }
    const normalizedLogs = payload.errorLogs.map(normalizeErrorLog);
    if (normalizedLogs.some((entry) => entry === null)) {
      return { ok: false, error: "invalid_feedback_diagnostics" };
    }
    errorLogs = normalizedLogs as NormalizedErrorLog[];
  }

  return {
    ok: true,
    value: {
      requestId,
      familyId,
      feedbackKind,
      category,
      content,
      appOrigin,
      diagnosticSchemaVersion,
      currentScreen,
      deviceInfo,
      errorLogs,
    },
  };
}

function isUsableEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

async function readCanonicalSender(
  db: D1Database,
  user: AuthUser,
  familyId: string | null,
): Promise<{ name: string; email: string; role: AuthUser["role"] }> {
  const row = await db
    .prepare(
      `SELECT
         u.email,
         COALESCE(
           NULLIF(fm.name, ''),
           NULLIF(up.display_name, ''),
           NULLIF(tp.display_name, '')
         ) AS display_name
       FROM users u
       LEFT JOIN family_members fm
         ON fm.user_id = u.id
        AND fm.family_id = ?
        AND fm.is_active = 1
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
    )
    .bind(familyId, user.sub)
    .first<CanonicalFeedbackSender>();
  if (!row) throw new Error("canonical_sender_missing");
  const email = String(row.email ?? "").trim();
  return {
    name: String(row.display_name ?? "").trim() || "사용자",
    email: isUsableEmail(email) ? email : "",
    role: user.role,
  };
}

async function readStoredFeedback(
  db: D1Database,
  id: string,
  userId: string,
): Promise<StoredFeedbackRow | null> {
  return db
    .prepare(
      `SELECT status
         FROM user_feedback
        WHERE id = ? AND user_id = ? AND type = 'feature_feedback'
        LIMIT 1`,
    )
    .bind(id, userId)
    .first<StoredFeedbackRow>();
}

const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  problem: "문제 신고",
  question: "사용 문의",
  suggestion: "기능 제안",
};

feedback.post("/", requireAuth, async (c) => {
  let payload: Record<string, unknown>;
  try {
    const parsed = await c.req.json<unknown>();
    if (!isPlainObject(parsed)) {
      return c.json({ error: "invalid_json_payload" }, 400);
    }
    payload = parsed;
  } catch {
    return c.json({ error: "invalid_json_payload" }, 400);
  }

  const normalized = normalizeFeedbackInput(
    payload,
    normalizeObservedUserAgent(c.req.header("User-Agent")),
  );
  if (!normalized.ok) return c.json({ error: normalized.error }, 400);
  const input = normalized.value;
  const user = c.get("user");

  let canonicalRole: AuthUser["role"] = user.role;
  if (input.familyId) {
    try {
      const membership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, input.familyId);
      if (!membership) {
        writeFeedbackLog("warn", "rejected", input.requestId, { reason: "family_forbidden" });
        return c.json({ error: "family_forbidden" }, 403);
      }
      canonicalRole = membership.role;
    } catch {
      writeFeedbackLog("error", "identity_failed", input.requestId, {
        reason: "membership_lookup",
      });
      return c.json({ error: "feedback_identity_unavailable" }, 503);
    }
  }

  let sender: { name: string; email: string; role: AuthUser["role"] };
  try {
    sender = await readCanonicalSender(c.env.DB, { ...user, role: canonicalRole }, input.familyId);
  } catch {
    writeFeedbackLog("error", "identity_failed", input.requestId, {
      reason: "sender_lookup",
    });
    return c.json({ error: "feedback_identity_unavailable" }, 503);
  }

  const feedbackId = `feature-feedback:${user.sub}:${input.requestId}`;
  let existing: StoredFeedbackRow | null;
  try {
    existing = await readStoredFeedback(c.env.DB, feedbackId, user.sub);
  } catch {
    writeFeedbackLog("error", "storage_failed", input.requestId, {
      operation: "idempotency_lookup",
    });
    return c.json({ error: "feedback_storage_unavailable" }, 503);
  }
  if (existing) {
    const status = existing.status === "sent" ? "sent" : "queued";
    writeFeedbackLog("info", "idempotent_replay", input.requestId, { status });
    return c.json({ ok: true, status }, status === "sent" ? 200 : 202);
  }

  const createdAt = feedbackNow();
  const oneHourAgo = feedbackNow(new Date(Date.now() - 60 * 60 * 1000));
  const message = JSON.stringify({
    requestId: input.requestId,
    feedbackKind: input.feedbackKind,
    category: input.category,
    content: input.content,
    appOrigin: input.appOrigin,
    diagnosticSchemaVersion: input.diagnosticSchemaVersion,
  });
  const errorLogsJson = input.errorLogs === null ? null : JSON.stringify(input.errorLogs);
  const deviceInfoJson = input.deviceInfo === null ? null : JSON.stringify(input.deviceInfo);
  try {
    const insert = await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO user_feedback
           (id, family_id, user_id, type, message, error_logs, device_info, current_screen, status, created_at)
         SELECT ?, ?, ?, 'feature_feedback', ?, ?, ?, ?, 'queued', ?
          WHERE (
            SELECT COUNT(*)
              FROM user_feedback
             WHERE user_id = ?
               AND type = 'feature_feedback'
               AND created_at >= ?
          ) < ?`,
      )
      .bind(
        feedbackId,
        input.familyId,
        user.sub,
        message,
        errorLogsJson,
        deviceInfoJson,
        input.currentScreen,
        createdAt,
        user.sub,
        oneHourAgo,
        MAX_FEEDBACK_PER_HOUR,
      )
      .run();
    if (Number(insert.meta?.changes ?? 0) !== 1) {
      const raced = await readStoredFeedback(c.env.DB, feedbackId, user.sub);
      if (raced) {
        const status = raced.status === "sent" ? "sent" : "queued";
        writeFeedbackLog("info", "idempotent_replay", input.requestId, { status });
        return c.json({ ok: true, status }, status === "sent" ? 200 : 202);
      }
      writeFeedbackLog("warn", "rejected", input.requestId, { reason: "rate_limited" });
      return c.json({ error: "feedback_rate_limited" }, 429);
    }
  } catch {
    writeFeedbackLog("error", "storage_failed", input.requestId, {
      operation: "durable_insert",
    });
    return c.json({ error: "feedback_storage_unavailable" }, 503);
  }

  const diagnosticCount = input.errorLogs?.length ?? 0;
  const resendApiKey = c.env.RESEND_API_KEY?.trim() ?? "";
  const fromEmail = c.env.FEEDBACK_FROM_EMAIL?.trim() ?? "";
  const toEmail = c.env.FEEDBACK_TO_EMAIL?.trim() || "tkisdroid@gmail.com";
  if (!resendApiKey || !fromEmail) {
    writeFeedbackLog("info", "accepted_queued", input.requestId, {
      feedbackKind: input.feedbackKind,
      category: input.category,
      diagnosticCount,
      diagnosticSchemaVersion: input.diagnosticSchemaVersion,
      reason: "email_not_configured",
    });
    return c.json({ ok: true, status: "queued" }, 202);
  }

  const kindLabel = FEEDBACK_KIND_LABELS[input.feedbackKind];
  const textBody = [
    `[혜니캘린더] ${kindLabel}`,
    "",
    input.content,
    "",
    `feedbackKind: ${input.feedbackKind}`,
    `category: ${input.category || "선택 안 함"}`,
    `currentScreen: ${input.currentScreen}`,
    `diagnosticSchemaVersion: ${input.diagnosticSchemaVersion ?? "제외함"}`,
    `deviceInfo: ${deviceInfoJson || "제외함"}`,
    `errorLogs: ${errorLogsJson || "제외함"}`,
    `senderName: ${sender.name}`,
    `senderEmail: ${sender.email || "없음"}`,
    `senderRole: ${sender.role}`,
    `senderUserId: ${user.sub}`,
    `familyId: ${input.familyId || "없음"}`,
    `origin: ${input.appOrigin}`,
    `requestId: ${input.requestId}`,
  ].join("\n");

  let delivered = false;
  let providerStatus: number | null = null;
  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `feedback:${user.sub}:${input.requestId}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `[혜니캘린더] ${kindLabel}`,
        text: textBody,
        ...(sender.email ? { reply_to: sender.email } : {}),
      }),
    });
    providerStatus = resendResponse.status;
    delivered = resendResponse.ok;
  } catch {
    delivered = false;
  }
  if (!delivered) {
    writeFeedbackLog("warn", "accepted_queued", input.requestId, {
      feedbackKind: input.feedbackKind,
      category: input.category,
      diagnosticCount,
      diagnosticSchemaVersion: input.diagnosticSchemaVersion,
      reason: providerStatus === null ? "email_network_error" : "email_provider_error",
      providerStatus,
    });
    return c.json({ ok: true, status: "queued" }, 202);
  }

  try {
    await c.env.DB
      .prepare(
        `UPDATE user_feedback
            SET status = 'sent'
          WHERE id = ? AND user_id = ? AND type = 'feature_feedback' AND status = 'queued'`,
      )
      .bind(feedbackId, user.sub)
      .run();
  } catch {
    writeFeedbackLog("error", "status_update_failed", input.requestId, {
      providerStatus,
    });
    return c.json({ ok: true, status: "queued" }, 202);
  }
  writeFeedbackLog("info", "accepted_sent", input.requestId, {
    feedbackKind: input.feedbackKind,
    category: input.category,
    diagnosticCount,
    diagnosticSchemaVersion: input.diagnosticSchemaVersion,
    providerStatus,
  });
  return c.json({ ok: true, status: "sent" });
});

export default feedback;
