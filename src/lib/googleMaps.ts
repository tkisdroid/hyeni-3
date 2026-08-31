import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { GOOGLE_MAPS_WEB_KEY } from "@/config/env";
import { googleJsRegion } from "../../shared/googleRegion";

export interface GoogleMapsLibraries {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}
let activeTuple: string | null = null;
let loadPromise: Promise<GoogleMapsLibraries> | null = null;
let failed = false;

export function loadGoogleMaps(input: {
  locale: string;
  countryCode: string;
  retry?: boolean;
  apiKey?: string;
}): Promise<GoogleMapsLibraries> {
  const apiKey = (input.apiKey ?? GOOGLE_MAPS_WEB_KEY).trim();
  if (!apiKey) return Promise.reject(new Error("map_provider_unavailable"));
  const tuple = JSON.stringify([apiKey, input.locale, googleJsRegion(input.countryCode)]);
  if (activeTuple && activeTuple !== tuple) return Promise.reject(new Error("map_loader_context_changed"));
  if (failed && !input.retry) return Promise.reject(new Error("map_provider_unavailable"));
  if (loadPromise) return loadPromise;
  activeTuple = tuple;
  failed = false;
  setOptions({ key: apiKey, v: "weekly", language: input.locale, region: googleJsRegion(input.countryCode) });
  loadPromise = Promise.all([importLibrary("maps"), importLibrary("marker")])
    .then(([maps, marker]) => ({ maps, marker }))
    .catch((error: unknown) => {
      failed = true;
      loadPromise = null;
      throw error instanceof Error ? error : new Error("map_provider_unavailable");
    });
  return loadPromise;
}

export function resetGoogleMapsLoaderForTest(): void {
  activeTuple = null;
  loadPromise = null;
  failed = false;
}
