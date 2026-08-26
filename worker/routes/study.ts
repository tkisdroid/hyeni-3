import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Env, Vars } from "../types";
import type {
  ChildrenOverviewDto,
  StudyRange,
} from "../contracts/studyRpc";
import { requireAuth } from "../middleware/auth";
import { resolveCorsOrigin } from "../lib/corsOrigin";
import { actorRefForStudy } from "../lib/studyActorRef";
import {
  StudyAccessError,
  calendarStudyChild,
  listCalendarStudyChildren,
  requireStudyChild,
  requireStudyParent,
} from "../lib/studyAccess";
import { studyFeatureState } from "../lib/studyFeature";

type StudyApp = { Bindings: Env; Variables: Vars };
type StudyAuthMiddleware = MiddlewareHandler<StudyApp>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const MAX_JSON_BYTES = 16 * 1024;

function stableError(code: string, status: 400 | 403 | 404 | 413 | 503): Response {
  return Response.json({ error: code, code }, { status });
}

function requireMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin") ?? "";
  return Boolean(origin && resolveCorsOrigin(origin) === origin.trim());
}

function idempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return UUID_PATTERN.test(value) ? value : null;
}

async function boundedJson(request: Request): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; code: "invalid_json" | "payload_too_large" }
> {
  const rawLength = request.headers.get("Content-Length")?.trim() ?? "";
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > MAX_JSON_BYTES) {
    return { ok: false, status: 413, code: "payload_too_large" };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
    return { ok: false, status: 413, code: "payload_too_large" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }
}

function rangeFrom(raw: string | undefined): StudyRange | null {
  return raw === "7d" || raw === "30d" || raw === "term" ? raw : null;
}

function overviewByMember(
  result: ChildrenOverviewDto,
  requestedMemberIds: readonly string[],
): Map<string, ChildrenOverviewDto["children"][number]> {
  if (result.apiVersion !== "2026-08-24" || !Array.isArray(result.children)) {
    throw new Error("study_invalid_response");
  }
  const allowed = new Set(requestedMemberIds);
  const mapped = new Map<string, ChildrenOverviewDto["children"][number]>();
  for (const child of result.children) {
    if (!child || !allowed.has(child.memberId) || mapped.has(child.memberId)) continue;
    mapped.set(child.memberId, child);
  }
  return mapped;
}

function studyBinding(env: Env) {
  if (!env.STUDY_SERVICE) throw new Error("study_binding_unavailable");
  return env.STUDY_SERVICE;
}

function requirePrimary(primary: boolean): void {
  if (!primary) throw new StudyAccessError(403, "study_parent_required");
}

async function mutationContext(c: Context<StudyApp>) {
  if (!requireMutationOrigin(c.req.raw)) return { error: stableError("invalid_origin", 403) } as const;
  const requestId = idempotencyKey(c.req.raw);
  if (!requestId) return { error: stableError("invalid_idempotency_key", 400) } as const;
  const user = c.get("user");
  const memberId = String(c.req.param("memberId") ?? "").trim();
  const child = await requireStudyChild(c.env.DB, user.sub, memberId, user.family_id);
  requirePrimary(child.primary);
  const actorRef = await actorRefForStudy(user.sub, c.env.STUDY_ACTOR_REF_SECRET ?? "");
  return { requestId, child, actorRef } as const;
}

export function createStudyRoutes(
  authMiddleware: StudyAuthMiddleware = requireAuth,
): Hono<StudyApp> {
  const study = new Hono<StudyApp>();

  study.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "private, no-store");
  });
  study.use("*", authMiddleware);

  study.get("/status", async (c) => {
    const user = c.get("user");
    await requireStudyParent(c.env.DB, user.sub, user.family_id);
    return c.json({ state: await studyFeatureState(c.env) });
  });

  study.get("/children", async (c) => {
    const user = c.get("user");
    const parent = await requireStudyParent(c.env.DB, user.sub, user.family_id);
    const calendarChildren = await listCalendarStudyChildren(c.env.DB, parent.familyId);
    const memberIds = calendarChildren.map((child) => child.memberId);
    const result = await studyBinding(c.env).getChildrenOverview(
      parent.familyId,
      memberIds,
      crypto.randomUUID(),
    );
    const overview = overviewByMember(result, memberIds);
    return c.json({
      children: calendarChildren.map((child) => {
        const item = overview.get(child.memberId);
        return {
          ...child,
          linked: item?.linked ?? false,
          grade: item?.grade ?? null,
          canManageLinks: parent.primary,
        };
      }),
    });
  });

  study.get("/children/:memberId/overview", async (c) => {
    const user = c.get("user");
    const child = await requireStudyChild(c.env.DB, user.sub, c.req.param("memberId"), user.family_id);
    const result = await studyBinding(c.env).getChildrenOverview(
      child.familyId,
      [child.memberId],
      crypto.randomUUID(),
    );
    return c.json({
      child: await calendarStudyChild(c.env.DB, child.familyId, child.memberId),
      overview: overviewByMember(result, [child.memberId]).get(child.memberId) ?? null,
      permissions: { canManageLinks: child.primary },
    });
  });

  study.get("/children/:memberId/report", async (c) => {
    const range = rangeFrom(c.req.query("range") ?? "7d");
    if (!range) return stableError("invalid_study_range", 400);
    const user = c.get("user");
    const child = await requireStudyChild(c.env.DB, user.sub, c.req.param("memberId"), user.family_id);
    const report = await studyBinding(c.env).getChildReport(
      child.familyId,
      child.memberId,
      range,
      crypto.randomUUID(),
    );
    if (
      report.apiVersion !== "2026-08-24"
      || report.memberId !== child.memberId
      || report.range !== range
    ) throw new Error("study_invalid_response");
    return c.json({
      child: await calendarStudyChild(c.env.DB, child.familyId, child.memberId),
      report,
      permissions: { canManageLinks: child.primary },
    });
  });

  study.get("/children/:memberId/devices", async (c) => {
    const user = c.get("user");
    const child = await requireStudyChild(c.env.DB, user.sub, c.req.param("memberId"), user.family_id);
    const devices = await studyBinding(c.env).listLearnerDevices(
      child.familyId,
      child.memberId,
      crypto.randomUUID(),
    );
    return c.json({ devices, permissions: { canManageLinks: child.primary } });
  });

  study.post("/children/:memberId/attach-challenges", async (c) => {
    const mutation = await mutationContext(c);
    if ("error" in mutation) return mutation.error;
    const challenge = await studyBinding(c.env).createAttachChallenge(
      mutation.child.familyId,
      mutation.child.memberId,
      mutation.actorRef,
      mutation.requestId,
    );
    return c.json({ challenge, permissions: { canManageLinks: true } });
  });

  study.post("/children/:memberId/claim", async (c) => {
    const mutation = await mutationContext(c);
    if ("error" in mutation) return mutation.error;
    const parsed = await boundedJson(c.req.raw);
    if (!parsed.ok) return stableError(parsed.code, parsed.status);
    const claimToken = typeof parsed.value === "object" && parsed.value !== null
      ? String((parsed.value as { claimToken?: unknown }).claimToken ?? "").trim()
      : "";
    if (!CLAIM_TOKEN_PATTERN.test(claimToken)) return stableError("invalid_claim_token", 400);
    const result = await studyBinding(c.env).consumeGuestClaim(
      mutation.child.familyId,
      mutation.child.memberId,
      claimToken,
      mutation.actorRef,
      mutation.requestId,
    );
    return c.json({ result, permissions: { canManageLinks: true } });
  });

  study.delete("/children/:memberId/devices/:deviceSessionId", async (c) => {
    const mutation = await mutationContext(c);
    if ("error" in mutation) return mutation.error;
    const deviceSessionId = c.req.param("deviceSessionId").trim();
    if (!UUID_PATTERN.test(deviceSessionId)) return stableError("invalid_device_session_id", 400);
    const receipt = await studyBinding(c.env).revokeLearnerDevice(
      mutation.child.familyId,
      mutation.child.memberId,
      deviceSessionId,
      mutation.actorRef,
      mutation.requestId,
    );
    return c.json({ receipt, permissions: { canManageLinks: true } });
  });

  study.onError((error, c) => {
    if (error instanceof StudyAccessError) {
      return c.json({ error: error.code, code: error.code }, error.status);
    }
    console.error("[study] gateway unavailable");
    return c.json(
      { error: "study_unavailable", code: "study_unavailable" },
      503,
    );
  });
  return study;
}

export default createStudyRoutes();
