import { parseJson } from "../serialize.ts";
import {
  consumeAutocompleteHandleAtomically,
  createAutocompleteSession,
  deriveProviderSessionToken,
} from "./autocompleteSession.ts";
import { claimMapQuota, type MapQuotaAction } from "./quota.ts";
import type {
  LatLngPoint,
  MapBiasRef,
  MapDirectionsRequest,
  MapProviderAdapter,
  MapReverseResponse,
  MapSearchRequest,
  MapSearchResponse,
  ResolvedMapPoint,
  ReverseSource,
  WalkingRouteResponse,
} from "./types.ts";
import type { FamilyMapContext } from "./familyContext.ts";

export class MapServiceError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 429 | 502 | 503;

  constructor(code: string, status: 400 | 404 | 409 | 429 | 502 | 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validPoint(point: unknown): point is LatLngPoint {
  if (!point || typeof point !== "object") return false;
  const value = point as Partial<LatLngPoint>;
  return typeof value.lat === "number" && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90
    && typeof value.lng === "number" && Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180;
}

function maxSevenDecimals(value: number): boolean {
  return Math.abs(value * 10_000_000 - Math.round(value * 10_000_000)) < 1e-7;
}

function isRawReverseSource(
  source: ReverseSource,
): source is Extract<ReverseSource, { kind: "picker_pin" | "memo_share" }> {
  return source.kind === "picker_pin" || source.kind === "memo_share";
}

function pointFromLocation(value: unknown): LatLngPoint | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return validPoint(parsed) ? { lat: parsed.lat, lng: parsed.lng } : null;
}

export async function resolveMapPoint(
  db: D1Database,
  familyId: string,
  ref: MapBiasRef,
): Promise<ResolvedMapPoint> {
  if (ref.kind === "child_location") {
    const child = await db.prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1`,
    ).bind(familyId, ref.childUserId).first<{ ok: number }>();
    if (!child) throw new MapServiceError("map_object_not_found", 404);
    if (ref.recordedAt) {
      const row = await db.prepare(
        `SELECT lat,lng,recorded_at FROM location_history
          WHERE family_id=? AND user_id=? AND recorded_at=? LIMIT 1`,
      ).bind(familyId, ref.childUserId, ref.recordedAt).first<{ lat: number; lng: number; recorded_at: string }>();
      if (!row || !validPoint(row)) throw new MapServiceError("map_object_not_found", 404);
      return { point: { lat: Number(row.lat), lng: Number(row.lng) }, measuredAt: row.recorded_at };
    }
    const row = await db.prepare(
      "SELECT lat,lng,updated_at FROM child_locations WHERE family_id=? AND user_id=? LIMIT 1",
    ).bind(familyId, ref.childUserId).first<{ lat: number; lng: number; updated_at: string }>();
    if (!row || !validPoint(row)) throw new MapServiceError("map_object_not_found", 404);
    return { point: { lat: Number(row.lat), lng: Number(row.lng) }, measuredAt: row.updated_at };
  }

  const table = ref.kind === "saved_place" ? "saved_places" : ref.kind === "academy" ? "academies" : "events";
  const id = ref.kind === "saved_place" ? ref.savedPlaceId : ref.kind === "academy" ? ref.academyId : ref.eventId;
  const row = await db.prepare(`SELECT location FROM ${table} WHERE id=? AND family_id=? LIMIT 1`)
    .bind(id, familyId)
    .first<{ location: string | null }>();
  const point = pointFromLocation(row?.location);
  if (!point) throw new MapServiceError("map_object_not_found", 404);
  return { point, measuredAt: null };
}

function normalizeLocale(value: unknown): string {
  const locale = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(locale) ? locale : "en";
}

export class MapService {
  private readonly input: {
    db: D1Database;
    secret: string;
    context: FamilyMapContext;
    adapter: MapProviderAdapter;
    nowMs?: () => number;
  };

  constructor(input: {
    db: D1Database;
    secret: string;
    context: FamilyMapContext;
    adapter: MapProviderAdapter;
    nowMs?: () => number;
  }) {
    this.input = input;
  }

  private nowMs(): number {
    return this.input.nowMs?.() ?? Date.now();
  }

  private async quota(action: MapQuotaAction) {
    const claim = await claimMapQuota({
      db: this.input.db,
      secret: this.input.secret,
      userId: this.input.context.userId,
      familyId: this.input.context.familyId,
      action,
      nowMs: this.nowMs(),
    });
    if (!claim.allowed) throw new MapServiceError("map_rate_limited", 429);
  }

  async search(request: MapSearchRequest): Promise<MapSearchResponse> {
    const provider = this.input.adapter.provider;
    if (request.action === "start") {
      const session = await createAutocompleteSession({
        db: this.input.db,
        secret: this.input.secret,
        userId: this.input.context.userId,
        familyId: this.input.context.familyId,
        provider,
        nowMs: this.nowMs(),
      });
      return { action: "start", provider, sessionHandle: session.handle, expiresAt: session.expiresAt };
    }
    const sessionInput = {
      handle: request.sessionHandle,
      secret: this.input.secret,
      userId: this.input.context.userId,
      familyId: this.input.context.familyId,
      provider,
      nowMs: this.nowMs(),
    } as const;
    let providerSessionToken: string;
    try {
      providerSessionToken = await deriveProviderSessionToken(sessionInput);
    } catch {
      throw new MapServiceError("map_search_session_invalid", 409);
    }
    if (request.action === "query") {
      const query = request.query.trim();
      const length = [...query].length;
      if (length < 2 || length > 100) throw new MapServiceError("map_search_query_invalid", 400);
      const bias = request.bias
        ? (await resolveMapPoint(this.input.db, this.input.context.familyId, request.bias)).point
        : null;
      await this.quota("autocomplete");
      const candidates = await this.input.adapter.search(query, normalizeLocale(request.locale), bias, providerSessionToken);
      return { action: "query", provider, candidates };
    }
    if (!request.providerPlaceId.trim() || request.providerPlaceId.length > 512) {
      throw new MapServiceError("map_place_invalid", 400);
    }
    await this.quota("details");
    const consumed = await consumeAutocompleteHandleAtomically({
      ...sessionInput,
      db: this.input.db,
      providerPlaceId: request.providerPlaceId,
    });
    if (consumed !== "consumed") throw new MapServiceError("map_search_session_invalid", 409);
    return this.input.adapter.select(request.providerPlaceId, providerSessionToken);
  }

  async reverse(source: ReverseSource, locale: string): Promise<MapReverseResponse> {
    let resolved: ResolvedMapPoint;
    if (isRawReverseSource(source)) {
      if (!validPoint(source) || !maxSevenDecimals(source.lat) || !maxSevenDecimals(source.lng)) {
        throw new MapServiceError("map_coordinates_invalid", 400);
      }
      resolved = { point: { lat: source.lat, lng: source.lng }, measuredAt: null };
      await this.quota("reverse_raw");
    } else {
      resolved = await resolveMapPoint(this.input.db, this.input.context.familyId, source);
      await this.quota("reverse_object");
    }
    const label = await this.input.adapter.reverse(resolved.point, normalizeLocale(locale));
    return { policyProvider: this.input.adapter.provider, label, measuredAt: resolved.measuredAt };
  }

  async directions(request: MapDirectionsRequest, locale: string): Promise<WalkingRouteResponse> {
    const [origin, destination] = await Promise.all([
      resolveMapPoint(this.input.db, this.input.context.familyId, request.origin),
      resolveMapPoint(this.input.db, this.input.context.familyId, request.destination),
    ]);
    if (request.origin.kind === "child_location" && !request.origin.recordedAt) {
      const measuredMs = Date.parse(origin.measuredAt ?? "");
      if (!Number.isFinite(measuredMs) || this.nowMs() - measuredMs > 5 * 60_000) {
        throw new MapServiceError("map_location_stale", 409);
      }
    }
    await this.quota("directions");
    return this.input.adapter.directions(origin.point, destination.point, normalizeLocale(locale));
  }
}
