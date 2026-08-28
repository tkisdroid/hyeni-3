// Bearer JWT 검증 → ctx.user 주입. GoTrue 세션 검증을 대체.
import { createMiddleware } from "hono/factory";
import {
  isActiveAccessUnavailableError,
  isDeviceSessionInactiveError,
  verifyActiveAccessToken,
} from "../lib/authenticatedAccess";
import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
} from "../lib/accountMutationLease";
import {
  resolveCanonicalFamilyMembership,
  resolveVerifiedFamilyMembership,
} from "../db/authz";
import type { Env, Vars } from "../types";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type AccountAuthState = "active" | "deleting" | "missing";

async function readAccountAuthState(
  db: D1Database,
  userId: string,
  familyId: string | null | undefined,
): Promise<AccountAuthState> {
  const row = await db
    .prepare(
      `SELECT
         EXISTS(SELECT 1 FROM users WHERE id=?) AS user_exists,
         EXISTS(
           SELECT 1 FROM account_deletion_scopes
            WHERE (scope_type='user' AND scope_id=?)
               OR (? IS NOT NULL AND scope_type='family' AND scope_id=?)
         ) AS deletion_started`,
    )
    .bind(userId, userId, familyId ?? null, familyId ?? null)
    .first<{ user_exists: number; deletion_started: number }>();
  if (!row || Number(row.user_exists) !== 1) return "missing";
  return Number(row.deletion_started) === 1 ? "deleting" : "active";
}

async function canRetryAccountDeletion(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok
         WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
            OR EXISTS(
              SELECT 1 FROM account_deletion_jobs
               WHERE owner_user_id=? AND status='completed'
            )`,
    )
    .bind(userId, userId)
    .first<{ ok: number }>();
  return !!row;
}

async function resolveMutationFamilyId(
  db: D1Database,
  userId: string,
  tokenFamilyId: string | null | undefined,
): Promise<string | null> {
  const preferredFamilyId = String(tokenFamilyId ?? "").trim();
  if (preferredFamilyId) {
    const preferred = await resolveVerifiedFamilyMembership(db, userId, preferredFamilyId);
    if (preferred) return preferred.familyId;
  }
  return (await resolveCanonicalFamilyMembership(db, userId, null))?.familyId ?? null;
}

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: Vars;
}>(async (c, next) => {
  const hdr = c.req.header("Authorization");
  if (!hdr || !hdr.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let claims: Awaited<ReturnType<typeof verifyActiveAccessToken>>;
  try {
    claims = await verifyActiveAccessToken(c.env, c.env.DB, hdr.slice(7));
  } catch (error) {
    if (isDeviceSessionInactiveError(error)) {
      return c.json({ error: "device_session_inactive" }, 401);
    }
    if (isActiveAccessUnavailableError(error)) {
      console.error("[auth] device session check failed");
      return c.json({ error: "auth_unavailable" }, 503);
    }
    return c.json({ error: "invalid_token" }, 401);
  }
  c.set("user", {
    sub: claims.sub,
    role: claims.role,
    family_id: claims.family_id,
    is_anonymous: !!claims.is_anonymous,
    device_id: claims.device_id ?? null,
  });
  c.set("accessTokenExp", Number(claims.exp));
  c.set("accessTokenJti", typeof claims.jti === "string" ? claims.jti : null);

  const isAccountDeleteRetry = c.req.method === "POST" && c.req.path === "/api/account/delete";
  if (isAccountDeleteRetry) {
    try {
      if (!(await canRetryAccountDeletion(c.env.DB, claims.sub))) {
        return c.json({ error: "invalid_token" }, 401);
      }
    } catch (error) {
      console.error("[auth] account deletion retry check failed");
      return c.json({ error: "auth_unavailable" }, 503);
    }
    await next();
    return;
  }

  let currentFamilyId: string | null;
  try {
    currentFamilyId = await resolveMutationFamilyId(
      c.env.DB,
      claims.sub,
      claims.family_id,
    );
  } catch (error) {
    console.error("[auth] current family resolution failed");
    return c.json({ error: "auth_unavailable" }, 503);
  }

  if (READ_ONLY_METHODS.has(c.req.method)) {
    try {
      const state = await readAccountAuthState(c.env.DB, claims.sub, currentFamilyId);
      if (state === "missing") {
        return c.json({ error: "invalid_token" }, 401);
      }
      if (state === "deleting") {
        return c.json({ error: "account_deletion_in_progress" }, 409);
      }
    } catch (error) {
      console.error("[auth] user existence check failed");
      return c.json({ error: "auth_unavailable" }, 503);
    }
    await next();
    return;
  }

  const leaseResult = await acquireAccountMutationLease(c.env.DB, {
    userId: claims.sub,
    familyId: currentFamilyId,
  });
  if (leaseResult.status === "unavailable") {
    return c.json({ error: "auth_unavailable" }, 503);
  }
  if (leaseResult.status === "blocked") {
    try {
      const state = await readAccountAuthState(c.env.DB, claims.sub, currentFamilyId);
      if (state === "missing") {
        return c.json({ error: "invalid_token" }, 401);
      }
    } catch (error) {
      console.error("[auth] blocked mutation user check failed");
      return c.json({ error: "auth_unavailable" }, 503);
    }
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }

  try {
    await next();
  } finally {
    try {
      await releaseAccountMutationLease(c.env.DB, leaseResult.lease.id);
    } catch (error) {
      // 이미 반영된 mutation을 5xx로 오인시켜 중복 재시도하지 않도록 TTL 만료에 맡긴다.
      console.error("[auth] account mutation lease release failed");
    }
  }
});
