import { registerPlugin } from "@capacitor/core";

export interface GoogleMapsPreflightResult {
  configured: boolean;
  playServicesStatus: "available" | "missing" | "update_required" | "unsupported";
}
interface GoogleMapsPreflightPlugin {
  preflight(): Promise<GoogleMapsPreflightResult>;
}

const plugin = registerPlugin<GoogleMapsPreflightPlugin>("GoogleMapsPreflight");

export async function preflightGoogleMaps(): Promise<GoogleMapsPreflightResult> {
  const result = await plugin.preflight();
  if (typeof result.configured !== "boolean" || !["available", "missing", "update_required", "unsupported"].includes(result.playServicesStatus)) {
    return { configured: false, playServicesStatus: "unsupported" };
  }
  return result;
}
