import { lazy, Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import { useActiveChild } from "@/app/activeChild";
import { useIntl } from "react-intl";
import { LoaderMark } from "@/components/ui/LoaderMark";
import type { FamilyMapProps, LatLngPoint } from "./contracts";
import { UnsupportedMapAdapter } from "./providers/unsupported/UnsupportedMapAdapter";
import "./FamilyMap.css";

const KakaoMapAdapter = lazy(() => import("./providers/kakao/KakaoMapAdapter").then((module) => ({
  default: module.KakaoMapAdapter,
})));
const GoogleMapAdapter = lazy(() => import("./providers/google/GoogleMapAdapter").then((module) => ({
  default: module.GoogleMapAdapter,
})));
const GoogleNativeMapAdapter = lazy(() => import("./providers/google/GoogleNativeMapAdapter").then((module) => ({
  default: module.GoogleNativeMapAdapter,
})));

function pointLabel(point: LatLngPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function AccessibleMapContent(props: FamilyMapProps) {
  const points = [
    ...(props.child ? [{ name: props.child.name, point: props.child }] : []),
    ...(props.places ?? []).map((place) => ({ name: place.name, point: place })),
    ...(props.destination ? [{ name: props.destination.name, point: props.destination }] : []),
  ];
  return (
    <div className="fm-accessible">
      <ul>
        {points.map(({ name, point }, index) => (
          <li key={`${name}-${index}`}>
            <button type="button" onClick={() => props.onPick?.(point.lat, point.lng)}>
              {name} — {pointLabel(point)}
            </button>
          </li>
        ))}
      </ul>
      {props.picked && <output>{pointLabel(props.picked)}</output>}
    </div>
  );
}

export function FamilyMap(props: FamilyMapProps) {
  const intl = useIntl();
  const { mapPolicy: policy, familyError, retryFamily } = useActiveChild();
  if (familyError) {
    return (
      <div className={[props.className, "fm-unavailable"].filter(Boolean).join(" ")} role="alert">
        <strong>{intl.formatMessage({ id: "shared.map.providerUnavailable" })}</strong>
        <button type="button" className="hy-btn" onClick={() => void retryFamily()}>
          {intl.formatMessage({ id: "shared.map.retry" })}
        </button>
      </div>
    );
  }
  if (!policy) {
    return <div className={[props.className, "fm-loading"].filter(Boolean).join(" ")}><LoaderMark variant="location" /></div>;
  }
  if (policy.provider === "unsupported") return <UnsupportedMapAdapter {...props} policy={policy} />;
  return (
    <div className={[props.className, "fm-shell"].filter(Boolean).join(" ")}>
      <Suspense fallback={<div className="fm-loading"><LoaderMark variant="location" /></div>}>
        {policy.provider === "kakao"
          ? <KakaoMapAdapter {...props} className="fm-renderer" />
          : Capacitor.isNativePlatform()
            ? <GoogleNativeMapAdapter {...props} className="fm-renderer" countryCode={policy.countryCode} />
            : <GoogleMapAdapter {...props} className="fm-renderer" countryCode={policy.countryCode} />}
      </Suspense>
      <AccessibleMapContent {...props} />
    </div>
  );
}

export type { FamilyMapProps, LatLngPoint, MapChild, MapPlace, MapStay, MapZone } from "./contracts";
