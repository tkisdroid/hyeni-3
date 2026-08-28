import { resolveCanonicalFamilyMembership } from "../db/authz";
import { resolveLearningGrade, type ResolvedLearningGrade } from "./learningGrade";
import { isStudyFeatureEnabled } from "./studyFeatureState";
import {
  fingerprintStudyRequest,
  signStudyAuthorization,
  type StudyAuthorizationOperation,
  type StudyAuthorizationRole,
} from "./studyRpcAuthorization";
import type {
  CalendarStudyAuthorizationV2,
  CalendarStudyServiceBinding,
  ResolvedLearningGrade as StudyResolvedLearningGrade,
} from "../contracts/studyRpc";
import { STUDY_API_VERSION } from "../contracts/studyRpc";
import type { AuthUser, Env } from "../types";

const MAX_ID_LENGTH = 128;
const MAX_ANSWER_BYTES = 2_000;
const BINDING_TIMEOUT_MS = 5_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const STUDY_RANGES = new Set(["7d", "30d", "term"]);
const MISSION_MODES = new Set(["daily", "review", "focus"]);

export type StudyRange = "7d" | "30d" | "term";
export type StudyMissionMode = "daily" | "review" | "focus";

export type GatewayChild = Readonly<{
  memberId: string;
  grade: ResolvedLearningGrade;
}>;

/** 내부 birthdate source는 Study binding 경계에서만 locked literal로 바꾼다. */
export function studyRpcGrade(grade: ResolvedLearningGrade | null): StudyResolvedLearningGrade | null {
  if (!grade) return null;
  return {
    grade: grade.grade,
    source: grade.source === "birthdate" ? "hyeni_birth_year" : "parent_override",
    academicYear: grade.academicYear,
  };
}

export type StudyGatewayContext = Readonly<{
  familyId: string;
  actorId: string;
  role: "parent" | "child";
  child: GatewayChild | null;
}>;

export type StudyManagementMutationContext = Readonly<{
  familyId: string;
  actorId: string;
  memberId: string;
}>;

export class StudyGatewayRequestError extends Error {
  readonly status: 400 | 403 | 422;
  readonly code: "invalid_request" | "study_not_available" | "learning_grade_unavailable";

  constructor(status: StudyGatewayRequestError["status"], code: StudyGatewayRequestError["code"]) {
    super(code);
    this.name = "StudyGatewayRequestError";
    this.status = status;
    this.code = code;
  }
}

function invalidRequest(): never {
  throw new StudyGatewayRequestError(400, "invalid_request");
}

function unavailable(): never {
  throw new StudyGatewayRequestError(403, "study_not_available");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function validPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function requireOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalidRequest();
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** JSON은 endpoint가 명시한 own property만 허용한다. */
export async function parseStudyJson(request: Request, keys: readonly string[]): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    invalidRequest();
  }
  if (!validPlainObject(parsed)) invalidRequest();
  requireOnlyKeys(parsed, keys);
  return parsed;
}

/** 재시도 키만 클라이언트가 정할 수 있고, 없으면 request id는 서버가 만든다. */
export function requestIdForStudy(request: Request): string {
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey === null) return crypto.randomUUID();
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) invalidRequest();
  return idempotencyKey;
}

export function studyId(value: unknown): string {
  if (!validId(value)) invalidRequest();
  return value;
}

export function studyRange(value: unknown): StudyRange {
  if (typeof value !== "string" || !STUDY_RANGES.has(value)) invalidRequest();
  return value as StudyRange;
}

export function studyMissionMode(value: unknown): StudyMissionMode {
  if (typeof value !== "string" || !MISSION_MODES.has(value)) invalidRequest();
  return value as StudyMissionMode;
}

export function studyAnswer(value: unknown): string {
  if (typeof value !== "string" || utf8Bytes(value) > MAX_ANSWER_BYTES) invalidRequest();
  return value;
}

type ChildRow = {
  id: string;
  birthdate: string | null;
  learning_grade_override: number | null;
};

async function resolveChild(
  db: D1Database,
  familyId: string,
  memberId: string,
): Promise<GatewayChild> {
  const row = await db.prepare(
    `SELECT id, birthdate, learning_grade_override
       FROM family_members
      WHERE id=? AND family_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(memberId, familyId).first<ChildRow>();
  if (!row?.id) unavailable();
  try {
    return {
      memberId: row.id,
      grade: resolveLearningGrade({ birthdate: row.birthdate, overrideGrade: row.learning_grade_override }, new Date()),
    };
  } catch {
    throw new StudyGatewayRequestError(422, "learning_grade_unavailable");
  }
}

async function resolveOwnChild(db: D1Database, familyId: string, actorId: string): Promise<GatewayChild> {
  const row = await db.prepare(
    `SELECT id, birthdate, learning_grade_override
       FROM family_members
      WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(familyId, actorId).first<ChildRow>();
  if (!row?.id) unavailable();
  return resolveChild(db, familyId, row.id);
}

async function assertActiveParent(db: D1Database, familyId: string, actorId: string): Promise<void> {
  const parent = await db.prepare(
    `SELECT 1 AS ok FROM family_members
      WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1
      LIMIT 1`,
  ).bind(familyId, actorId).first<{ ok: number }>();
  if (!parent) unavailable();
}

async function resolveStudyAccessContext(
  env: Pick<Env, "DB" | "STUDY_RPC_HMAC_SECRET">,
  user: AuthUser,
  role: "parent" | "child",
): Promise<Readonly<{ familyId: string; actorId: string; role: "parent" | "child" }>> {
  let membership: Awaited<ReturnType<typeof resolveCanonicalFamilyMembership>>;
  try {
    membership = await resolveCanonicalFamilyMembership(env.DB, user.sub, null);
  } catch {
    unavailable();
  }
  if (!membership || membership.role !== role) unavailable();

  if (role === "parent") await assertActiveParent(env.DB, membership.familyId, user.sub);

  let family: { study_market: string | null } | null;
  try {
    family = await env.DB.prepare("SELECT study_market FROM families WHERE id=? LIMIT 1")
      .bind(membership.familyId)
      .first<{ study_market: string | null }>();
  } catch {
    unavailable();
  }
  if (family?.study_market !== "KR") unavailable();

  let enabled = false;
  try {
    enabled = await isStudyFeatureEnabled(env.DB, {
      familyId: membership.familyId,
      role: membership.role,
      rolloutSecret: env.STUDY_RPC_HMAC_SECRET,
    });
  } catch {
    enabled = false;
  }
  if (!enabled) unavailable();

  return { familyId: membership.familyId, actorId: user.sub, role: membership.role };
}

/** 학년 override는 기존 자동 학년을 계산하지 않고도 canonical KR 관리 경계와 exact active child를 검증한다. */
export async function resolveStudyManagementMutationContext(
  env: Pick<Env, "DB" | "STUDY_RPC_HMAC_SECRET">,
  user: AuthUser,
  memberId: string,
): Promise<StudyManagementMutationContext> {
  const context = await resolveStudyAccessContext(env, user, "parent");
  let child: { id: string } | null;
  try {
    child = await env.DB.prepare(
      `SELECT id FROM family_members
        WHERE id=? AND family_id=? AND role='child' AND is_active=1
        LIMIT 1`,
    ).bind(memberId, context.familyId).first<{ id: string }>();
  } catch {
    unavailable();
  }
  if (!child?.id) unavailable();
  return { familyId: context.familyId, actorId: context.actorId, memberId: child.id };
}

/**
 * token snapshot이나 client family/member 값 대신 현재 membership, 활성 행, KR market과 rollout을 다시 판정한다.
 * childMemberId는 parent route의 명시 대상일 때만 사용하며 child caller에는 항상 무시된다.
 */
export async function resolveStudyGatewayContext(
  env: Pick<Env, "DB" | "STUDY_RPC_HMAC_SECRET">,
  user: AuthUser,
  input: { role: "parent" | "child"; childMemberId?: string },
): Promise<StudyGatewayContext> {
  const context = await resolveStudyAccessContext(env, user, input.role);

  const child = input.role === "child"
    ? await resolveOwnChild(env.DB, context.familyId, user.sub)
    : input.childMemberId === undefined
      ? null
      : await resolveChild(env.DB, context.familyId, input.childMemberId);
  return { ...context, child };
}

/** 부모 children 목록은 활성 child만 각 요청 시점의 grade로 만든다. 지원 학년이 아닌 child는 null로만 내려 보낸다. */
export async function resolveStudyChildren(
  db: D1Database,
  familyId: string,
): Promise<readonly Readonly<{ memberId: string; grade: ResolvedLearningGrade | null }>[]> {
  const { results } = await db.prepare(
    `SELECT id, birthdate, learning_grade_override
       FROM family_members
      WHERE family_id=? AND role='child' AND is_active=1
      ORDER BY created_at ASC, rowid ASC`,
  ).bind(familyId).all<ChildRow>();
  const now = new Date();
  return (results ?? []).map((row) => {
    try {
      return {
        memberId: row.id,
        grade: resolveLearningGrade({ birthdate: row.birthdate, overrideGrade: row.learning_grade_override }, now),
      };
    } catch {
      return { memberId: row.id, grade: null };
    }
  });
}

type StudyBindingCall<T> = (binding: CalendarStudyServiceBinding, auth: CalendarStudyAuthorizationV2) => Promise<T>;

/** readiness·서명·business RPC가 공유하는 전체 binding 대기 예산이다. */
async function withinBindingDeadline<T>(deadlineAt: number, call: () => Promise<T>): Promise<T> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new Error("study_binding_timeout");

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("study_binding_timeout")), remainingMs);
    });
    return await Promise.race([call(), timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** status와 business RPC가 같은 5초 예산·API version 판정을 공유한다. */
export async function isStudyBindingReady(
  binding: CalendarStudyServiceBinding | null | undefined,
  deadlineAt = Date.now() + BINDING_TIMEOUT_MS,
): Promise<boolean> {
  if (!binding) return false;
  try {
    const readiness = await withinBindingDeadline(deadlineAt, () => binding.readiness());
    return !!readiness
      && readiness.apiVersion === STUDY_API_VERSION
      && readiness.status === "ready";
  } catch {
    return false;
  }
}

/** 서명은 모든 Calendar-side gate가 끝난 직후, 실제 binding 호출 직전에만 발급한다. */
export async function callStudyBinding<T>(
  env: Pick<Env, "STUDY_SERVICE" | "STUDY_RPC_HMAC_SECRET">,
  context: StudyGatewayContext,
  input: unknown,
  operation: StudyAuthorizationOperation,
  role: StudyAuthorizationRole,
  requestId: string,
  call: StudyBindingCall<T>,
): Promise<T> {
  const binding = env.STUDY_SERVICE;
  if (!binding) throw new Error("study_binding_unavailable");
  const deadlineAt = Date.now() + BINDING_TIMEOUT_MS;
  if (!(await isStudyBindingReady(binding, deadlineAt))) {
    throw new Error("study_binding_version_unavailable");
  }

  // Study가 재계산할 수 있는 값만 fingerprint에 넣는다. 내부 birthdate literal은 RPC 경계를 넘지 않는다.
  const rpcGrade = studyRpcGrade(context.child?.grade ?? null);
  const fingerprint = await fingerprintStudyRequest({ input, memberId: context.child?.memberId ?? null, grade: rpcGrade });
  const auth = await signStudyAuthorization({
    actorId: context.actorId,
    familyId: context.familyId,
    memberId: context.child?.memberId ?? null,
    role,
    operation,
    grade: context.child?.grade ?? null,
    requestId,
    fingerprint,
  }, env.STUDY_RPC_HMAC_SECRET);
  return withinBindingDeadline(deadlineAt, () => call(binding, auth));
}

/** Binding 예외는 Study 영역의 고정 503으로만 바꾼다. */
export async function studyResponse<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await call() };
  } catch {
    console.warn("[study-gateway] Study binding unavailable");
    return { ok: false };
  }
}
