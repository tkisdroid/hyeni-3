export type MapErrorCode =
  | "map_country_unresolved"
  | "map_country_unsupported"
  | "map_provider_unavailable"
  | "map_google_play_services_unavailable"
  | "map_location_stale"
  | "map_quota_exceeded"
  | "map_network_unavailable"
  | "map_search_failed"
  | "map_reverse_failed"
  | "map_directions_failed";

export class FamilyMapError extends Error {
  readonly code: MapErrorCode;

  constructor(code: MapErrorCode) {
    super(code);
    this.code = code;
  }
}
