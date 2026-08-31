export class MapRequestControlError extends Error {
  readonly code = "map_request_control_unavailable";

  constructor() {
    super("map_request_control_unavailable");
    this.name = "MapRequestControlError";
  }
}
