import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { LoaderMark } from "@/components/ui/LoaderMark";
import { loadGoogleMaps } from "@/lib/googleMaps";
import type { FamilyMapProps } from "@/maps/contracts";
import { getMapFocusPanOffset, normalizeMapViewportPadding } from "@/transform/mapViewportPadding";

type Overlay = google.maps.Marker | google.maps.Circle | google.maps.Polyline;
const EMPTY_ZONES: NonNullable<FamilyMapProps["zones"]> = [];
const EMPTY_PLACES: NonNullable<FamilyMapProps["places"]> = [];
const EMPTY_ROUTE: NonNullable<FamilyMapProps["route"]> = [];
const EMPTY_STAYS: NonNullable<FamilyMapProps["stays"]> = [];

export function GoogleMapAdapter({
  countryCode,
  child,
  zones = EMPTY_ZONES,
  places = EMPTY_PLACES,
  route = EMPTY_ROUTE,
  stays = EMPTY_STAYS,
  destination = null,
  picked = null,
  center = null,
  centerLevel = null,
  recenterKey = 0,
  viewportPadding,
  onPick,
  className,
  interactive = true,
  tone = "formal",
}: FamilyMapProps & { countryCode: string }) {
  const intl = useIntl();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Overlay[]>([]);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const onPickRef = useRef(onPick);
  const focusRef = useRef("");
  const routeRef = useRef("");
  const [retryKey, setRetryKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { onPickRef.current = onPick; }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps({ locale: intl.locale, countryCode, retry: retryKey > 0 })
      .then(({ maps }) => {
        if (cancelled || !hostRef.current) return;
        const desired = center ?? child ?? { lat: 37.5665, lng: 126.978 };
        if (!mapRef.current) {
          mapRef.current = new maps.Map(hostRef.current, {
            center: desired,
            zoom: 15,
            clickableIcons: interactive,
            disableDefaultUI: !interactive,
            gestureHandling: interactive ? "auto" : "none",
          });
          listenerRef.current = mapRef.current.addListener("click", (event: google.maps.MapMouseEvent) => {
            const point = event.latLng;
            if (point) onPickRef.current?.(point.lat(), point.lng());
          });
        }
        mapRef.current.setOptions({
          clickableIcons: interactive,
          disableDefaultUI: !interactive,
          gestureHandling: interactive ? "auto" : "none",
        });
        // 핀·주소 응답만 바뀌어도 사용자가 이동·확대한 지도를 되돌리지 않는다.
        const padding = normalizeMapViewportPadding(viewportPadding);
        const focusKey = JSON.stringify([desired.lat, desired.lng, recenterKey, centerLevel, padding]);
        if (focusRef.current !== focusKey) {
          mapRef.current.setCenter(desired);
          const zoom = centerLevel == null ? null : Math.max(2, 20 - centerLevel);
          if (zoom != null && (mapRef.current.getZoom() ?? 0) < zoom) mapRef.current.setZoom(zoom);
          const offset = getMapFocusPanOffset(padding);
          if (center && (offset.x || offset.y)) mapRef.current.panBy(offset.x, offset.y);
          focusRef.current = focusKey;
        }
        for (const overlay of overlaysRef.current) overlay.setMap(null);
        overlaysRef.current = [];
        const addMarker = (point: { lat: number; lng: number }, title?: string) => {
          const marker = new google.maps.Marker({ position: point, title, map: mapRef.current });
          overlaysRef.current.push(marker);
        };
        for (const zone of zones) {
          const circle = new google.maps.Circle({
            center: zone,
            radius: zone.radiusM,
            strokeColor: "#E5484D",
            strokeOpacity: 0.85,
            strokeWeight: 2,
            fillColor: "#E5484D",
            fillOpacity: 0.14,
            map: mapRef.current,
          });
          overlaysRef.current.push(circle);
        }
        places.forEach((place) => addMarker(place, place.name));
        stays.forEach((stay) => addMarker(stay, stay.placeName ?? stay.dwellLabel));
        if (destination) addMarker(destination, destination.name);
        if (picked) addMarker(picked);
        if (child) addMarker(child, child.name);
        if (route.length >= 2) {
          const polyline = new google.maps.Polyline({
            path: route,
            strokeColor: "#31C48D",
            strokeOpacity: 0.9,
            strokeWeight: 6,
            map: mapRef.current,
          });
          overlaysRef.current.push(polyline);
          if (!center && routeRef.current !== JSON.stringify(route)) {
            const bounds = new google.maps.LatLngBounds();
            route.forEach((point) => bounds.extend(point));
            mapRef.current.fitBounds(bounds, padding);
          }
        }
        routeRef.current = JSON.stringify(route);
        setFailed(false);
        setReady(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [child, zones, places, route, stays, destination, picked, center, centerLevel, recenterKey, viewportPadding, interactive, countryCode, intl.locale, retryKey]);

  useEffect(() => () => {
    listenerRef.current?.remove();
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
    mapRef.current = null;
    focusRef.current = "";
    routeRef.current = "";
  }, []);

  // 실패 안내 중에도 SDK host를 유지한다. host가 사라지면 재시도 성공 후에도 지도를 만들 수 없다.
  return (
    <div className={[className, "km-host"].filter(Boolean).join(" ")}>
      <div ref={hostRef} className="km-canvas" />
      {failed ? <div className="km-error" role="status">
        <strong className="km-error__title">{intl.formatMessage({ id: "shared.map.providerUnavailable" })}</strong>
        <button type="button" className="km-error__retry hy-press" onClick={() => {
          setFailed(false);
          setReady(false);
          setRetryKey((value) => value + 1);
        }}>
          {tone === "child" ? intl.formatMessage({ id: "shared.kakaoMap.copy005" }) : intl.formatMessage({ id: "shared.map.retry" })}
        </button>
      </div> : !ready && <div className="km-skeleton" aria-hidden="true"><LoaderMark variant="location" /></div>}
    </div>
  );
}
