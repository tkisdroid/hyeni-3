import { googleServiceRegion } from "../../../shared/googleRegion.ts";
import { GOOGLE_MAP_SCOPES, type GoogleMapsTokenProvider } from "./googleOAuth.ts";
import type {
  LatLngPoint,
  MapProviderAdapter,
  MapSearchCandidate,
  MapSearchResponse,
  WalkingRouteResponse,
} from "./types.ts";

export const GOOGLE_FIELD_MASKS = {
  autocomplete: "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
  details: "id,displayName,formattedAddress,location",
  reverse: "results.formattedAddress,results.addressComponents.longText,results.addressComponents.types,results.placeId,results.types",
  reverseDetails: "id,displayName,types",
  routes: "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
} as const;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function languageCode(locale: string): string {
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(locale) ? locale : "en";
}

async function googleJson(input: {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  scope: string;
  fieldMask: string;
  tokenProvider: GoogleMapsTokenProvider;
  fetchImpl: FetchImplementation;
}): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(3_000);
  const accessToken = await input.tokenProvider.getAccessToken([input.scope], signal);
  let response: Response;
  try {
    response = await input.fetchImpl(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": input.fieldMask,
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal,
      cache: "no-store",
    });
  } catch {
    throw new Error("google_maps_upstream_unavailable");
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("google_maps_upstream_unavailable");
  }
  return value as Record<string, unknown>;
}

function unavailableRoute(): WalkingRouteResponse {
  return {
    policyProvider: "google",
    routeSource: "none",
    distanceMeters: null,
    durationSeconds: null,
    points: [],
    quality: "unavailable",
    warnings: ["walking_data_incomplete"],
  };
}

export function createGoogleMapAdapter(input: {
  countryCode: string;
  tokenProvider: GoogleMapsTokenProvider;
  fetchImpl?: FetchImplementation;
  /** Task 11에서 격리 service account의 표준 Routes v2 OAuth 지원을 실측한 뒤에만 true로 전환한다. */
  routesOauthVerified?: boolean;
}): MapProviderAdapter {
  const fetchImpl = input.fetchImpl ?? fetch;
  const regionCode = googleServiceRegion(input.countryCode);
  return {
    provider: "google",
    async search(query, locale, bias, providerSessionToken) {
      const data = await googleJson({
        url: "https://places.googleapis.com/v1/places:autocomplete",
        method: "POST",
        body: {
          input: query,
          languageCode: languageCode(locale),
          regionCode,
          includeQueryPredictions: false,
          sessionToken: providerSessionToken,
          ...(bias ? { locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50_000 } } } : {}),
        },
        scope: GOOGLE_MAP_SCOPES.autocomplete,
        fieldMask: GOOGLE_FIELD_MASKS.autocomplete,
        tokenProvider: input.tokenProvider,
        fetchImpl,
      });
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      return suggestions.flatMap<MapSearchCandidate>((suggestion) => {
        if (!suggestion || typeof suggestion !== "object") return [];
        const prediction = (suggestion as { placePrediction?: unknown }).placePrediction;
        if (!prediction || typeof prediction !== "object") return [];
        const item = prediction as {
          placeId?: unknown;
          structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
        };
        const placeId = typeof item.placeId === "string" ? item.placeId : "";
        const primaryText = typeof item.structuredFormat?.mainText?.text === "string" ? item.structuredFormat.mainText.text : "";
        if (!placeId || !primaryText) return [];
        const secondary = item.structuredFormat?.secondaryText?.text;
        return [{
          provider: "google",
          providerPlaceId: placeId,
          primaryText,
          secondaryText: typeof secondary === "string" && secondary.trim() ? secondary : null,
        }];
      });
    },
    async select(providerPlaceId, providerSessionToken) {
      const params = new URLSearchParams({ sessionToken: providerSessionToken, regionCode });
      const data = await googleJson({
        url: `https://places.googleapis.com/v1/places/${encodeURIComponent(providerPlaceId)}?${params}`,
        scope: GOOGLE_MAP_SCOPES.details,
        fieldMask: GOOGLE_FIELD_MASKS.details,
        tokenProvider: input.tokenProvider,
        fetchImpl,
      });
      const location = data.location as { latitude?: unknown; longitude?: unknown } | undefined;
      const lat = Number(location?.latitude);
      const lng = Number(location?.longitude);
      const displayName = data.displayName as { text?: unknown } | undefined;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof displayName?.text !== "string") {
        throw new Error("google_maps_place_invalid");
      }
      return {
        action: "select",
        provider: "google",
        point: { lat, lng },
        primaryText: displayName.text,
        secondaryText: typeof data.formattedAddress === "string" ? data.formattedAddress : null,
      } satisfies Extract<MapSearchResponse, { action: "select" }>;
    },
    async reverse(point, locale) {
      const params = new URLSearchParams({ languageCode: languageCode(locale), regionCode });
      const data = await googleJson({
        url: `https://geocode.googleapis.com/v4/geocode/location/${point.lat},${point.lng}?${params}`,
        scope: GOOGLE_MAP_SCOPES.reverse,
        fieldMask: GOOGLE_FIELD_MASKS.reverse,
        tokenProvider: input.tokenProvider,
        fetchImpl,
      });
      const first = Array.isArray(data.results) ? data.results[0] as Record<string, unknown> | undefined : undefined;
      if (!first || typeof first !== "object") return null;
      const address = typeof first.formattedAddress === "string" ? first.formattedAddress : null;
      const components = Array.isArray(first.addressComponents) ? first.addressComponents : [];
      for (const component of components) {
        const types = Array.isArray(component?.types) ? component.types : [];
        const name = typeof component?.longText === "string" ? component.longText.trim() : "";
        if (name && /[^\d\s-]/u.test(name) && types.some((type: string) => ["premise", "establishment", "point_of_interest"].includes(type))) return name;
      }
      // 역지오코딩이 특정 장소로 확인한 placeId만 상세 조회한다. 주변 검색의 첫 상호를 추정하지 않는다.
      const types = Array.isArray(first.types) ? first.types : [];
      if (typeof first.placeId === "string" && types.some(type => ["premise", "establishment", "point_of_interest"].includes(String(type)))) {
        try {
          const details = await googleJson({
            url: `https://places.googleapis.com/v1/places/${encodeURIComponent(first.placeId)}?${params}`,
            scope: GOOGLE_MAP_SCOPES.details,
            fieldMask: GOOGLE_FIELD_MASKS.reverseDetails,
            tokenProvider: input.tokenProvider,
            fetchImpl,
          });
          const name = (details.displayName as { text?: string } | undefined)?.text?.trim();
          const detailTypes = Array.isArray(details.types) ? details.types : [];
          if (name && details.id === first.placeId
            && detailTypes.some(type => ["premise", "establishment", "point_of_interest"].includes(String(type)))) return name;
        } catch {
          // 상호 상세 조회 장애가 이미 확인한 주소까지 없애지는 않는다.
        }
      }
      return address;
    },
    async directions(_origin: LatLngPoint, _destination: LatLngPoint, _locale: string) {
      // 표준 Routes v2 REST reference는 현재 OAuth scope를 명시하지 않는다. 광범위 scope/API key 우회 금지.
      if (!input.routesOauthVerified) return unavailableRoute();
      return unavailableRoute();
    },
  };
}
