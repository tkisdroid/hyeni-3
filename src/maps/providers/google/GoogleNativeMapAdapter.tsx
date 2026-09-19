import { useEffect, useRef, useState } from "react";
import { GoogleMap, LatLngBounds } from "@capacitor/google-maps";
import { useIntl } from "react-intl";
import { LoaderMark } from "@/components/ui/LoaderMark";
import { preflightGoogleMaps } from "@/lib/native/googleMaps";
import { acquireNativeMapTransparency } from "@/maps/nativeSurface";
import { normalizeMapViewportPadding } from "@/transform/mapViewportPadding";
import type { FamilyMapProps } from "@/maps/contracts";

let nextMapId = 1;
type NativeScene = FamilyMapProps & { countryCode: string };
interface MapSession {
  map: GoogleMap;
  queue: Promise<void>;
  closed: boolean;
  markers: string[];
  circles: string[];
  lines: string[];
  focusKey: string;
  routeKey: string;
  zoom: number;
}

/** 같은 native surface의 갱신과 해제를 순서대로 처리한다. */
export function GoogleNativeMapAdapter(props: NativeScene) {
  const intl = useIntl();
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [session, setSession] = useState<MapSession | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let current: MapSession | null = null;
    let release: (() => void) | undefined;
    setFailed(false);
    setReady(false);
    setSession(null);
    const run = async () => {
      const host = hostRef.current;
      if (!host) return;
      const preflight = await preflightGoogleMaps();
      if (cancelled) return;
      if (!preflight.configured || preflight.playServicesStatus !== "available") throw new Error("map_google_play_services_unavailable");
      release = acquireNativeMapTransparency(host).release;
      const initial = propsRef.current;
      const map = await GoogleMap.create({
        id: `hyeni-family-map-${nextMapId++}`,
        element: host,
        apiKey: "",
        config: { center: initial.center ?? initial.child ?? { lat: 37.5665, lng: 126.978 }, zoom: 15 },
      });
      if (cancelled) {
        try { await map.destroy(); } finally { release(); }
        return;
      }
      current = { map, queue: Promise.resolve(), closed: false, markers: [], circles: [], lines: [], focusKey: "", routeKey: "", zoom: 15 };
      const owned = current;
      owned.queue = (async () => {
        await map.setOnMapClickListener((event) => {
          if (!owned.closed && propsRef.current.interactive !== false) propsRef.current.onPick?.(event.latitude, event.longitude);
        });
        if (owned.closed) return;
        await map.setOnCameraIdleListener((event) => { owned.zoom = event.zoom; });
      })();
      await owned.queue;
      if (!cancelled) setSession(owned);
    };
    void run().catch(async () => {
      if (current && !current.closed) {
        current.closed = true;
        try { await current.map.destroy(); } catch { /* 생성 도중 실패해도 배경은 복구한다. */ }
      }
      release?.();
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (!current || current.closed) return;
      const owned = current;
      owned.closed = true;
      // addMarkers 등이 끝나기 전에 destroy하면 늦은 응답이 다른 화면에 surface를 남길 수 있다.
      void owned.queue.catch(() => {}).then(() => owned.map.destroy()).catch(() => {}).finally(() => release?.());
    };
  }, [retryKey]);

  useEffect(() => {
    if (!session || session.closed) return;
    let cancelled = false;
    session.queue = session.queue.then(async () => {
      if (cancelled || session.closed) return;
      const { map } = session;
      const { child, center, picked, destination, zones = [], places = [], stays = [], route = [], interactive = true } = props;
      const padding = normalizeMapViewportPadding(props.viewportPadding);
      await map.setPadding(padding);
      if (session.closed) return;
      await (interactive ? map.enableTouch() : map.disableTouch());
      const desired = center ?? child ?? { lat: 37.5665, lng: 126.978 };
      const focusKey = JSON.stringify([desired.lat, desired.lng, props.recenterKey, props.centerLevel, padding]);
      if (session.focusKey !== focusKey) {
        const requestedZoom = props.centerLevel == null ? null : Math.max(2, 20 - props.centerLevel);
        await map.setCamera({ coordinate: desired, ...(requestedZoom != null && session.zoom < requestedZoom ? { zoom: requestedZoom } : {}) });
        session.focusKey = focusKey;
      }
      if (session.closed) return;
      if (session.markers.length) await map.removeMarkers(session.markers);
      if (session.circles.length) await map.removeCircles(session.circles);
      if (session.lines.length) await map.removePolylines(session.lines);
      session.markers = []; session.circles = []; session.lines = [];
      if (session.closed) return;
      const markers = [
        ...places.map((place) => ({ coordinate: place, title: place.name })),
        ...stays.map((stay) => ({ coordinate: stay, title: stay.placeName ?? stay.dwellLabel })),
        ...(destination ? [{ coordinate: destination, title: destination.name }] : []),
        ...(picked ? [{ coordinate: picked }] : []),
        ...(child ? [{ coordinate: child, title: child.name }] : []),
      ];
      if (markers.length) session.markers = await map.addMarkers(markers);
      if (session.closed) return;
      if (zones.length) session.circles = await map.addCircles(zones.map((zone) => ({
        center: zone, radius: zone.radiusM, strokeColor: "#E5484D", fillColor: "#24E5484D", strokeWidth: 2,
      })));
      if (session.closed) return;
      if (route.length >= 2) session.lines = await map.addPolylines([{ path: route, strokeColor: "#31C48D", strokeWeight: 6 }]);
      const routeKey = JSON.stringify(route);
      if (!center && route.length >= 2 && session.routeKey !== routeKey) {
        const bounds = new LatLngBounds({ southwest: route[0], northeast: route[0], center: route[0] });
        for (const point of route) await bounds.extend(point);
        if (!session.closed) await map.fitBounds(bounds, 24);
      }
      session.routeKey = routeKey;
      if (!cancelled && !session.closed) { setFailed(false); setReady(true); }
    }).catch(() => { if (!cancelled && !session.closed) setFailed(true); });
    return () => { cancelled = true; };
  }, [session, props]);

  return <div className={[props.className, "km-host"].filter(Boolean).join(" ")}>
    <div ref={hostRef} className="km-canvas" />
    {failed ? <div className="km-error" role="status">
      <strong className="km-error__title">{intl.formatMessage({ id: "shared.map.providerUnavailable" })}</strong>
      <button type="button" className="km-error__retry hy-press" onClick={() => setRetryKey((value) => value + 1)}>
        {intl.formatMessage({ id: "shared.map.retry" })}
      </button>
    </div> : !ready && <div className="km-skeleton" aria-hidden="true"><LoaderMark variant="location" /></div>}
  </div>;
}
