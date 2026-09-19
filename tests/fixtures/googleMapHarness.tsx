import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import { GoogleMapAdapter } from "../../src/maps/providers/google/GoogleMapAdapter";
import { GoogleNativeMapAdapter } from "../../src/maps/providers/google/GoogleNativeMapAdapter";
import { acquireNativeMapTransparency } from "../../src/maps/nativeSurface";
import "../../src/styles/tokens.css";
import "../../src/styles/components.css";
import "../../src/maps/FamilyMap.css";

const Adapter = location.search.includes("native") ? GoogleNativeMapAdapter : GoogleMapAdapter;
function Harness() {
  const [shown, setShown] = useState(true);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const [center, setCenter] = useState({ lat: 35.6812, lng: 139.7671 });
  return <IntlProvider locale="en" messages={{ "shared.map.retry": "Retry", "shared.map.providerUnavailable": "Map unavailable" }}>
    <button type="button" id="toggle" onClick={() => setShown(value => !value)}>화면 전환</button>
    <button type="button" id="pick" onClick={() => setPicked({ lat: 35.682, lng: 139.769 })}>핀 선택</button>
    <button type="button" id="recenter" onClick={() => setRecenterKey(value => value + 1)}>현재 위치</button>
    <button type="button" id="move" onClick={() => setCenter({ lat: 40.7851, lng: -73.9683 })}>미국 좌표</button>
    <output id="picked">{picked ? `${picked.lat},${picked.lng}` : ""}</output>
    <div id="surface" style={{ height: 460, position: "relative", background: "rgb(20, 30, 40)" }}>
      {shown && <Adapter className="fm-renderer" countryCode="JP" center={center} picked={picked} onPick={(lat, lng) => setPicked({ lat, lng })}
        centerLevel={5} recenterKey={recenterKey} viewportPadding={{ top: 40, bottom: 160 }} />}
    </div>
  </IntlProvider>;
}
Object.assign(window, { acquireNativeMapTransparency });
createRoot(document.getElementById("root")!).render(<Harness />);
