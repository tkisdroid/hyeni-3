import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { requireAuth } from "../middleware/auth";
import {
  hashPremiumFunnelFamily,
  isPremiumFunnelConfigured,
  normalizePremiumFunnelPayload,
  readBoundedPremiumFunnelJson,
  storeClientPremiumFunnelEvents,
} from "../lib/premiumFunnel";

const premiumFunnel = new Hono<{ Bindings: Env; Variables: Vars }>();

premiumFunnel.post("/events", requireAuth, async (c) => {
  const user = c.get("user");
  let membership: Awaited<ReturnType<typeof resolveCanonicalFamilyMembership>>;
  try {
    membership = await resolveCanonicalFamilyMembership(c.env.DB, user.sub, user.family_id);
  } catch {
    return c.json({ error: "premium_funnel_identity_unavailable" }, 503);
  }
  if (!membership || membership.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!isPremiumFunnelConfigured(c.env.PREMIUM_FUNNEL_HASH_SECRET)) {
    return c.json({ error: "premium_funnel_unavailable", configured: false }, 503);
  }

  const parsed = await readBoundedPremiumFunnelJson(c.req.raw);
  if (!parsed.ok) {
    return parsed.error === "payload_too_large"
      ? c.json({ error: "premium_funnel_payload_too_large" }, 413)
      : c.json({ error: "invalid_json_payload" }, 400);
  }
  const normalized = normalizePremiumFunnelPayload(parsed.value);
  if (!normalized.ok) return c.json({ error: normalized.error }, 400);

  try {
    const familyKey = await hashPremiumFunnelFamily(
      c.env.PREMIUM_FUNNEL_HASH_SECRET as string,
      membership.familyId,
    );
    const stored = await storeClientPremiumFunnelEvents(
      c.env.DB,
      familyKey,
      normalized.events,
    );
    if (stored.rateLimited) {
      return c.json({ error: "premium_funnel_rate_limited" }, 429);
    }
    return c.json({
      ok: true,
      accepted: stored.accepted,
      duplicates: stored.duplicates,
    }, 202);
  } catch {
    return c.json({ error: "premium_funnel_storage_unavailable" }, 503);
  }
});

export default premiumFunnel;

