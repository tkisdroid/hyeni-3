// PostgREST/Realtime 호환 shim — 네이티브 Android(LocationService.java 등)가 직접 호출하는
// Supabase 엔드포인트를 Cloudflare Worker 로 그대로 받는다. 네이티브는 컷오버 시 base URL 만
// Worker 로 바꾸면 동작한다(요청 경로/헤더/응답 형식 모방).
//
// 마운트(메인 index.ts 후속): 이 앱은 절대경로(/rest/v1·/functions/v1·/realtime/v1)를 직접 쓴다.
//   import restShim from "./routes/rest-shim";
//   app.route("/", restShim);   // 한 번의 마운트로 세 경로군 전부 처리.
//
// 4개 영역:
//   1) POST /rest/v1/rpc/:fn            → RPC 10종(rest-shim-rpc).
//   2) GET/POST/PATCH /rest/v1/:table   → PostgREST 표 8종(rest-shim-table).
//   3) POST /functions/v1/:fn           → 기존 Worker 라우트 별칭(push/ai-proactive/kakao).
//   4) POST /realtime/v1/api/broadcast  → FamilyRoom DO fan-out(broadcast).
import { Hono, type Context } from "hono";
import type { Env, Vars } from "../types";
import { getMyFamilyIds } from "../db/authz";
import { resolveCaller, type ShimCaller } from "./rest-shim-auth";
import { TABLES, handleTableGet, handleTablePost, handleTablePatch, handleLocationsPost } from "./rest-shim-table";
import { dispatchRpc } from "./rest-shim-rpc";
import pushRoutes from "./push-notify";
import proactiveRoutes from "./ai-proactive";
import kakaoRoutes from "./kakao";
import { authorizeRealtimeBroadcast } from "../lib/realtimeBroadcastSecurity";
import { writeOperationalLog } from "../lib/safeOperationalLog";
import {
  acquireAccountMutationLeases,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
  type AccountMutationScope,
} from "../lib/accountMutationScope";

type Ctx = Context<{ Bindings: Env; Variables: Vars }>;
const MUTATING_RPC_NAMES = new Set([
  "insert_parent_alert_v2",
  "upsert_child_location",
  "record_location_history_rows",
  "mark_notifications_delivered",
  "upsert_fcm_token",
  "unregister_fcm_token",
  "record_child_shutdown",
  "force_ring_acknowledge",
]);

// JWT/내부시크릿 해석 + 소속 가족 id 선조회(table/broadcast 격리에 사용).
async function caller(c: Ctx): Promise<ShimCaller> {
  const base = await resolveCaller(c.env, {
    authorization: c.req.header("Authorization"),
    internal: c.req.header("x-internal-secret"),
  });
  const familyIds = base.serviceRole || !base.sub ? [] : await getMyFamilyIds(c.env.DB, base.sub);
  return { ...base, familyIds };
}

function eqQueryValue(url: URL, key: string): string | null {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  return raw.startsWith("eq.") ? raw.slice(3) : raw;
}

async function resolveServiceMutationScopes(
  db: D1Database,
  payload: unknown,
  options: { familyFilterKey?: string; requestUrl?: string } = {},
): Promise<AccountMutationScope[]> {
  const familyTargets = new Map<string, Set<string>>();
  const standaloneUsers = new Set<string>();
  const records: Record<string, unknown>[] = [];
  const append = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      records.push(value as Record<string, unknown>);
    }
  };
  if (Array.isArray(payload)) payload.forEach(append);
  else append(payload);
  const root = records[0];
  if (Array.isArray(root?.p_rows)) root.p_rows.forEach(append);

  for (const record of records) {
    const familyId = String(
      record.family_id ?? record.familyId ?? record.p_family_id ?? "",
    ).trim();
    const userIds = [
      record.user_id,
      record.userId,
      record.p_user_id,
      record.child_user_id,
      record.p_child_user_id,
      record.target_user_id,
      record.targetUserId,
    ].map((value) => String(value ?? "").trim()).filter(Boolean);
    if (familyId) {
      const targets = familyTargets.get(familyId) ?? new Set<string>();
      userIds.forEach((userId) => targets.add(userId));
      familyTargets.set(familyId, targets);
    } else {
      userIds.forEach((userId) => standaloneUsers.add(userId));
    }
  }

  if (options.familyFilterKey && options.requestUrl) {
    const familyId = eqQueryValue(new URL(options.requestUrl), options.familyFilterKey);
    if (familyId && !familyTargets.has(familyId)) familyTargets.set(familyId, new Set());
  }

  const eventId = String(root?.p_event_id ?? root?.event_id ?? "").trim();
  if (eventId) {
    const event = await db
      .prepare("SELECT family_id, target_user_id FROM force_ring_events WHERE id=? LIMIT 1")
      .bind(eventId)
      .first<{ family_id: string; target_user_id: string | null }>();
    if (event?.family_id) {
      const targets = familyTargets.get(String(event.family_id)) ?? new Set<string>();
      if (event.target_user_id) targets.add(String(event.target_user_id));
      familyTargets.set(String(event.family_id), targets);
    }
  }

  if (Array.isArray(root?.p_ids) && root.p_ids.length > 0) {
    const ids = root.p_ids.map((value) => String(value)).filter(Boolean).slice(0, 100);
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const { results } = await db
        .prepare(
          `SELECT family_id, target_user_id FROM pending_notifications
            WHERE id IN (${placeholders}) AND target_user_id IS NOT NULL`,
        )
        .bind(...ids)
        .all<{ family_id: string; target_user_id: string }>();
      for (const row of results ?? []) {
        const targets = familyTargets.get(String(row.family_id)) ?? new Set<string>();
        targets.add(String(row.target_user_id));
        familyTargets.set(String(row.family_id), targets);
      }
    }
  }

  const scopes: AccountMutationScope[] = [...standaloneUsers].map((userId) => ({ userId }));
  for (const [familyId, targetUserIds] of familyTargets) {
    const familyScopes = await loadFamilyNotificationMutationScopes(db, familyId, targetUserIds);
    if (familyScopes) scopes.push(...familyScopes);
  }
  return scopes;
}

async function withCallerMutationLeases(
  c: Ctx,
  cl: ShimCaller,
  task: () => Promise<Response>,
  serviceMutationScopes?: AccountMutationScope[],
): Promise<Response> {
  let scopes: AccountMutationScope[];
  if (cl.serviceRole) {
    if (serviceMutationScopes === undefined) return await task();
    if (serviceMutationScopes.length === 0) {
      return c.json({ error: "account_mutation_scope_required" }, 400);
    }
    scopes = serviceMutationScopes;
  } else {
    if (!cl.sub) return c.json({ error: "unauthorized" }, 401);
    scopes = cl.familyIds.length > 0
      ? cl.familyIds.map((familyId) => ({ userId: cl.sub!, familyId }))
      : [{ userId: cl.sub }];
  }
  const result = await acquireAccountMutationLeases(c.env.DB, scopes);
  if (result.status !== "acquired") {
    return c.json(
      { error: result.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      result.status === "blocked" ? 409 : 503,
    );
  }
  try {
    return await task();
  } finally {
    await releaseAccountMutationLeases(c.env.DB, result.leases);
  }
}

const shim = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 1) RPC ──
shim.post("/rest/v1/rpc/:fn", async (c) => {
  const cl = await caller(c);
  const fn = c.req.param("fn");
  const serviceScopes = cl.serviceRole && MUTATING_RPC_NAMES.has(fn)
    ? await resolveServiceMutationScopes(c.env.DB, await c.req.raw.clone().json().catch(() => null))
    : undefined;
  return withCallerMutationLeases(c, cl, () => dispatchRpc(c, fn, cl), serviceScopes);
});

// ── 2) 표 쿼리 ──
shim.get("/rest/v1/:table", async (c) => {
  const table = c.req.param("table");
  const cfg = TABLES[table];
  if (!cfg) return c.json({ error: "not_found" }, 404);
  const cl = await caller(c);
  if (!cl.serviceRole && !cl.sub) return c.json({ error: "unauthorized" }, 401);
  return handleTableGet(c, table, cfg, cl);
});

shim.post("/rest/v1/:table", async (c) => {
  const table = c.req.param("table");
  const cl = await caller(c);
  if (!cl.serviceRole && !cl.sub) return c.json({ error: "unauthorized" }, 401);
  const cfg = TABLES[table];
  if (!cfg && table !== "locations") return c.json({ error: "not_found" }, 404);
  const serviceScopes = cl.serviceRole
    ? await resolveServiceMutationScopes(
        c.env.DB,
        await c.req.raw.clone().json().catch(() => null),
        { familyFilterKey: cfg?.familyCol, requestUrl: c.req.url },
      )
    : undefined;
  if (table === "locations") {
    return withCallerMutationLeases(c, cl, () => handleLocationsPost(c, cl), serviceScopes);
  }
  return withCallerMutationLeases(c, cl, () => handleTablePost(c, table, cfg!, cl), serviceScopes);
});

shim.patch("/rest/v1/:table", async (c) => {
  const table = c.req.param("table");
  const cfg = TABLES[table];
  if (!cfg) return c.json({ error: "not_found" }, 404);
  const cl = await caller(c);
  if (!cl.serviceRole && !cl.sub) return c.json({ error: "unauthorized" }, 401);
  const serviceScopes = cl.serviceRole
    ? await resolveServiceMutationScopes(
        c.env.DB,
        await c.req.raw.clone().json().catch(() => null),
        { familyFilterKey: cfg.familyCol, requestUrl: c.req.url },
      )
    : undefined;
  return withCallerMutationLeases(c, cl, () => handleTablePatch(c, table, cfg, cl), serviceScopes);
});

// ── 3) Edge Function 별칭 → 기존 Worker 라우트로 위임(URL 재작성 후 sub-app.fetch) ──
const FUNCTION_ALIAS: Record<string, { app: { fetch: (r: Request, e: Env) => Response | Promise<Response> }; path: string }> = {
  "push-notify": { app: pushRoutes, path: "/" },
  "ai-proactive-generate": { app: proactiveRoutes, path: "/proactive" },
  "kakao-proxy/walking-directions": { app: kakaoRoutes, path: "/walking-directions" },
};

shim.all("/functions/v1/*", async (c) => {
  const rest = c.req.path.replace(/^\/functions\/v1\//, "");
  const alias = FUNCTION_ALIAS[rest];
  if (!alias) return c.json({ error: "not_found" }, 404);
  const url = new URL(c.req.url);
  url.pathname = alias.path;
  const req = new Request(url.toString(), c.req.raw); // method/headers/body 보존.
  return alias.app.fetch(req, c.env); // 세 대상 라우트 모두 waitUntil 미사용 → ctx 생략.
});

// ── 4) Realtime broadcast → FamilyRoom DO ──
// 네이티브 {messages:[{topic:"family-<id>", event, payload}]} → DO {kind:"broadcast", event, payload}.
// 클라 sync.js routeBroadcast(event, payload) 가 그대로 디스패치(원본 broadcast 형식 보존).
shim.post("/realtime/v1/api/broadcast", async (c) => {
  let body: { messages?: Array<{ topic?: string; event?: string; payload?: unknown }> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const cl = await caller(c);
  if (!cl.sub) return c.json({ error: "authentication_required" }, 401);

  return withCallerMutationLeases(c, cl, async () => {

  const authorized: Array<{
    familyId: string;
    event: string;
    payload: Record<string, unknown>;
    targetUserId: string | null;
    targetUserIds: string[];
  }> = [];
  for (const m of messages) {
    const topic = String(m?.topic || "");
    if (!topic.startsWith("family-")) return c.json({ error: "invalid_broadcast_topic" }, 400);
    const familyId = topic.slice("family-".length);
    if (!familyId) return c.json({ error: "invalid_broadcast_topic" }, 400);
    const decision = await authorizeRealtimeBroadcast(c.env.DB, {
      callerUserId: cl.sub,
      familyId,
      event: String(m?.event || ""),
      payload: m?.payload,
    });
    if (!decision.ok) {
      if (decision.status === 400) return c.json({ error: decision.error }, 400);
      if (decision.status === 401) return c.json({ error: decision.error }, 401);
      return c.json({ error: decision.error }, 403);
    }
    authorized.push({
      familyId,
      event: String(m?.event || ""),
      payload: decision.payload,
      targetUserId: decision.targetUserId,
      targetUserIds: decision.targetUserIds,
    });
  }

  const broadcastScopes: AccountMutationScope[] = [];
  for (const message of authorized) {
    const familyScopes = await loadFamilyNotificationMutationScopes(
      c.env.DB,
      message.familyId,
      message.targetUserIds,
    );
    if (!familyScopes) return c.json({ error: "account_mutation_blocked" }, 409);
    broadcastScopes.push(...familyScopes);
  }
  const broadcastMutationLeases = await acquireAccountMutationLeases(c.env.DB, broadcastScopes);
  if (broadcastMutationLeases.status !== "acquired") {
    return c.json(
      { error: broadcastMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      broadcastMutationLeases.status === "blocked" ? 409 : 503,
    );
  }
  try {
  const refreshedAuthorized: typeof authorized = [];
  for (const message of authorized) {
    const decision = await authorizeRealtimeBroadcast(c.env.DB, {
      callerUserId: cl.sub!,
      familyId: message.familyId,
      event: message.event,
      payload: message.payload,
    });
    if (!decision.ok) return c.json({ error: decision.error }, decision.status);
    refreshedAuthorized.push({
      familyId: message.familyId,
      event: message.event,
      payload: decision.payload,
      targetUserId: decision.targetUserId,
      targetUserIds: decision.targetUserIds,
    });
  }

  for (const message of refreshedAuthorized) {
    try {
      const id = c.env.FAMILY_ROOM.idFromName(message.familyId);
      const stub = c.env.FAMILY_ROOM.get(id);
      const response = await stub.fetch("https://do.internal/notify", {
        method: "POST",
        body: JSON.stringify({
          kind: "broadcast",
          event: message.event,
          payload: message.payload,
          ...(message.targetUserId ? { targetUserId: message.targetUserId } : {}),
          targetUserIds: message.targetUserIds,
        }),
      });
      if (!response.ok) {
        writeOperationalLog("error", "rest_shim_broadcast_forward_failed", {
          status: response.status,
        });
        return c.json({ error: "broadcast_forward_failed" }, 502);
      }
    } catch (e) {
      console.error("[shim] broadcast forward failed");
      return c.json({ error: "broadcast_forward_unavailable" }, 503);
    }
  }
  return c.json({}, 200); // 네이티브는 isSuccessful() 만 확인.
  } finally {
    await releaseAccountMutationLeases(c.env.DB, broadcastMutationLeases.leases);
  }
  });
});

export default shim;
