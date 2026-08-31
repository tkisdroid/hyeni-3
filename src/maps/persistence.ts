import type { UserConfirmedPin } from "@/lib/api/endpoints/maps";

export function buildPersistedMapLocation(input: {
  label: string;
  pin: UserConfirmedPin;
}): { address: string; lat: number; lng: number } {
  const label = input.label.trim();
  if (!label) throw new Error("map_label_required");
  return { address: label, lat: input.pin.lat, lng: input.pin.lng };
}
