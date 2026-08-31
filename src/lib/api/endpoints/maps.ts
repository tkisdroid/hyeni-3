import { apiPost } from "../client";
import type { LatLngPoint } from "@/maps/contracts";

declare const ephemeralProviderContent: unique symbol;
declare const userConfirmedPin: unique symbol;

export type MapProvider = "kakao" | "google";
export type MapBiasRef =
  | { kind: "child_location"; childUserId: string; recordedAt?: string }
  | { kind: "saved_place"; savedPlaceId: string }
  | { kind: "academy"; academyId: string }
  | { kind: "event"; eventId: string };
export type ReverseSource = MapBiasRef | { kind: "picker_pin" | "memo_share"; lat: number; lng: number };
export interface MapDirectionsRequest { origin: MapBiasRef; destination: MapBiasRef }

export interface MapSearchSession {
  provider: MapProvider;
  sessionHandle: string;
  expiresAt: string;
}
export interface MapSearchCandidate {
  provider: MapProvider;
  providerPlaceId: string;
  primaryText: string;
  secondaryText: string | null;
}
export type EphemeralMapContent = { readonly [ephemeralProviderContent]: true };
export type EphemeralMapSearchCandidate = MapSearchCandidate & EphemeralMapContent;
export type MapSelectedPlace = EphemeralMapContent & MapSearchCandidate & { point: LatLngPoint };
export type UserConfirmedPin = LatLngPoint & { readonly [userConfirmedPin]: true };

export interface MapReverseResult {
  policyProvider: MapProvider;
  label: string | null;
  measuredAt: string | null;
}
export interface WalkingRouteResponse {
  policyProvider: MapProvider;
  routeSource: "kakao" | "ors" | "osrm" | "google" | "none";
  distanceMeters: number | null;
  durationSeconds: number | null;
  points: LatLngPoint[];
  quality: "provider_route" | "unavailable";
  warnings: Array<"walking_data_incomplete">;
}
function ephemeral<T extends object>(value: T): T & EphemeralMapContent {
  return value as T & EphemeralMapContent;
}

export const mapsApi = {
  async startSearch(familyId: string): Promise<MapSearchSession> {
    const value = await apiPost<{ action: "start" } & MapSearchSession>("/api/maps/search", { familyId, action: "start" });
    return { provider: value.provider, sessionHandle: value.sessionHandle, expiresAt: value.expiresAt };
  },
  async search(input: { familyId: string; sessionHandle: string; query: string; locale: string; bias?: MapBiasRef }): Promise<EphemeralMapSearchCandidate[]> {
    const value = await apiPost<{ candidates: MapSearchCandidate[] }>("/api/maps/search", { ...input, action: "query" });
    return (value.candidates ?? []).map(ephemeral);
  },
  async select(input: { familyId: string; sessionHandle: string; providerPlaceId: string }): Promise<MapSelectedPlace> {
    const value = await apiPost<MapSearchCandidate & { point: LatLngPoint }>("/api/maps/search", { ...input, action: "select" });
    return ephemeral(value);
  },
  reverse(input: { familyId: string; source: ReverseSource; locale: string }): Promise<MapReverseResult> {
    return apiPost("/api/maps/reverse", input);
  },
  directions(input: { familyId: string; locale: string } & MapDirectionsRequest): Promise<WalkingRouteResponse> {
    return apiPost("/api/maps/directions", input);
  },
};

export function confirmPinFromMapGesture(point: LatLngPoint): UserConfirmedPin {
  if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 || !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) {
    throw new Error("map_coordinates_invalid");
  }
  return { lat: point.lat, lng: point.lng } as UserConfirmedPin;
}
