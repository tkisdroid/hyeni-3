import { STUDY_API_VERSION } from "../contracts/studyRpc";

const encoder = new TextEncoder();
const MAX_TTL_MS = 300_000;
const MAX_FUTURE_SKEW_MS = 30_000;

export type StudyAuthorizationRole = "guardian" | "primary" | "learner" | "system_cleanup";

export type StudyAuthorizationOperation =
  | "guardian.children"
  | "guardian.overview"
  | "guardian.report"
  | "guardian.grade"
  | "primary.service-country"
  | "learner.state"
  | "learner.start"
  | "learner.get"
  | "learner.submit"
  | "system.cleanup";

export interface StudyAuthorizationGrade {
  grade: 3 | 4 | 5 | 6;
  source: "birthdate" | "parent_override";
  academicYear: number;
}

export interface SignedStudyAuthorization {
  apiVersion: typeof STUDY_API_VERSION;
  role: StudyAuthorizationRole;
  operation: StudyAuthorizationOperation;
  actorRef: string;
  familyId: string;
  memberId?: string;
  studyMarket: "KR";
  grade?: StudyAuthorizationGrade;
  requestId: string;
  fingerprint: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}

export interface SignStudyAuthorizationInput {
  actorId: string;
  familyId: string;
  memberId?: string;
  role: StudyAuthorizationRole;
  operation: StudyAuthorizationOperation;
  studyMarket?: "KR";
  grade?: StudyAuthorizationGrade;
  requestId: string;
  fingerprint: string;
  now?: Date;
  ttlSeconds?: number;
  nonce?: string;
}

export interface VerifyStudyAuthorizationInput {
  secret: string;
  operation: StudyAuthorizationOperation;
  now?: Date;
}

type StudyAuthorizationPolicy = Readonly<{
  role: StudyAuthorizationRole;
  memberRequired: boolean;
  gradeRequired: boolean;
}>;

export const STUDY_ROUTE_AUTHORIZATION_OPERATIONS = {
  children: "guardian.children",
  overview: "guardian.overview",
  report: "guardian.report",
  grade: "guardian.grade",
  serviceCountry: "primary.service-country",
  learnerState: "learner.state",
  learnerStart: "learner.start",
  learnerGet: "learner.get",
  learnerSubmit: "learner.submit",
} as const satisfies Record<string, StudyAuthorizationOperation>;

const POLICIES: Readonly<Record<StudyAuthorizationOperation, StudyAuthorizationPolicy>> = {
  "guardian.children": { role: "guardian", memberRequired: false, gradeRequired: false },
  "guardian.overview": { role: "guardian", memberRequired: true, gradeRequired: true },
  "guardian.report": { role: "guardian", memberRequired: true, gradeRequired: true },
  "guardian.grade": { role: "guardian", memberRequired: true, gradeRequired: true },
  "primary.service-country": { role: "primary", memberRequired: false, gradeRequired: false },
  "learner.state": { role: "learner", memberRequired: true, gradeRequired: true },
  "learner.start": { role: "learner", memberRequired: true, gradeRequired: true },
  "learner.get": { role: "learner", memberRequired: true, gradeRequired: true },
  "learner.submit": { role: "learner", memberRequired: true, gradeRequired: true },
  "system.cleanup": { role: "system_cleanup", memberRequired: true, gradeRequired: false },
};

export class StudyRpcAuthorizationError extends Error {
  readonly code:
    | "authorization_ttl_invalid"
    | "authorization_invalid"
    | "authorization_role_forbidden"
    | "authorization_scope_mismatch"
    | "authorization_expired"
    | "authorization_future"
    | "authorization_signature_invalid";

  constructor(code: StudyRpcAuthorizationError["code"]) {
    super(code);
    this.name = "StudyRpcAuthorizationError";
    this.code = code;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function isNonEmptyLine(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\r\n]/u.test(value);
}

function validGrade(value: unknown): value is StudyAuthorizationGrade {
  if (!value || typeof value !== "object") return false;
  const grade = value as Partial<StudyAuthorizationGrade>;
  const academicYear = grade.academicYear;
  return (grade.grade === 3 || grade.grade === 4 || grade.grade === 5 || grade.grade === 6)
    && (grade.source === "birthdate" || grade.source === "parent_override")
    && Number.isInteger(academicYear)
    && academicYear !== undefined
    && academicYear >= 2022
    && academicYear <= 2200;
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : parsed;
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new StudyRpcAuthorizationError("authorization_invalid");
  return now;
}

function policyFor(operation: StudyAuthorizationOperation): StudyAuthorizationPolicy {
  const policy = POLICIES[operation];
  if (!policy) throw new StudyRpcAuthorizationError("authorization_invalid");
  return policy;
}

function assertScope(value: Pick<SignedStudyAuthorization, "role" | "operation" | "memberId" | "grade">): void {
  const policy = policyFor(value.operation);
  if (value.role !== policy.role) throw new StudyRpcAuthorizationError("authorization_role_forbidden");
  if (policy.memberRequired !== !!value.memberId || policy.gradeRequired !== !!value.grade) {
    throw new StudyRpcAuthorizationError("authorization_invalid");
  }
  if (value.grade && !validGrade(value.grade)) throw new StudyRpcAuthorizationError("authorization_invalid");
}

/** Study backend verifier와 공유하는 CalendarStudyAuthorizationV2 서명 원문이다. */
export function canonicalStudyAuthorizationPayload(value: Omit<SignedStudyAuthorization, "signature">): string {
  return [
    value.apiVersion,
    value.role,
    value.operation,
    value.actorRef,
    value.familyId,
    value.memberId ?? "",
    value.studyMarket,
    value.grade?.grade ?? "",
    value.grade?.source ?? "",
    value.grade?.academicYear ?? "",
    value.requestId,
    value.fingerprint,
    value.issuedAt,
    value.expiresAt,
    value.nonce,
  ].join("\n");
}

async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  if (!isNonEmptyLine(secret)) throw new StudyRpcAuthorizationError("authorization_invalid");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

async function hmacVerify(secret: string, payload: string, signature: string): Promise<boolean> {
  const signatureBytes = base64UrlToBytes(signature);
  if (!signatureBytes || !isNonEmptyLine(secret)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StudyRpcAuthorizationError("authorization_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new StudyRpcAuthorizationError("authorization_invalid");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** 서버가 정규화한 Study 입력만 fingerprint로 만들며 원문을 저장하거나 로그에 남기지 않는다. */
export async function fingerprintStudyRequest(request: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalJson(request)));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** Calendar actor의 raw ID를 Study 감사용 전용 가명값으로 바꾼다. */
export async function actorRefForStudy(actorId: string, secret: string): Promise<string> {
  if (!isNonEmptyLine(actorId)) throw new StudyRpcAuthorizationError("authorization_invalid");
  return bytesToBase64Url(await hmacSha256(secret, `study-actor-ref:v1:${actorId}`));
}

export async function signStudyAuthorization(input: SignStudyAuthorizationInput, secret: string): Promise<SignedStudyAuthorization> {
  const now = validNow(input.now);
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 300) {
    throw new StudyRpcAuthorizationError("authorization_ttl_invalid");
  }
  if (!isNonEmptyLine(input.familyId) || !isNonEmptyLine(input.requestId) || !isNonEmptyLine(input.fingerprint)) {
    throw new StudyRpcAuthorizationError("authorization_invalid");
  }
  if (input.memberId !== undefined && !isNonEmptyLine(input.memberId)) throw new StudyRpcAuthorizationError("authorization_invalid");
  const nonce = input.nonce ?? crypto.randomUUID();
  if (!isNonEmptyLine(nonce) || input.studyMarket !== undefined && input.studyMarket !== "KR") {
    throw new StudyRpcAuthorizationError("authorization_invalid");
  }

  const authorization: Omit<SignedStudyAuthorization, "signature"> = {
    apiVersion: STUDY_API_VERSION,
    role: input.role,
    operation: input.operation,
    actorRef: await actorRefForStudy(input.actorId, secret),
    familyId: input.familyId,
    ...(input.memberId === undefined ? {} : { memberId: input.memberId }),
    studyMarket: "KR",
    ...(input.grade === undefined ? {} : { grade: input.grade }),
    requestId: input.requestId,
    fingerprint: input.fingerprint,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
    nonce,
  };
  assertScope(authorization);
  return { ...authorization, signature: bytesToBase64Url(await hmacSha256(secret, canonicalStudyAuthorizationPayload(authorization))) };
}

/** Study의 독립 verifier와 같은 envelope 검증을 Calendar test에서 재현한다. */
export async function verifyStudyAuthorization(
  authorization: SignedStudyAuthorization,
  input: VerifyStudyAuthorizationInput,
): Promise<void> {
  const now = validNow(input.now);
  if (authorization.operation !== input.operation) throw new StudyRpcAuthorizationError("authorization_scope_mismatch");
  if (
    authorization.apiVersion !== STUDY_API_VERSION
    || authorization.studyMarket !== "KR"
    || !isNonEmptyLine(authorization.actorRef)
    || !isNonEmptyLine(authorization.familyId)
    || (authorization.memberId !== undefined && !isNonEmptyLine(authorization.memberId))
    || !isNonEmptyLine(authorization.requestId)
    || !isNonEmptyLine(authorization.fingerprint)
    || !isNonEmptyLine(authorization.nonce)
    || !isNonEmptyLine(authorization.signature)
  ) throw new StudyRpcAuthorizationError("authorization_invalid");
  assertScope(authorization);
  const issuedAt = validDate(authorization.issuedAt);
  const expiresAt = validDate(authorization.expiresAt);
  if (!issuedAt || !expiresAt || expiresAt.getTime() <= issuedAt.getTime() || expiresAt.getTime() - issuedAt.getTime() > MAX_TTL_MS) {
    throw new StudyRpcAuthorizationError("authorization_ttl_invalid");
  }
  if (issuedAt.getTime() - now.getTime() > MAX_FUTURE_SKEW_MS) throw new StudyRpcAuthorizationError("authorization_future");
  if (expiresAt.getTime() <= now.getTime()) throw new StudyRpcAuthorizationError("authorization_expired");
  if (!(await hmacVerify(input.secret, canonicalStudyAuthorizationPayload(authorization), authorization.signature))) {
    throw new StudyRpcAuthorizationError("authorization_signature_invalid");
  }
}
