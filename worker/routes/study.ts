import { Hono, type Context } from "hono";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { changeLearningGrade, LearningGradeUnavailableError } from "../lib/learningGrade";
import { acquireAccountMutationLease, releaseAccountMutationLease } from "../lib/accountMutationLease";
import { requireAuth } from "../middleware/auth";
import { resolveStudyFeatureAccess } from "../lib/studyFeatureState";
import {
  StudyGatewayRequestError,
  callStudyBinding,
  isStudyBindingReady,
  parseStudyJson,
  requestIdForStudy,
  resolveStudyChildren,
  resolveStudyGatewayContext,
  resolveStudyManagementMutationContext,
  studyAnswer,
  studyGrade,
  studyId,
  studyMissionMode,
  studyRpcGrade,
  studyRange,
  studyResponse,
} from "../lib/studyGateway";
export { STUDY_ROUTE_AUTHORIZATION_OPERATIONS } from "../lib/studyRpcAuthorization";
import type {
  CalendarMissionInput,
  ChildReportInput,
  LearnerStateInput,
  ParentOverviewInput,
  StartCalendarMissionInput,
  SubmitCalendarAnswerInput,
} from "../contracts/studyRpc";
import type { Env, Vars } from "../types";

export const study = new Hono<{ Bindings: Env; Variables: Vars }>();

// requireAuth의 조기 401/503도 포함해 Study 상태 응답 전체를 저장하지 않는다.
study.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

study.get("/status", requireAuth, async (c) => {
  const user = c.get("user");
  let membership: Awaited<ReturnType<typeof resolveCanonicalFamilyMembership>>;
  try {
    // token의 family_id는 과거 snapshot일 수 있으므로 요청 본문·토큰 값 대신 현재 membership만 쓴다.
    membership = await resolveCanonicalFamilyMembership(c.env.DB, user.sub, null);
  } catch {
    console.error("[study-status] membership resolution failed");
    return c.json({ state: "unavailable" }, 503);
  }
  if (!membership) return c.json({ state: "no_family" });

  let family: {
    parent_id: string;
    service_country: string | null;
    service_country_source: string | null;
    study_market: string | null;
  } | null;
  try {
    family = await c.env.DB.prepare(
      `SELECT parent_id, service_country, service_country_source, study_market
         FROM families
        WHERE id=?
        LIMIT 1`,
    ).bind(membership.familyId).first<{
      parent_id: string;
      service_country: string | null;
      service_country_source: string | null;
      study_market: string | null;
    }>();
  } catch {
    console.error("[study-status] market resolution failed");
    return c.json({ state: "unavailable" }, 503);
  }
  if (!family) return c.json({ state: "no_family" });
  if (family.study_market !== "KR") {
    const confirmedOutsideMarket = family.service_country !== "KR"
      && family.service_country
      && (family.service_country_source === "guardian_confirmed" || family.service_country_source === "guardian_changed");
    if (confirmedOutsideMarket) return c.json({ state: "outside_market" });
    const inferredCountry = /^[A-Z]{2}$/u.test(family.service_country ?? "") ? family.service_country : null;
    return c.json({
      state: "not_confirmed",
      inferredCountry,
      canConfirm: membership.role === "parent" && family.parent_id === user.sub,
    });
  }

  const access = await resolveStudyFeatureAccess(c.env.DB, {
    familyId: membership.familyId,
    role: membership.role,
    rolloutSecret: c.env.STUDY_RPC_HMAC_SECRET,
  });
  const enabled = access?.rolloutEligible === true
    && (membership.role === "parent" ? access.managementEnabled : access.learnerEnabled);
  if (!enabled || !access) return c.json({ state: "feature_disabled" });

  return await isStudyBindingReady(c.env.STUDY_SERVICE)
    ? c.json({
        state: "enabled",
        market: "KR",
        role: membership.role,
        managementEnabled: access.managementEnabled,
        learnerEnabled: access.learnerEnabled,
      })
    : c.json({ state: "unavailable" }, 503);
});

function gatewayError(c: Context<{ Bindings: Env; Variables: Vars }>, error: unknown) {
  if (error instanceof StudyGatewayRequestError) return c.json({ error: error.code }, error.status);
  console.warn("[study-gateway] request gate unavailable");
  return c.json({ error: "study_unavailable" }, 503);
}

// 부모 overview는 7일 요약을 사용하고, report만 caller가 range를 고른다.
// PUT grade는 아래의 Calendar D1 override mutation이며 Study binding route가 아니다.
study.get("/children", requireAuth, async (c) => {
  try {
    const requestId = requestIdForStudy(c.req.raw);
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "parent" });
    const children = (await resolveStudyChildren(c.env.DB, context.familyId)).map(({ memberId, grade }) => ({
      memberId,
      grade: studyRpcGrade(grade),
    }));
    const input: ParentOverviewInput = { children, requestId };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "guardian.children",
      "guardian",
      requestId,
      (binding, auth) => binding.getChildrenOverview(input, auth),
    ));
    return result.ok ? c.json(result.value) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

study.get("/children/:memberId/overview", requireAuth, async (c) => {
  try {
    const memberId = studyId(c.req.param("memberId"));
    const requestId = requestIdForStudy(c.req.raw);
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "parent", childMemberId: memberId });
    const input: ChildReportInput = { memberId, grade: studyRpcGrade(context.child?.grade ?? null), range: "7d", requestId };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "guardian.overview",
      "guardian",
      requestId,
      (binding, auth) => binding.getChildReport(input, auth),
    ));
    return result.ok ? c.json(result.value) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

study.get("/children/:memberId/report", requireAuth, async (c) => {
  try {
    const memberId = studyId(c.req.param("memberId"));
    const requestId = requestIdForStudy(c.req.raw);
    const range = studyRange(c.req.query("range"));
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "parent", childMemberId: memberId });
    const input: ChildReportInput = { memberId, grade: studyRpcGrade(context.child?.grade ?? null), range, requestId };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "guardian.report",
      "guardian",
      requestId,
      (binding, auth) => binding.getChildReport(input, auth),
    ));
    return result.ok ? c.json(result.value) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

study.get("/learner/me", requireAuth, async (c) => {
  try {
    const requestId = requestIdForStudy(c.req.raw);
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "child" });
    const memberId = context.child?.memberId;
    if (!memberId) throw new StudyGatewayRequestError(403, "study_not_available");
    const input: LearnerStateInput = { memberId, requestId };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "learner.state",
      "learner",
      requestId,
      (binding, auth) => binding.getLearnerState(input, auth),
    ));
    return result.ok ? c.json(result.value) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

study.post("/learner/missions", requireAuth, async (c) => {
  try {
    const body = await parseStudyJson(c.req.raw, ["mode", "grade"]);
    const mode = body.mode === undefined ? "daily" : studyMissionMode(body.mode);
    const selectedGrade = body.grade === undefined ? undefined : studyGrade(body.grade);
    const requestId = requestIdForStudy(c.req.raw);
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "child" });
    const memberId = context.child?.memberId;
    if (!memberId) throw new StudyGatewayRequestError(403, "study_not_available");
    if (context.child?.grade === null && selectedGrade === undefined) {
      throw new StudyGatewayRequestError(400, "invalid_request");
    }
    const input: StartCalendarMissionInput = {
      memberId,
      mode,
      ...(context.child?.grade === null ? { grade: selectedGrade } : {}),
      requestId,
    };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "learner.start",
      "learner",
      requestId,
      (binding, auth) => binding.startCalendarMission(input, auth),
    ));
    return result.ok ? c.json(result.value, 201) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

study.get("/learner/missions/:missionId", requireAuth, async (c) => {
  try {
    const missionId = studyId(c.req.param("missionId"));
    const requestId = requestIdForStudy(c.req.raw);
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "child" });
    const memberId = context.child?.memberId;
    if (!memberId) throw new StudyGatewayRequestError(403, "study_not_available");
    const input: CalendarMissionInput = { memberId, missionId, requestId };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "learner.get",
      "learner",
      requestId,
      (binding, auth) => binding.getCalendarMission(input, auth),
    ));
    return result.ok ? c.json(result.value) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

study.post("/learner/missions/:missionId/submissions", requireAuth, async (c) => {
  try {
    const missionId = studyId(c.req.param("missionId"));
    const body = await parseStudyJson(c.req.raw, ["problemId", "answer"]);
    const problemId = studyId(body.problemId);
    const answer = studyAnswer(body.answer);
    const requestId = requestIdForStudy(c.req.raw);
    const context = await resolveStudyGatewayContext(c.env, c.get("user"), { role: "child" });
    const memberId = context.child?.memberId;
    if (!memberId) throw new StudyGatewayRequestError(403, "study_not_available");
    const input: SubmitCalendarAnswerInput = { memberId, missionId, problemId, answer, requestId };
    const result = await studyResponse(() => callStudyBinding(
      c.env,
      context,
      input,
      "learner.submit",
      "learner",
      requestId,
      (binding, auth) => binding.submitCalendarAnswer(input, auth),
    ));
    return result.ok ? c.json(result.value, 201) : c.json({ error: "study_unavailable" }, 503);
  } catch (error) {
    return gatewayError(c, error);
  }
});

// 부모가 현재 활성 아이 member id 하나를 명시해 학년 override를 바꾼다.
// 자동 학년은 저장하지 않고 이 요청 시점의 서울 학사연도로만 다시 계산한다.
study.put("/children/:memberId/grade", requireAuth, async (c) => {
  let body: { grade?: unknown; rowVersion?: unknown; requestId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const memberId = c.req.param("memberId").trim();
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!memberId || !requestId || requestId.length > 160) {
    return c.json({ error: "invalid_request_id" }, 400);
  }

  try {
    const now = new Date();
    const context = await resolveStudyManagementMutationContext(c.env, c.get("user"), memberId);
    const leaseResult = await acquireAccountMutationLease(c.env.DB, {
      userId: context.actorId,
      familyId: context.familyId,
    });
    if (leaseResult.status === "blocked") {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
    if (leaseResult.status === "unavailable") {
      return c.json({ error: "study_grade_storage_unavailable" }, 503);
    }
    try {
      const result = await changeLearningGrade(c.env.DB, {
        actorId: context.actorId,
        familyId: context.familyId,
        memberId: context.memberId,
        grade: body.grade,
        rowVersion: body.rowVersion,
        requestId,
        occurredAt: now.toISOString(),
        now,
      });
      if (result.status !== 200) {
        const { status, ...errorBody } = result;
        return c.json(errorBody, status);
      }
      return c.json({
        memberId: context.memberId,
        grade: studyRpcGrade(result.grade),
        rowVersion: result.rowVersion,
      });
    } finally {
      try {
        await releaseAccountMutationLease(c.env.DB, leaseResult.lease.id);
      } catch {
        console.error("[study-grade] canonical family mutation lease release failed");
      }
    }
  } catch (error) {
    if (error instanceof StudyGatewayRequestError && error.status === 403) {
      return c.json({ error: "grade_forbidden" }, 403);
    }
    if (error instanceof LearningGradeUnavailableError) {
      return c.json({ error: error.code }, 422);
    }
    console.error("[study-grade] write failed");
    return c.json({ error: "study_grade_storage_unavailable" }, 503);
  }
});

export default study;
