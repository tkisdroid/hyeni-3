import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { LoaderMark } from "@/components/ui/LoaderMark";
import { loadGoogleMaps } from "@/lib/googleMaps";
import type { FamilyMapProps } from "@/maps/contracts";

type Overlay = google.maps.Marker | google.maps.Circle | google.maps.Polyline;

export function GoogleMapAdapter({
  countryCode,
  child,
  zones = [],
  places = [],
  route = [],
  stays = [],
  destination = null,
  picked = null,
  center = null,
  centerLevel = null,
  recenterKey = 0,
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
        mapRef.current.setCenter(desired);
        if (centerLevel != null) mapRef.current.setZoom(Math.max(2, 20 - centerLevel));
        void recenterKey;
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
          if (!center) {
            const bounds = new google.maps.LatLngBounds();
            route.forEach((point) => bounds.extend(point));
            mapRef.current.fitBounds(bounds);
          }
        }
        setFailed(false);
        setReady(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [child, zones, places, route, stays, destination, picked, center, centerLevel, recenterKey, interactive, countryCode, intl.locale, retryKey]);

  useEffect(() => () => {
    listenerRef.current?.remove();
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
    mapRef.current = null;
  }, []);

  if (failed) {
    return (
      <div className={[className, "km-error"].filter(Boolean).join(" ")} role="status">
        <strong className="km-error__title">{intl.formatMessage({ id: "shared.map.providerUnavailable" })}</strong>
        <button type="button" className="km-error__retry hy-press" onClick={() => setRetryKey((value) => value + 1)}>
          {tone === "child" ? intl.formatMessage({ id: "shared.kakaoMap.copy005" }) : intl.formatMessage({ id: "shared.map.retry" })}
        </button>
      </div>
    );
  }
  return (
    <div className={[className, "km-host"].filter(Boolean).join(" ")}>
      <div ref={hostRef} className="km-canvas" />
      {!ready && <div className="km-skeleton" aria-hidden="true"><LoaderMark variant="location" /></div>}
    </div>
  );
}
