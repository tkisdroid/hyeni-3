import { useEffect, useRef, useState } from "react";
import { GoogleMap } from "@capacitor/google-maps";
import { useIntl } from "react-intl";
import { LoaderMark } from "@/components/ui/LoaderMark";
import { preflightGoogleMaps } from "@/lib/native/googleMaps";
import { acquireNativeMapTransparency } from "@/maps/nativeSurface";
import type { FamilyMapProps } from "@/maps/contracts";

let nextMapId = 1;

export function GoogleNativeMapAdapter({
  child,
  zones = [],
  places = [],
  route = [],
  stays = [],
  destination,
  picked,
  center,
  onPick,
  className,
  interactive = true,
}: FamilyMapProps & { countryCode: string }) {
  const intl = useIntl();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const onPickRef = useRef(onPick);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { onPickRef.current = onPick; }, [onPick]);

  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | null = null;
    let currentMap: GoogleMap | null = null;
    const run = async () => {
      const host = hostRef.current;
      if (!host) return;
      const preflight = await preflightGoogleMaps();
      if (!preflight.configured || preflight.playServicesStatus !== "available") throw new Error("map_google_play_services_unavailable");
      const lease = acquireNativeMapTransparency(host);
      release = lease.release;
      const desired = center ?? child ?? { lat: 37.5665, lng: 126.978 };
      currentMap = await GoogleMap.create({
        id: `hyeni-family-map-${nextMapId++}`,
        element: host,
        apiKey: "",
        config: { center: desired, zoom: 15 },
      });
      if (controller.signal.aborted) {
        await currentMap.destroy();
        release();
        return;
      }
      mapRef.current = currentMap;
      await currentMap.setOnMapClickListener((event) => onPickRef.current?.(event.latitude, event.longitude));
      if (!interactive) await currentMap.disableTouch();
      const markers = [
        ...places.map((place) => ({ coordinate: place, title: place.name })),
        ...stays.map((stay) => ({ coordinate: stay, title: stay.placeName ?? stay.dwellLabel })),
        ...(destination ? [{ coordinate: destination, title: destination.name }] : []),
        ...(picked ? [{ coordinate: picked }] : []),
        ...(child ? [{ coordinate: child, title: child.name }] : []),
      ];
      if (markers.length) await currentMap.addMarkers(markers);
      if (zones.length) await currentMap.addCircles(zones.map((zone) => ({
        center: zone,
        radius: zone.radiusM,
        strokeColor: "#E5484D",
        fillColor: "#24E5484D",
        strokeWidth: 2,
      })));
      if (route.length >= 2) await currentMap.addPolylines([{ path: route, strokeColor: "#31C48D", strokeWeight: 6 }]);
      setFailed(false);
      setReady(true);
    };
    void run().catch(() => {
      release?.();
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      const map = mapRef.current ?? currentMap;
      mapRef.current = null;
      void map?.destroy().finally(() => release?.());
    };
  }, [child, zones, places, route, stays, destination, picked, center, interactive]);

  if (failed) return <div className={[className, "km-error"].filter(Boolean).join(" ")} role="status">{intl.formatMessage({ id: "shared.map.googlePlayServicesUnavailable" })}</div>;
  return <div className={[className, "km-host"].filter(Boolean).join(" ")}><div ref={hostRef} className="km-canvas" />{!ready && <div className="km-skeleton" aria-hidden="true"><LoaderMark variant="location" /></div>}</div>;
}
