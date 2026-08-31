import { Hono } from "hono";
import type { Env, Vars } from "../types.ts";
import { requireAuth } from "../middleware/auth.ts";
import {
  FamilyMapContextError,
  loadFamilyMapContext,
  type FamilyMapContext,
} from "../lib/maps/familyContext.ts";
import { createKakaoMapAdapter } from "../lib/maps/kakao.ts";
import { MapService, MapServiceError } from "../lib/maps/service.ts";
import { MapRequestControlError } from "../lib/maps/errors.ts";
import type {
  MapDirectionsRequest,
  MapProviderAdapter,
  MapSearchRequest,
  ReverseSource,
} from "../lib/maps/types.ts";

const maps = new Hono<{ Bindings: Env; Variables: Vars }>();
const MAX_BODY_BYTES = 8 * 1024;

maps.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBody(c: Parameters<typeof requireAuth>[0] extends never ? never : any): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new MapServiceError("map_payload_too_large", 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new MapServiceError("invalid_json", 400);
  }
  if (!isRecord(value)) throw new MapServiceError("invalid_json", 400);
  return value;
}

function adapterForPolicy(env: Env, context: FamilyMapContext): MapProviderAdapter {
  if (context.policy.provider === "kakao") return createKakaoMapAdapter(env);
  if (context.policy.provider === "google") throw new MapServiceError("map_provider_not_configured", 503);
  throw new MapServiceError(`map_${context.policy.reason}`, 409);
}

function serviceFor(env: Env, context: FamilyMapContext): MapService {
  const secret = String(env.MAPS_SESSION_HMAC_SECRET ?? "").trim();
  if (secret.length < 32) throw new MapServiceError("map_request_control_unavailable", 503);
  let adapter: MapProviderAdapter;
  try {
    adapter = adapterForPolicy(env, context);
  } catch (error) {
    if (error instanceof MapServiceError) throw error;
    throw new MapServiceError("map_provider_not_configured", 503);
  }
  return new MapService({ db: env.DB, secret, context, adapter });
}

function errorResponse(c: any, error: unknown): Response {
  if (error instanceof FamilyMapContextError || error instanceof MapServiceError) {
    return c.json({ error: error.code }, error.status);
  }
  if (error instanceof MapRequestControlError) {
    return c.json({ error: error.code }, 503);
  }
  return c.json({ error: "map_upstream_unavailable" }, 502);
}

maps.post("/search", requireAuth, async (c) => {
  try {
    const body = await readBody(c);
    const context = await loadFamilyMapContext({
      db: c.env.DB,
      user: c.get("user"),
      familyId: body.familyId,
    });
    const action = body.action;
    if (action !== "start" && action !== "query" && action !== "select") {
      throw new MapServiceError("map_search_action_invalid", 400);
    }
    const request = action === "start"
      ? { action }
      : action === "query"
        ? {
            action,
            sessionHandle: String(body.sessionHandle ?? ""),
            query: String(body.query ?? ""),
            locale: String(body.locale ?? ""),
            ...(isRecord(body.bias) ? { bias: body.bias } : {}),
          }
        : {
            action,
            sessionHandle: String(body.sessionHandle ?? ""),
            providerPlaceId: String(body.providerPlaceId ?? ""),
          };
    return c.json(await serviceFor(c.env, context).search(request as MapSearchRequest));
  } catch (error) {
    return errorResponse(c, error);
  }
});

maps.post("/reverse", requireAuth, async (c) => {
  try {
    const body = await readBody(c);
    const context = await loadFamilyMapContext({
      db: c.env.DB,
      user: c.get("user"),
      familyId: body.familyId,
    });
    if (!isRecord(body.source) || typeof body.source.kind !== "string") {
      throw new MapServiceError("map_reverse_source_invalid", 400);
    }
    return c.json(await serviceFor(c.env, context).reverse(
      body.source as ReverseSource,
      String(body.locale ?? ""),
    ));
  } catch (error) {
    return errorResponse(c, error);
  }
});

maps.post("/directions", requireAuth, async (c) => {
  try {
    const body = await readBody(c);
    const context = await loadFamilyMapContext({
      db: c.env.DB,
      user: c.get("user"),
      familyId: body.familyId,
    });
    if (!isRecord(body.origin) || !isRecord(body.destination)) {
      throw new MapServiceError("map_route_ref_invalid", 400);
    }
    return c.json(await serviceFor(c.env, context).directions(
      { origin: body.origin, destination: body.destination } as MapDirectionsRequest,
      String(body.locale ?? ""),
    ));
  } catch (error) {
    return errorResponse(c, error);
  }
});

export default maps;
