export type OperationalLogLevel = "error" | "info" | "warn";
export type OperationalLogProvider =
  | "fcm"
  | "google"
  | "kakao"
  | "naver"
  | "qonversion"
  | "resend"
  | "toss"
  | "web_push";

export interface OperationalLogFields {
  count?: unknown;
  provider?: unknown;
  status?: unknown;
}

const EVENT_PATTERN = /^[a-z][a-z0-9_]{2,95}$/;
const PROVIDERS = new Set<OperationalLogProvider>([
  "fcm",
  "google",
  "kakao",
  "naver",
  "qonversion",
  "resend",
  "toss",
  "web_push",
]);

function normalizeEvent(event: unknown): string {
  return typeof event === "string" && EVENT_PATTERN.test(event)
    ? event
    : "operational_log_invalid_event";
}

function normalizeProvider(value: unknown): OperationalLogProvider | undefined {
  return typeof value === "string" && PROVIDERS.has(value as OperationalLogProvider)
    ? value as OperationalLogProvider
    : undefined;
}

function normalizeStatus(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    ? value
    : undefined;
}

function normalizeCount(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

/**
 * 운영 로그에는 고정 이벤트와 제한된 집계값·공급자·HTTP 상태만 기록한다.
 * Error, 요청 경로, 식별자, payload, 응답 본문은 타입과 런타임 allowlist 양쪽에서 버린다.
 */
export function buildOperationalLog(event: unknown, fields: OperationalLogFields = {}) {
  const normalizedEvent = normalizeEvent(event);
  const provider = normalizeProvider(fields.provider);
  const status = normalizeStatus(fields.status);
  const count = normalizedEvent === "location_confirmation_retention_batch_saturated"
    ? normalizeCount(fields.count)
    : undefined;
  return {
    scope: "worker" as const,
    event: normalizedEvent,
    ...(count === undefined ? {} : { count }),
    ...(provider === undefined ? {} : { provider }),
    ...(status === undefined ? {} : { status }),
  };
}

export function writeOperationalLog(
  level: OperationalLogLevel,
  event: unknown,
  fields: OperationalLogFields = {},
): void {
  const entry = buildOperationalLog(event, fields);
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}
