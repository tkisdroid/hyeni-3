import { Hono } from "hono";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { requireAuth } from "../middleware/auth";
import { isStudyFeatureEnabled } from "../lib/studyFeatureState";
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
  if (!membership) return c.json({ state: "not_confirmed" });

  let family: { service_country: string | null; service_country_source: string | null; study_market: string | null } | null;
  try {
    family = await c.env.DB.prepare(
      `SELECT service_country, service_country_source, study_market
         FROM families
        WHERE id=?
        LIMIT 1`,
    ).bind(membership.familyId).first<{
      service_country: string | null;
      service_country_source: string | null;
      study_market: string | null;
    }>();
  } catch {
    console.error("[study-status] market resolution failed");
    return c.json({ state: "unavailable" }, 503);
  }
  if (!family || family.study_market !== "KR") {
    const confirmedOutsideMarket = family?.service_country !== "KR"
      && family?.service_country
      && (family.service_country_source === "guardian_confirmed" || family.service_country_source === "guardian_changed");
    return c.json({ state: confirmedOutsideMarket ? "outside_market" : "not_confirmed" });
  }

  const enabled = await isStudyFeatureEnabled(c.env.DB, {
    familyId: membership.familyId,
    role: membership.role,
    rolloutSecret: c.env.STUDY_RPC_HMAC_SECRET,
  });
  if (!enabled) return c.json({ state: "feature_disabled" });

  try {
    const readiness = await c.env.STUDY_SERVICE?.readiness();
    if (readiness?.apiVersion !== "2026-08-27" || readiness.status !== "ready") {
      return c.json({ state: "unavailable" }, 503);
    }
    return c.json({ state: "enabled" });
  } catch {
    console.error("[study-status] Study readiness unavailable");
    return c.json({ state: "unavailable" }, 503);
  }
});

export default study;
