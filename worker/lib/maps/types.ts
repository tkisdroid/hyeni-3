export interface LatLngPoint {
  lat: number;
  lng: number;
}

export type MapBiasRef =
  | { kind: "child_location"; childUserId: string; recordedAt?: string }
  | { kind: "saved_place"; savedPlaceId: string }
  | { kind: "academy"; academyId: string }
  | { kind: "event"; eventId: string };

export type MapSearchRequest =
  | { action: "start" }
  | { action: "query"; sessionHandle: string; query: string; locale: string; bias?: MapBiasRef }
  | { action: "select"; sessionHandle: string; providerPlaceId: string };

export interface MapSearchCandidate {
  provider: "kakao" | "google";
  providerPlaceId: string;
  primaryText: string;
  secondaryText: string | null;
}

export type MapSearchResponse =
  | { action: "start"; provider: "kakao" | "google"; sessionHandle: string; expiresAt: string }
  | { action: "query"; provider: "kakao" | "google"; candidates: MapSearchCandidate[] }
  | {
      action: "select";
      provider: "kakao" | "google";
      point: LatLngPoint;
      primaryText: string;
      secondaryText: string | null;
    };

export type ReverseSource = MapBiasRef | {
  kind: "picker_pin" | "memo_share";
  lat: number;
  lng: number;
};

export type MapRoutePointRef = MapBiasRef;

export interface MapDirectionsRequest {
  origin: MapRoutePointRef;
  destination: MapRoutePointRef;
}

export interface MapReverseResponse {
  policyProvider: "kakao" | "google";
  label: string | null;
  measuredAt: string | null;
}

export type WalkingRouteResponse =
  | {
      policyProvider: "kakao" | "google";
      routeSource: "kakao" | "ors" | "osrm" | "google";
      distanceMeters: number;
      durationSeconds: number | null;
      points: LatLngPoint[];
      quality: "provider_route";
      warnings: Array<"walking_data_incomplete">;
    }
  | {
      policyProvider: "kakao" | "google";
      routeSource: "none";
      distanceMeters: null;
      durationSeconds: null;
      points: [];
      quality: "unavailable";
      warnings: Array<"walking_data_incomplete">;
    };

export interface ResolvedMapPoint {
  point: LatLngPoint;
  measuredAt: string | null;
}

export interface MapProviderAdapter {
  readonly provider: "kakao" | "google";
  search(query: string, locale: string, bias: LatLngPoint | null, providerSessionToken: string): Promise<MapSearchCandidate[]>;
  select(providerPlaceId: string, providerSessionToken: string): Promise<Extract<MapSearchResponse, { action: "select" }>>;
  reverse(point: LatLngPoint, locale: string): Promise<string | null>;
  directions(origin: LatLngPoint, destination: LatLngPoint, locale: string): Promise<WalkingRouteResponse>;
}
