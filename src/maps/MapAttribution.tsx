export function MapAttribution({ provider }: { provider: "kakao" | "google" | "unsupported" }) {
  if (provider !== "google") return null;
  return <span className="fm-attribution" translate="no">Google Maps</span>;
}
