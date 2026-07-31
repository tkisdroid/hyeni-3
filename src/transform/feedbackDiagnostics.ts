export const FEEDBACK_DIAGNOSTIC_EVENT_LIMIT = 12;
export const FEEDBACK_DIAGNOSTIC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FeedbackDiagnosticKind =
  | "api"
  | "mutation"
  | "rejection"
  | "render"
  | "runtime";

export interface FeedbackDiagnosticEvent {
  at: string;
  kind: FeedbackDiagnosticKind;
  code: string;
  screen: string;
  count?: number;
  status?: number;
  method?: string;
  path?: string;
  source?: string;
}

const STABLE_CODE_PATTERN = /^(?:[A-Za-z][A-Za-z0-9]*(?:[._:-][A-Za-z0-9]+)+|[A-Z][A-Za-z0-9]*(?:Error|Exception))$/;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._:-]{1,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i;
const OPAQUE_SEGMENT_PATTERN = /^(?:KID-|eyJ|[A-Za-z0-9_-]{24,})/;
const METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);

function safeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return ":value";
  }
  if (!decoded) return "";
  if (/^-?\d+(?:\.\d+)?$/.test(decoded)) return ":n";
  if (UUID_PATTERN.test(decoded) || OPAQUE_SEGMENT_PATTERN.test(decoded)) return ":id";
  return SAFE_SEGMENT_PATTERN.test(decoded) ? decoded : ":value";
}

/**
 * API·라우트 문자열에서 query/hash와 사용자 식별자 후보를 제거한다.
 * 진단에는 endpoint 구조만 필요하고 pair code·UUID·토큰은 필요하지 않다.
 */
export function normalizeFeedbackDiagnosticPath(value: unknown): string {
  if (typeof value !== "string") return "/unknown";
  const withoutFragment = value.trim().replace(/^#/, "").split(/[?#]/, 1)[0] ?? "";
  const rawPath = withoutFragment.startsWith("/") ? withoutFragment : `/${withoutFragment}`;
  const segments = rawPath.split("/").map(safeSegment).filter(Boolean);
  return `/${segments.join("/")}`.slice(0, 180) || "/unknown";
}

export function normalizeFeedbackDiagnosticScreen(value: unknown): string {
  const path = normalizeFeedbackDiagnosticPath(value);
  return path === "/" ? "/unknown" : path;
}

/** 사용자 문장 전체를 저장하지 않고 안정적인 오류 코드·클래스만 남긴다. */
export function normalizeFeedbackDiagnosticCode(error: unknown): string {
  const record = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; name?: unknown }
    : null;
  const candidates = [
    record?.code,
    record?.message,
    typeof error === "string" ? error : null,
    record?.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    const httpMatch = /^API\s+(\d{3})$/i.exec(normalized);
    if (httpMatch) return `http_${httpMatch[1]}`;
    if (normalized.length <= 80 && STABLE_CODE_PATTERN.test(normalized)) return normalized;
  }
  return "unexpected_error";
}

export function normalizeFeedbackDiagnosticMethod(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const method = value.trim().toUpperCase();
  return METHODS.has(method) ? method : undefined;
}

export function normalizeFeedbackDiagnosticSource(
  fileName: unknown,
  line: unknown,
  column: unknown,
): string | undefined {
  if (typeof fileName !== "string" || !fileName.trim()) return undefined;
  const path = fileName.split(/[?#]/, 1)[0] ?? "";
  const basename = path.split("/").pop()?.split("\\").pop() ?? "";
  if (!/^[A-Za-z0-9._-]{1,92}\.(?:css|js|jsx|mjs|ts|tsx)$/i.test(basename)) return undefined;
  const lineNumber = typeof line === "number" && Number.isInteger(line) && line > 0 ? line : null;
  const columnNumber = typeof column === "number" && Number.isInteger(column) && column > 0
    ? column
    : null;
  return [
    basename,
    lineNumber === null ? null : String(lineNumber),
    columnNumber === null ? null : String(columnNumber),
  ].filter(Boolean).join(":");
}

function eventSignature(event: FeedbackDiagnosticEvent): string {
  return [
    event.kind,
    event.code,
    event.status ?? "",
    event.method ?? "",
    event.path ?? "",
    event.screen,
    event.source ?? "",
  ].join("|");
}

export function appendFeedbackDiagnosticEvent(
  current: readonly FeedbackDiagnosticEvent[],
  event: FeedbackDiagnosticEvent,
  nowMs = Date.now(),
): FeedbackDiagnosticEvent[] {
  const cutoff = nowMs - FEEDBACK_DIAGNOSTIC_MAX_AGE_MS;
  const fresh = current.filter((candidate) => {
    const timestamp = Date.parse(candidate.at);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs + 60_000;
  });
  const signature = eventSignature(event);
  const duplicateIndex = fresh.findIndex((candidate) => eventSignature(candidate) === signature);
  if (duplicateIndex >= 0) {
    const duplicate = fresh[duplicateIndex];
    fresh.splice(duplicateIndex, 1);
    fresh.push({
      ...event,
      count: Math.min(999, Math.max(1, duplicate.count ?? 1) + 1),
    });
  } else {
    fresh.push({ ...event, count: Math.max(1, event.count ?? 1) });
  }
  return fresh.slice(-FEEDBACK_DIAGNOSTIC_EVENT_LIMIT);
}
