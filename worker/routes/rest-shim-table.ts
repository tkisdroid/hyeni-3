// PostgREST `/rest/v1/:table` 쿼리 호환 레이어.
// 네이티브가 보내는 GET(?col=eq.val&select=&order=&limit=) / POST(insert·on_conflict upsert) /
// PATCH(?id=eq.x) 를 D1 SQL 로 직역한다.
//
// ── 타입 복원(CRITICAL) ──
// PostgREST 는 컬럼 타입대로 JSON 을 반환한다(boolean→true/false, jsonb→객체). 그런데 D1 은
// boolean→INTEGER(0/1), jsonb→TEXT 로 저장한다. 네이티브가 `optBoolean`/`optJSONObject` 로
// 파싱하므로 정수/문자열을 그대로 주면 오판한다:
//   · families.registered_place_alerts_enabled: optBoolean 은 정수에서 getBoolean 예외→기본값(true)
//     반환 → 0 도 true 로 오판. 반드시 실제 JSON boolean 으로 변환.
//   · saved_places/academies.location: optJSONObject 가 문자열이면 null → 장소 누락. 반드시 객체화.
// → 표별 컬럼 타입 맵(TABLES[t].types)으로 read 시 복원한다.
//
// ── authz ──
// PostgREST 는 RLS 로 격리했다. shim 은 JWT→sub→가족 격리: 모든 쿼리 WHERE 에
// `<familyCol> IN (caller 가족들)` 을 주입(service_role 은 우회). families 는 familyCol='id'.
import type { Context } from "hono";
import type { Env, Vars } from "../types";
import { parseJson, toBool } from "../lib/serialize";
import { resolveCanonicalFamilyMembership, serviceLimitForFamily } from "../db/authz";
import { pgNow } from "../lib/time";
import {
  isNotificationEndpointSchemaUnavailable,
  refreshLegacyFcmTokenOwnership,
  upsertFcmTokenOwnership,
} from "../lib/notificationEndpointOwnership";
import type { ShimCaller } from "./rest-shim-auth";
import {
  CURRENT_LOCATION_UPSERT_SQL,
  currentLocationComparisonKey,
  shouldReplaceCurrentLocation,
} from "../shared/currentLocation.js";
import { parseShutdownLocationPayload } from "../shared/shutdownLocation.js";
import { recordFamilyLifecycleEvent } from "../lib/familyLifecycleFunnel";
import { authorizeAcademyDataAccess, type AcademyDataAction } from "../lib/academyDataAccess";
import { annotateTierAlertActivationSelection } from "../lib/tierAlertActivation";

type Ctx = Context<{ Bindings: Env; Variables: Vars }>;
type ColType = "json" | "bool";

export interface TableCfg {
  familyCol: string; // 가족 격리 컬럼. families 는 자기 자신이 가족 id 이므로 'id'.
  types: Record<string, ColType>; // read 시 타입 복원 대상 컬럼.
  genId?: boolean; // INSERT 시 id 미지정이면 uuid 생성(id PK TEXT 테이블).
  // 비-service_role(클라) POST 허용 컬럼(allowlist). 현재는 fcm_tokens 정식 호환 경로에만 쓴다.
  clientWriteAllow?: readonly string[];
  // 비-service_role POST 금지 컬럼(denylist).
  clientWriteDeny?: readonly string[];
}

// 클라(비 service_role) 쓰기 컬럼 게이트. 허용/금지 정책 위반 컬럼이 있으면 위반 컬럼명을 반환(없으면 null).
// familyCol(격리 스코프 키)·id(upsert PK)는 항상 허용한다.
export function forbiddenWriteColumn(
  cfg: TableCfg,
  cols: string[],
  caller: ShimCaller,
): string | null {
  if (caller.serviceRole) return null; // 서버(webhook/reconcile)는 전 컬럼 쓰기 허용.
  // ★SQLite 는 따옴표 식별자도 대소문자 무시로 컬럼을 해석한다("User_tier"→user_tier).
  //   따라서 allow/deny/scope 비교는 반드시 소문자 정규화 후 수행해야 대소문자 우회를 막는다.
  const scopeKeys = new Set([cfg.familyCol.toLowerCase(), "id"]);
  if (cfg.clientWriteAllow) {
    const allow = new Set(cfg.clientWriteAllow.map((c) => c.toLowerCase()));
    for (const col of cols) {
      const n = col.toLowerCase();
      if (scopeKeys.has(n)) continue;
      if (!allow.has(n)) return col;
    }
  }
  if (cfg.clientWriteDeny) {
    const deny = new Set(cfg.clientWriteDeny.map((c) => c.toLowerCase()));
    for (const col of cols) {
      if (deny.has(col.toLowerCase())) return col;
    }
  }
  return null;
}

// SQLite 식별자는 따옴표 안에서도 대소문자를 구분하지 않는다. 같은 요청에 family_id와
// Family_ID처럼 논리적으로 같은 컬럼을 두 번 보내면 드라이버별 처리 차이가 생길 수 있으므로
// 일반 클라이언트 요청은 SQL 생성 전에 닫는다.
function duplicateCaseInsensitiveColumn(cols: string[]): string | null {
  const seen = new Set<string>();
  for (const col of cols) {
    const normalized = col.toLowerCase();
    if (seen.has(normalized)) return col;
    seen.add(normalized);
  }
  return null;
}

function valueByNormalizedColumn(body: Record<string, unknown>, column: string): unknown {
  const entry = Object.entries(body).find(([key]) => key.toLowerCase() === column.toLowerCase());
  return entry?.[1];
}

function exactEqQueryValue(url: URL, column: string): string | null {
  const raw = url.searchParams.get(column);
  if (!raw?.startsWith("eq.")) return null;
  const value = raw.slice(3).trim();
  return value || null;
}

// shim 이 지원하는 표 8종 + 컬럼 타입(네이티브가 실제 읽는 컬럼 기준, 안전하게 확장).
export const TABLES: Record<string, TableCfg> = {
  family_members: {
    familyCol: "family_id",
    types: { device_health: "json" },
    genId: true,
  },
  families: {
    familyCol: "id",
    types: {
      registered_place_alerts_enabled: "bool",
      unregistered_stay_alert_enabled: "bool",
      playdate_enabled: "bool",
    },
  },
  family_subscription: {
    familyCol: "family_id",
    types: { remote_listen_enabled: "bool", raw_event: "json", google_play_raw: "json" },
  },
  saved_places: {
    familyCol: "family_id",
    types: { location: "json", is_home: "bool", is_playdate_safe: "bool" },
    genId: true,
  },
  academies: {
    familyCol: "family_id",
    types: { location: "json", schedule: "json" },
    genId: true,
  },
  force_ring_events: { familyCol: "family_id", types: { delivery_status: "json" }, genId: true },
  fcm_tokens: {
    familyCol: "family_id",
    types: {},
    genId: true,
    clientWriteAllow: ["user_id", "fcm_token", "platform", "registration_instance_id", "updated_at"],
  },
  // saved_places/academies/family_members PATCH/POST 는 네이티브 device_health 외 거의 미사용.
};

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface Filter {
  sql: string;
  binds: unknown[];
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict"]);

// PostgREST 연산자 → SQL. eq/neq/gt/gte/lt/lte/in/is/like + not.is.null 지원.
function buildFilters(url: URL): Filter[] {
  const out: Filter[] = [];
  for (const [key, raw] of url.searchParams.entries()) {
    if (RESERVED.has(key)) continue;
    if (!IDENT.test(key)) continue; // 식별자 안전성(바인딩 외 유일한 주입 경로).
    const col = `"${key}"`;
    const dot = raw.indexOf(".");
    if (dot < 0) {
      out.push({ sql: `${col} = ?`, binds: [raw] });
      continue;
    }
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    switch (op) {
      case "eq": out.push({ sql: `${col} = ?`, binds: [val] }); break;
      case "neq": out.push({ sql: `${col} <> ?`, binds: [val] }); break;
      case "gt": out.push({ sql: `${col} > ?`, binds: [val] }); break;
      case "gte": out.push({ sql: `${col} >= ?`, binds: [val] }); break;
      case "lt": out.push({ sql: `${col} < ?`, binds: [val] }); break;
      case "lte": out.push({ sql: `${col} <= ?`, binds: [val] }); break;
      case "like": out.push({ sql: `${col} LIKE ?`, binds: [val.replace(/\*/g, "%")] }); break;
      case "in": {
        const inner = val.replace(/^\(/, "").replace(/\)$/, "");
        const items = inner.length ? inner.split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
        if (!items.length) out.push({ sql: `0 = 1`, binds: [] });
        else out.push({ sql: `${col} IN (${items.map(() => "?").join(",")})`, binds: items });
        break;
      }
      case "is": {
        const v = val.toLowerCase();
        if (v === "null") out.push({ sql: `${col} IS NULL`, binds: [] });
        else if (v === "notnull") out.push({ sql: `${col} IS NOT NULL`, binds: [] });
        else if (v === "true") out.push({ sql: `${col} = 1`, binds: [] });
        else if (v === "false") out.push({ sql: `${col} = 0`, binds: [] });
        else out.push({ sql: `${col} IS NULL`, binds: [] });
        break;
      }
      case "not": {
        // not.is.null → IS NOT NULL (네이티브 미사용이나 대칭 보존).
        if (val.toLowerCase() === "is.null") out.push({ sql: `${col} IS NOT NULL`, binds: [] });
        else out.push({ sql: `${col} <> ?`, binds: [val.replace(/^[a-z]+\./, "")] });
        break;
      }
      default:
        out.push({ sql: `${col} = ?`, binds: [raw] });
    }
  }
  return out;
}

// D1 저장형 → PostgREST 타입 복원.
function coerceRow(row: Record<string, unknown>, cfg: TableCfg): Record<string, unknown> {
  const o: Record<string, unknown> = { ...row };
  for (const [c, t] of Object.entries(cfg.types)) {
    if (c in o) o[c] = t === "json" ? parseJson(o[c]) : toBool(o[c]);
  }
  return o;
}

// JS 값 → D1 바인딩형. 객체/배열→JSON TEXT, boolean→0/1, null 유지.
function serializeVal(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function familyScope(cfg: TableCfg, caller: ShimCaller): Filter | null {
  if (caller.serviceRole) return null;
  const ids = caller.familyIds ?? [];
  if (!ids.length) return { sql: `0 = 1`, binds: [] }; // 소속 없음 → 결과 없음.
  return { sql: `"${cfg.familyCol}" IN (${ids.map(() => "?").join(",")})`, binds: ids };
}

async function academyShimGate(
  c: Ctx,
  caller: ShimCaller,
  familyId: string,
  action: AcademyDataAction,
): Promise<Response | null> {
  if (caller.serviceRole) return null;
  if (!caller.sub) return c.json({ error: "unauthorized" }, 401);
  const access = await authorizeAcademyDataAccess(c.env.DB, {
    callerUserId: caller.sub,
    familyId,
    action,
  });
  if (access.ok) return null;
  return access.status === 503
    ? c.json({ error: access.error }, 503)
    : c.json({ error: access.error }, 403);
}

function pickColumns(url: URL): string[] | null {
  const sel = url.searchParams.get("select");
  if (!sel || sel === "*") return null;
  const cols = sel
    .split(",")
    .map((s) => s.trim())
    .filter((s) => IDENT.test(s)); // 임베디드 리소스(rel(...))·* 는 제외(네이티브 미사용).
  return cols.length ? cols : null;
}

export async function handleTableGet(c: Ctx, table: string, cfg: TableCfg, caller: ShimCaller): Promise<Response> {
  const url = new URL(c.req.url);
  if (table === "academies" && !caller.serviceRole) {
    const rawFamily = url.searchParams.get("family_id") ?? "";
    const familyId = rawFamily.startsWith("eq.") ? rawFamily.slice(3).trim() : "";
    if (!familyId) return c.json({ error: "academy_family_required" }, 400);
    const denied = await academyShimGate(c, caller, familyId, "read");
    if (denied) return denied;
  }
  const filters = buildFilters(url);
  const scope = familyScope(cfg, caller);
  if (scope) filters.push(scope);
  if (table === "fcm_tokens") {
    filters.push({ sql: "disabled_at IS NULL", binds: [] });
    if (!caller.serviceRole) filters.push({ sql: "user_id = ?", binds: [caller.sub] });
  }

  // 활성기기 격리: family_members 를 raw GET 으로 읽을 때 superseded 자녀(is_active=0)를
  // 제외한다(부모/placeholder/활성 자녀는 유지). /api/family/mine 과 동일 규칙 → 부모 앱
  // 멤버 목록/지도에 옛 페어링 기기가 새지 않는다. service_role(cron)은 우회.
  if (table === "family_members" && !caller.serviceRole) {
    filters.push({ sql: "NOT (role = 'child' AND is_active = 0)", binds: [] });
  }

  const where = filters.length ? `WHERE ${filters.map((f) => f.sql).join(" AND ")}` : "";
  const binds = filters.flatMap((f) => f.binds);

  let orderSql = "";
  const order = url.searchParams.get("order");
  if (order) {
    const parts = order
      .split(",")
      .map((p) => {
        const [col, dir] = p.split(".");
        if (!IDENT.test(col)) return null;
        return `"${col}" ${String(dir).toLowerCase() === "desc" ? "DESC" : "ASC"}`;
      })
      .filter((x): x is string => !!x);
    if (parts.length) orderSql = `ORDER BY ${parts.join(",")}`;
  }

  let limitSql = "";
  const limit = url.searchParams.get("limit");
  if (limit && /^\d+$/.test(limit)) limitSql = `LIMIT ${Number(limit)}`;

  const sql = `SELECT * FROM "${table}" ${where} ${orderSql} ${limitSql}`.trim();
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  const pick = pickColumns(url);
  let resolvedResults = results ?? [];

  // Android 네이티브 등록장소 평가도 웹/cron과 같은 서버 티어 정본을 사용한다.
  // 서비스 계정의 운영 조회에는 가상 필드를 섞지 않고, 일반 세션에만 additive로 제공한다.
  if (!caller.serviceRole && table === "saved_places") {
    const savedRows = resolvedResults.filter(
      (row): row is Record<string, unknown> & { id: unknown; family_id: unknown; created_at?: unknown } =>
        "id" in row && "family_id" in row,
    );
    const familyIds = [...new Set(savedRows.map((row) => String(row.family_id ?? "")))];
    const limitsByFamily = new Map<string, number | null>();
    const canonicalRows: Array<{ id: unknown; family_id: unknown; created_at?: unknown }> = [];
    for (const familyId of familyIds) {
      const canonical = await c.env.DB.prepare(
        "SELECT id, family_id, created_at FROM saved_places WHERE family_id = ?",
      )
        .bind(familyId)
        .all<{ id: string; family_id: string; created_at: string }>();
      canonicalRows.push(...(canonical.results ?? []));
      limitsByFamily.set(
        familyId,
        await serviceLimitForFamily(c.env.DB, familyId, "saved_place"),
      );
    }
    resolvedResults = annotateTierAlertActivationSelection(
      savedRows,
      canonicalRows,
      limitsByFamily,
    );
  }

  const rows = resolvedResults.map((r) => {
    const cr = coerceRow(r, cfg);
    if (!pick) return cr;
    const o: Record<string, unknown> = {};
    for (const k of pick) if (k in cr) o[k] = cr[k];
    return o;
  });
  return c.json(rows);
}

async function upsertRow(
  db: D1Database,
  table: string,
  row: Record<string, unknown>,
  conflictCols: string[],
): Promise<Record<string, unknown> | null> {
  const cols = Object.keys(row).filter((k) => IDENT.test(k));
  const ser: Record<string, unknown> = {};
  for (const k of cols) ser[k] = serializeVal(row[k]);

  if (conflictCols.length && conflictCols.every((c) => IDENT.test(c))) {
    const whereC = conflictCols.map((c) => `"${c}" = ?`).join(" AND ");
    const keyBinds = conflictCols.map((c) => ser[c]);
    const existing = await db.prepare(`SELECT * FROM "${table}" WHERE ${whereC} LIMIT 1`).bind(...keyBinds).first<Record<string, unknown>>();
    if (existing) {
      const setCols = cols.filter((c) => !conflictCols.includes(c));
      if (setCols.length) {
        await db
          .prepare(`UPDATE "${table}" SET ${setCols.map((c) => `"${c}" = ?`).join(",")} WHERE ${whereC}`)
          .bind(...setCols.map((c) => ser[c]), ...keyBinds)
          .run();
      }
      return await db.prepare(`SELECT * FROM "${table}" WHERE ${whereC} LIMIT 1`).bind(...keyBinds).first<Record<string, unknown>>();
    }
  }

  await db
    .prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...cols.map((c) => ser[c]))
    .run();
  return row;
}

export async function handleTablePost(c: Ctx, table: string, cfg: TableCfg, caller: ShimCaller): Promise<Response> {
  // saved_places 생성은 플랜별 원자 상한과 주보호자 검증을 함께 수행하는 정식 API만 사용한다.
  // Android 네이티브 호환 경로는 이 테이블을 조회만 하므로 일반 클라이언트 POST 호환은 필요 없다.
  // service_role 운영 쓰기는 기존 generic upsert 경로를 유지한다.
  if (table === "saved_places" && !caller.serviceRole) {
    return c.json({
      error: "saved_place_write_requires_canonical_api",
      canonical_path: "/api/saved-places",
    }, 403);
  }

  // Android/웹 호출 전수 기준 generic POST가 필요한 표는 fcm_tokens뿐이다.
  // 가족·멤버십·구독·장소·학원·force-ring 생성은 각각 검증/상한/결제 정본을 가진 정식 API를
  // 거쳐야 하며, generic on_conflict는 타 가족의 알려진 키를 현재 가족으로 이동시킬 수 있다.
  if (!caller.serviceRole && table !== "fcm_tokens") {
    return c.json({ error: "rest_table_write_forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const rows = Array.isArray(body) ? (body as Record<string, unknown>[]) : [body as Record<string, unknown>];
  const onConflict = c.req.query("on_conflict");
  const requestedConflictCols = onConflict ? onConflict.split(",").map((s) => s.trim()) : [];
  const conflictCols = requestedConflictCols;
  const prefer = c.req.header("Prefer") || "";
  const wantRep = /return=representation/.test(prefer);

  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (!caller.serviceRole) {
      const duplicateColumn = duplicateCaseInsensitiveColumn(
        Object.keys(r).filter((key) => IDENT.test(key)),
      );
      if (duplicateColumn) {
        return c.json({ error: "duplicate_column", column: duplicateColumn }, 400);
      }
    }
    if (table === "fcm_tokens" && !caller.serviceRole) {
      if (String(r.user_id ?? "") !== caller.sub) {
        return c.json({ error: "forbidden" }, 403);
      }
      const canonicalFamily = await resolveCanonicalFamilyMembership(c.env.DB, caller.sub!, caller.familyId);
      if (canonicalFamily?.familyId !== String(r.family_id ?? "")) {
        return c.json({ error: "forbidden" }, 403);
      }
      if (!String(r.fcm_token ?? "").trim()) {
        return c.json({ error: "fcm_token_required" }, 400);
      }
      // 일반 클라이언트는 서버 발급 PK를 지정하지 않는다. 임의 id+on_conflict로
      // 가족 내 다른 사용자의 기존 행을 덮는 우회도 함께 차단한다.
      if (r.id != null) return c.json({ error: "forbidden" }, 403);
    }
    const fam = r[cfg.familyCol];
    if (!caller.serviceRole && (!fam || !caller.familyIds.includes(String(fam)))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const badCol = forbiddenWriteColumn(cfg, Object.keys(r).filter((k) => IDENT.test(k)), caller);
    if (badCol) return c.json({ error: "forbidden_column", column: badCol }, 403);
    if (cfg.genId && r.id == null) r.id = crypto.randomUUID();
    if (table === "fcm_tokens") {
      const id = String(r.id ?? "");
      const userId = String(r.user_id ?? "");
      const familyId = String(r.family_id ?? "");
      const token = String(r.fcm_token ?? "").trim();
      const platform = String(r.platform ?? "android").trim() || "android";
      const registrationInstanceId = String(r.registration_instance_id ?? "").trim();
      if (!id || !userId || !familyId || !token) {
        return c.json({ error: "invalid_fcm_token_ownership" }, 400);
      }
      const now = pgNow();
      try {
        const owned = registrationInstanceId
          ? await upsertFcmTokenOwnership(c.env.DB, {
            id,
            userId,
            familyId,
            token,
            platform,
            registrationInstanceId,
            now,
          })
          : await refreshLegacyFcmTokenOwnership(c.env.DB, {
            userId,
            familyId,
            token,
            platform,
            now,
          });
        if (!owned) return c.json({ error: "endpoint_owned_by_other_user" }, 409);
      } catch (error) {
        if (isNotificationEndpointSchemaUnavailable(error)) {
          return c.json({ error: "notification_endpoint_schema_unavailable" }, 503);
        }
        throw error;
      }
      out.push({
        ...r,
        id,
        user_id: userId,
        family_id: familyId,
        fcm_token: token,
        platform,
        registration_instance_id: registrationInstanceId,
        created_at: now,
        updated_at: now,
      });
      continue;
    }
    const written = await upsertRow(c.env.DB, table, r, conflictCols);
    if (written) out.push(written);
  }

  if (wantRep) return c.json(out.map((r) => coerceRow(r, cfg)), 201);
  return c.body(null, 201);
}

export async function handleTablePatch(c: Ctx, table: string, cfg: TableCfg, caller: ShimCaller): Promise<Response> {
  if (table === "fcm_tokens" && !caller.serviceRole) return c.json({ error: "forbidden" }, 403);
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const setCols = Object.keys(body).filter((k) => IDENT.test(k));
  if (!setCols.length) return c.body(null, 204);

  const url = new URL(c.req.url);
  let clientPatchKind: "device_health" | "force_ring_stop" | null = null;
  if (!caller.serviceRole) {
    const duplicateColumn = duplicateCaseInsensitiveColumn(setCols);
    if (duplicateColumn) {
      return c.json({ error: "duplicate_column", column: duplicateColumn }, 400);
    }

    // PATCH의 대상 키와 가족 스코프 키는 값/대소문자와 무관하게 절대 변경하지 않는다.
    const immutableKeys = new Set(["id", cfg.familyCol.toLowerCase()]);
    const immutableColumn = setCols.find((column) => immutableKeys.has(column.toLowerCase()));
    if (immutableColumn) {
      return c.json({ error: "forbidden_column", column: immutableColumn }, 403);
    }

    if (table === "family_members") {
      const badColumn = setCols.find((column) => column.toLowerCase() !== "device_health");
      if (badColumn) return c.json({ error: "forbidden_column", column: badColumn }, 403);
      clientPatchKind = "device_health";
    } else if (table === "force_ring_events") {
      const allowed = new Set(["stopped_at", "stop_reason"]);
      const badColumn = setCols.find((column) => !allowed.has(column.toLowerCase()));
      if (badColumn) return c.json({ error: "forbidden_column", column: badColumn }, 403);
      if (setCols.length !== 2
          || valueByNormalizedColumn(body, "stop_reason") !== "auto_timeout") {
        return c.json({ error: "forbidden_force_ring_stop" }, 403);
      }
      if (!exactEqQueryValue(url, "id")) {
        return c.json({ error: "force_ring_event_id_required" }, 400);
      }
      clientPatchKind = "force_ring_stop";
    } else {
      // families/family_subscription/saved_places/academies/fcm_tokens는 정식 API만 변경한다.
      return c.json({ error: "rest_table_write_forbidden" }, 403);
    }
  }

  const filters = buildFilters(url);
  const scope = familyScope(cfg, caller);
  if (scope) {
    if (scope.sql === "0 = 1") return c.body(null, 204); // 소속 없음 → no-op.
    filters.push(scope);
  }
  if (clientPatchKind === "device_health") {
    // 같은 가족 안에서도 아이 기기는 자기 활성 child 행의 상태만 갱신한다.
    filters.push({ sql: "user_id = ?", binds: [caller.sub] });
    filters.push({ sql: "role = 'child' AND is_active = 1", binds: [] });
  } else if (clientPatchKind === "force_ring_stop") {
    // 자동 종료는 알림 대상 아이 본인이고 현재 활성 child일 때만 원자 WHERE를 통과한다.
    filters.push({ sql: "target_user_id = ?", binds: [caller.sub] });
    filters.push({
      sql: `EXISTS(
        SELECT 1 FROM family_members fm
         WHERE fm.family_id = "force_ring_events".family_id
           AND fm.user_id = ?
           AND fm.role = 'child'
           AND fm.is_active = 1
      )`,
      binds: [caller.sub],
    });
  }

  const where = filters.length ? `WHERE ${filters.map((f) => f.sql).join(" AND ")}` : "";
  const whereBinds = filters.flatMap((f) => f.binds);

  const setSql = setCols.map((c2) => `"${c2}" = ?`).join(",");
  const serverStoppedAt = clientPatchKind === "force_ring_stop" ? pgNow() : null;
  const setBinds = setCols.map((column) => {
    if (clientPatchKind === "force_ring_stop") {
      if (column.toLowerCase() === "stopped_at") return serverStoppedAt;
      if (column.toLowerCase() === "stop_reason") return "auto_timeout";
    }
    return serializeVal(body[column]);
  });

  await c.env.DB.prepare(`UPDATE "${table}" SET ${setSql} ${where}`.trim()).bind(...setBinds, ...whereBinds).run();

  if (/return=representation/.test(c.req.header("Prefer") || "")) {
    const { results } = await c.env.DB.prepare(`SELECT * FROM "${table}" ${where}`.trim()).bind(...whereBinds).all<Record<string, unknown>>();
    return c.json((results ?? []).map((r) => coerceRow(r, cfg)), 200);
  }
  return c.body(null, 204);
}

// ── locations 특수 처리 ──
// `locations` 표는 D1/Supabase 마이그레이션 어디에도 정의가 없다(대시보드/레거시 표).
// 네이티브 ShutdownReceiver 가 종료 직전 마지막 위치를 POST 하며 응답은 res.code() 만 본다.
// child_locations(최신 위치=부모 지도 점)에 베스트에포트 매핑한다. family_id 는 body 에 없어
// family_members(user_id→활성 child) 서버 정본으로 해석하며, 단말 payload 계약은 ShutdownReceiver와 일치한다.
export async function handleLocationsPost(c: Ctx, caller: ShimCaller): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_location_payload" }, 400);
  }
  const parsed = parseShutdownLocationPayload(body, Date.now());
  if (!parsed) return c.json({ error: "invalid_location_payload" }, 400);
  const { userId, lat, lng, accuracyM, fixTime } = parsed;
  if (!caller.serviceRole && caller.sub !== userId) {
    return c.json({ error: "location_user_mismatch" }, 403);
  }

  try {
    // 활성기기 격리: superseded(is_active=0) 자녀 기기의 last-location write skip.
    const fam = await c.env.DB
      .prepare("SELECT family_id FROM family_members WHERE user_id = ? AND role = 'child' AND is_active = 1 LIMIT 1")
      .bind(userId)
      .first<{ family_id: string }>();
    if (fam?.family_id) {
      if (caller.serviceRole || caller.familyIds.includes(fam.family_id)) {
        const previous = await c.env.DB
          .prepare("SELECT updated_at FROM child_locations WHERE user_id=? LIMIT 1")
          .bind(userId)
          .first<{ updated_at: string }>();
        if (!shouldReplaceCurrentLocation(previous?.updated_at, fixTime.atMs)) return c.body(null, 201);
        const write = await c.env.DB
          .prepare(CURRENT_LOCATION_UPSERT_SQL)
          .bind(
            userId,
            fam.family_id,
            lat,
            lng,
            fixTime.timestamp,
            accuracyM,
            currentLocationComparisonKey(fixTime.timestamp),
          )
          .run();
        if (Number(write.meta?.changes ?? 0) > 0) {
          c.executionCtx.waitUntil(recordFamilyLifecycleEvent(c.env, {
            familyId: fam.family_id,
            event: "first_location",
            occurredAt: fixTime.timestamp,
          }));
        }
      }
    }
  } catch (e) {
    console.error("[shim] locations post best-effort failed");
  }
  return c.body(null, 201);
}
