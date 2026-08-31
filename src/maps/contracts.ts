import type { MapViewportPadding } from "@/transform/mapViewportPadding";

export interface LatLngPoint {
  lat: number;
  lng: number;
}
export interface MapChild extends LatLngPoint {
  name: string;
  avatar: string;
  caption?: string;
  tone?: "normal" | "danger";
  measuredAt?: string | null;
  accuracyM?: number | null;
}

export interface MapZone extends LatLngPoint {
  radiusM: number;
  name: string;
}

export interface MapPlace extends LatLngPoint {
  name: string;
  isHome?: boolean;
}

export interface MapStay extends LatLngPoint {
  order: number;
  dwellLabel: string;
  placeName?: string | null;
  active?: boolean;
}

export interface MapScene {
  child?: MapChild | null;
  zones: MapZone[];
  places: MapPlace[];
  route: LatLngPoint[];
  stays: MapStay[];
  destination?: MapPlace | null;
  picked?: LatLngPoint | null;
  center?: LatLngPoint | null;
  centerLevel?: number | null;
  recenterKey: number;
  viewportPadding: Partial<MapViewportPadding>;
  interactive: boolean;
  onPick?: (point: LatLngPoint) => void;
}

export interface MapAdapterContext {
  locale: string;
  regionCode: string;
  surface: "web" | "android";
}

export interface MapController {
  update(scene: MapScene, generation: number, signal: AbortSignal): Promise<void>;
  setInteractive(enabled: boolean): Promise<void>;
  destroy(): Promise<void>;
}

export interface MapAdapter {
  mount(host: HTMLElement, scene: MapScene, context: MapAdapterContext): Promise<MapController>;
}

export interface FamilyMapProps {
  child?: MapChild | null;
  zones?: MapZone[];
  places?: MapPlace[];
  route?: LatLngPoint[];
  stays?: MapStay[];
  destination?: MapPlace | null;
  picked?: LatLngPoint | null;
  onPick?: (lat: number, lng: number) => void;
  center?: LatLngPoint | null;
  centerLevel?: number | null;
  recenterKey?: number;
  viewportPadding?: Partial<MapViewportPadding>;
  className?: string;
  tone?: "formal" | "child";
  interactive?: boolean;
}
