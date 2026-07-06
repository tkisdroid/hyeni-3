// src/components/route/RouteOverlay.jsx
// 도보 길안내 오버레이 — 실시간 GPS 추적 + Kakao 도보 경로 + compass.
// Extracted from App.jsx (Phase 5 #4 / B15).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { haversineM, sumRouteDistance } from "../../lib/trailMath.js";
import { DESIGN, FF } from "../../lib/styleHelpers.js";
import { KAKAO_APP_KEY } from "../../lib/kakaoMap.js";
import { escHtml } from "../../lib/htmlEscape.js";
import { fetchWalkingRoute, ROUTE_REQUEST_TIMEOUT_MS } from "../../lib/walkingRoute.js";
import {
    HYENI_DEFAULT_CHILD_IMAGE_CROP,
    HYENI_DEFAULT_CHILD_IMAGE_STYLE_HTML,
    HYENI_DEFAULT_CHILD_IMAGE_URL,
} from "../../lib/childDefaultImage.js";
import { FallbackMapCanvas } from "../map/FallbackMapCanvas.jsx";
import { MapZoomControls } from "../map/MapZoomControls.jsx";
import { deferEffectStateUpdate } from "../../lib/deferEffectStateUpdate.js";

function childMarkerImageHtml(photoUrl) {
    const safePhotoUrl = typeof photoUrl === "string" && photoUrl.trim() ? photoUrl : "";
    const src = safePhotoUrl || HYENI_DEFAULT_CHILD_IMAGE_URL;
    const style = safePhotoUrl
        ? "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"
        : HYENI_DEFAULT_CHILD_IMAGE_STYLE_HTML;
    const cropAttrs = safePhotoUrl ? "" : ` data-hyeni-default-child-image data-hyeni-default-child-image-crop="${HYENI_DEFAULT_CHILD_IMAGE_CROP}"`;
    return `<img src="${escHtml(src)}" alt="" aria-hidden="true"${cropAttrs} style="${style}" />`;
}

export function RouteOverlay({ ev, childPos, childProfile = null, mapReady, mapLoadError = "", onClose, isChildMode = false }) {
    const mapRef = useRef();
    const mapInst = useRef();
    const myMarkerRef = useRef(null);
    const polylineRef = useRef(null);
    const shadowPolyRef = useRef(null);
    const startOverlayRef = useRef(null);      // "출발" label overlay
    const arrowOverlaysRef = useRef([]);        // direction arrow overlays
    const routePathRef = useRef(null); // cached route coords for re-render
    const [routeInfo, setRouteInfo] = useState(null);
    const [livePos, setLivePos] = useState(childPos); // real-time GPS tracking
    const [isTracking, setIsTracking] = useState(false);
    const [gpsError, setGpsError] = useState(() => typeof navigator !== "undefined" && !navigator.geolocation);   // GPS failure flag
    const [centered, setCentered] = useState(true);
    const [mapType, setMapType] = useState("roadmap"); // "hybrid" or "roadmap"
    const [guidanceStarted, setGuidanceStarted] = useState(false);
    const [heading, setHeading] = useState(null); // device compass heading in degrees
    const watchIdRef = useRef(null);
    const routeInitDoneRef = useRef(false);
    const routeRequestRef = useRef(null);
    const lastRoutePosRef = useRef(null);
    const suppressViewportEventRef = useRef(false);

    // Compute live distance/time
    const currentPos = livePos || childPos;
    const currentMarkerColor = childProfile?.color_hex || childPos?.color_hex || childPos?.color || "var(--theme-accent)";
    const currentMarkerPhotoUrl = childProfile?.photo_url || childPos?.photo_url || "";
    const currentMarkerLabel = isChildMode ? "내 위치" : `${childProfile?.name || "아이"} 위치`;
    const detailedRoutePoints = useMemo(
        () => (Array.isArray(routeInfo?.points) && routeInfo.points.length >= 2 && !routeInfo.error
            ? routeInfo.points
            : []),
        [routeInfo],
    );
    const hasDetailedWalkingRoute = detailedRoutePoints.length >= 2;
    const liveDist = currentPos && ev.location
        ? haversineM(currentPos.lat, currentPos.lng, ev.location.lat, ev.location.lng)
        : null;
    const displayDist = hasDetailedWalkingRoute
        ? (routeInfo?.distance ?? sumRouteDistance(detailedRoutePoints))
        : null;
    const displayMin = routeInfo?.duration != null
        ? Math.max(1, Math.round(routeInfo.duration / 60))
        : displayDist != null ? Math.max(1, Math.round(displayDist / 67)) : null;
    const distLabel = displayDist != null
        ? displayDist >= 1000 ? `${(displayDist / 1000).toFixed(1)}km` : `${Math.round(displayDist)}m`
        : null;
    const timeLabel = displayMin != null
        ? displayMin >= 60
            ? `${Math.floor(displayMin / 60)}시간 ${displayMin % 60 > 0 ? `${displayMin % 60}분` : ""}`
            : `${displayMin}분`
        : null;
    const canStartGuidance = Boolean(currentPos && ev.location && hasDetailedWalkingRoute);

    useEffect(() => {
        if (isChildMode) return undefined;
        return deferEffectStateUpdate(() => {
            setLivePos(childPos || null);
            setGpsError(false);
            setIsTracking(false);
        });
    }, [childPos, isChildMode]);

    // Start real-time GPS tracking only on the child's own device. In parent
    // mode the route must stay anchored to the child's reported position.
    useEffect(() => {
        if (!isChildMode) return;
        if (!navigator.geolocation) return;
        // 즉시 현재 위치 획득 (watch 첫 응답 전 빈 상태 방지)
        navigator.geolocation.getCurrentPosition(
            (pos) => { setLivePos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsError(false); },
            () => { setGpsError(true); },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 10000 }
        );
        const wid = navigator.geolocation.watchPosition(
            (pos) => {
                const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setLivePos(newPos);
                setGpsError(false);
            },
            () => { setGpsError(true); },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
        watchIdRef.current = wid;
        const cancelTrackingState = deferEffectStateUpdate(() => setIsTracking(true));
        return () => {
            cancelTrackingState();
            navigator.geolocation.clearWatch(wid);
            setIsTracking(false);
        };
    }, [isChildMode]);

    // Compass heading via DeviceOrientationEvent
    useEffect(() => {
        let handler;
        const startListening = () => {
            handler = (e) => {
                // iOS provides webkitCompassHeading, Android uses alpha
                const h = e.webkitCompassHeading != null
                    ? e.webkitCompassHeading
                    : (e.alpha != null ? (360 - e.alpha) : null);
                if (h != null) setHeading(h);
            };
            window.addEventListener("deviceorientation", handler, true);
        };
        // iOS 13+ requires permission request
        if (typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function") {
            DeviceOrientationEvent.requestPermission()
                .then(state => { if (state === "granted") startListening(); })
                .catch(() => {});
        } else {
            startListening();
        }
        return () => {
            if (handler) window.removeEventListener("deviceorientation", handler, true);
        };
    }, []);

    // Update my-marker + start overlay position in real-time
    useEffect(() => {
        if (!livePos || !mapInst.current || !myMarkerRef.current) return;
        const newLL = new window.kakao.maps.LatLng(livePos.lat, livePos.lng);
        myMarkerRef.current.setPosition(newLL);
        if (startOverlayRef.current) startOverlayRef.current.setPosition(newLL);
        if (centered) mapInst.current.panTo(newLL);
    }, [livePos, centered]);

    // Re-fetch route when position changes significantly (>50m)
    const createWalkingArrows = useCallback((map, path, color) => {
        const arrows = [];
        if (!path || path.length < 4) return arrows;
        const interval = Math.max(4, Math.floor(path.length / 8));
        for (let i = interval; i < path.length - 2; i += interval) {
            const p1 = path[i - 1];
            const p2 = path[i + 1];
            const lat1 = p1.getLat() * Math.PI / 180;
            const lat2 = p2.getLat() * Math.PI / 180;
            const dLng = (p2.getLng() - p1.getLng()) * Math.PI / 180;
            const y = Math.sin(dLng) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
            const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            const arrowSvg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="white" stroke="${color}" stroke-width="2"/><path d="M14 7 L19 17 L14 14 L9 17 Z" fill="${color}" transform="rotate(${bearing}, 14, 14)"/></svg>`)}`;
            const overlay = new window.kakao.maps.CustomOverlay({
                map, position: path[i], yAnchor: 0.5, zIndex: 3,
                content: `<img src="${arrowSvg}" width="26" height="26" style="display:block;pointer-events:none" />`
            });
            arrows.push(overlay);
        }
        return arrows;
    }, []);

    const clearRouteDrawing = useCallback(() => {
        if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
        if (shadowPolyRef.current) { shadowPolyRef.current.setMap(null); shadowPolyRef.current = null; }
        arrowOverlaysRef.current.forEach(o => o.setMap(null));
        arrowOverlaysRef.current = [];
    }, []);

    const markProgrammaticViewportChange = useCallback(() => {
        suppressViewportEventRef.current = true;
        window.setTimeout(() => {
            suppressViewportEventRef.current = false;
        }, 500);
    }, []);

    // eslint-disable-next-line no-unused-vars
    const handleManualViewportChange = useCallback(() => {
        if (suppressViewportEventRef.current) return;
        setCentered(false);
    }, []);

    const fitRouteBounds = useCallback((path, startLL, destLL, padding = 80) => {
        if (!mapInst.current || !path?.length) return;
        const bounds = new window.kakao.maps.LatLngBounds();
        path.forEach(p => bounds.extend(p));
        if (startLL) bounds.extend(startLL);
        if (destLL) bounds.extend(destLL);
        markProgrammaticViewportChange();
        mapInst.current.setBounds(bounds, padding);
    }, [markProgrammaticViewportChange]);

    const drawRoutePath = useCallback((path, { dashed = false, fit = false, startLL = null, destLL = null } = {}) => {
        if (!mapInst.current || !path?.length) return;
        clearRouteDrawing();
        routePathRef.current = path;

        shadowPolyRef.current = new window.kakao.maps.Polyline({
            map: mapInst.current,
            path,
            strokeWeight: dashed ? 10 : 14,
            strokeColor: "#FFFFFF",
            strokeOpacity: 0.9,
            strokeStyle: "solid"
        });

        polylineRef.current = new window.kakao.maps.Polyline({
            map: mapInst.current,
            path,
            strokeWeight: dashed ? 6 : 8,
            strokeColor: "#E65C92",
            strokeOpacity: dashed ? 0.8 : 0.95,
            strokeStyle: dashed ? "shortdash" : "solid"
        });

        if (!dashed) {
            arrowOverlaysRef.current = createWalkingArrows(mapInst.current, path, "#E65C92");
        }
        if (fit) fitRouteBounds(path, startLL, destLL);
    }, [clearRouteDrawing, createWalkingArrows, fitRouteBounds]);

    const drawWalkingRoutePoints = useCallback((points, start, destination, { fit = false } = {}) => {
        if (!mapInst.current || !window.kakao?.maps?.LatLng || !Array.isArray(points) || points.length < 2 || !start || !destination) return;
        const startLL = new window.kakao.maps.LatLng(start.lat, start.lng);
        const destLL = new window.kakao.maps.LatLng(destination.lat, destination.lng);
        const path = points.map((point) => new window.kakao.maps.LatLng(point.lat, point.lng));
        drawRoutePath(path, { fit, startLL, destLL });
    }, [drawRoutePath]);

    const drawWalkingRoute = useCallback(async (start, destination, { fit = false, signal } = {}) => {
        if (!start || !destination) return;

        setRouteInfo((prev) => ({
            distance: prev?.distance ?? null,
            duration: prev?.duration ?? null,
            points: prev?.points ?? [],
            loading: true,
            error: false,
        }));

        try {
            const route = await fetchWalkingRoute(start, destination, signal);
            if (signal?.aborted) {
                if (signal.reason === "replaced") return;
                throw new Error("walking route request timed out");
            }
            const points = Array.isArray(route?.points) ? route.points : [];
            if (points.length < 2) throw new Error("walking route returned too few points");
            drawWalkingRoutePoints(points, start, destination, { fit });
            setRouteInfo({
                distance: route.distance ?? sumRouteDistance(points),
                duration: route.duration ?? null,
                points,
                start,
                destination,
                loading: false,
                error: false,
                provider: route.provider,
            });
        } catch (error) {
            if (signal?.aborted && signal.reason === "replaced") return;
            console.warn("[Guidance] Walking route failed; no straight fallback:", {
                message: error?.message || String(error),
                status: error?.status || error?.statusCode || null,
                start,
                destination,
            });
            clearRouteDrawing();
            routePathRef.current = null;
            setRouteInfo({
                distance: null,
                duration: null,
                points: [],
                loading: false,
                error: true,
                provider: "walking_unavailable",
                message: "도보 경로를 불러오지 못했어요",
            });
        }
    }, [clearRouteDrawing, drawWalkingRoutePoints]);

    const requestWalkingRoute = useCallback((start, destination, { fit = false } = {}) => {
        if (!start || !destination) return;
        if (routeRequestRef.current) routeRequestRef.current.abort("replaced");

        const controller = new AbortController();
        routeRequestRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort("timeout"), ROUTE_REQUEST_TIMEOUT_MS);

        drawWalkingRoute(start, destination, { fit, signal: controller.signal })
            .finally(() => {
                clearTimeout(timeoutId);
                if (routeRequestRef.current === controller) routeRequestRef.current = null;
            });
    }, [drawWalkingRoute]);

    useEffect(() => {
        return () => {
            if (routeRequestRef.current) routeRequestRef.current.abort("replaced");
            lastRoutePosRef.current = null;
        };
    }, []);

    useEffect(() => {
        const mapEl = mapRef.current;
        if (!mapEl) return;
        const markManual = () => setCentered(false);
        mapEl.addEventListener("pointerdown", markManual, { passive: true });
        mapEl.addEventListener("touchstart", markManual, { passive: true });
        mapEl.addEventListener("wheel", markManual, { passive: true });
        return () => {
            mapEl.removeEventListener("pointerdown", markManual);
            mapEl.removeEventListener("touchstart", markManual);
            mapEl.removeEventListener("wheel", markManual);
        };
    }, []);

    useEffect(() => {
        if (!currentPos || !ev.location) return;
        if (lastRoutePosRef.current) {
            const moved = haversineM(currentPos.lat, currentPos.lng, lastRoutePosRef.current.lat, lastRoutePosRef.current.lng);
            if (moved < 50) return;
        }
        const startPos = { ...currentPos };
        const destination = ev.location;
        lastRoutePosRef.current = startPos;
        requestWalkingRoute(startPos, destination, { fit: Boolean(mapInst.current) });
    }, [currentPos, ev.location, requestWalkingRoute]);

    // Initialize map + route
    useEffect(() => {
        if (!mapReady || !mapRef.current || !ev.location) return;

        const destLL = new window.kakao.maps.LatLng(ev.location.lat, ev.location.lng);

        // 지도 + 목적지 마커는 한 번만 생성
        if (!mapInst.current) {
            mapInst.current = new window.kakao.maps.Map(mapRef.current, {
                center: destLL, level: 4,
                mapTypeId: window.kakao.maps.MapTypeId.ROADMAP
            });
            // 도착지 마커 — 깃발 + 이름
            new window.kakao.maps.CustomOverlay({
                map: mapInst.current, position: destLL, yAnchor: 1.4, zIndex: 5,
                content: `<div style="display:flex;flex-direction:column;align-items:center">
                    <div style="background:${ev.color};color:white;padding:8px 14px;border-radius:16px;font-size:14px;font-weight: 760;box-shadow:0 4px 16px rgba(0,0,0,0.25);font-family:var(--font-sans);border:2px solid white">🏁 ${escHtml(ev.title)}</div>
                    <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:12px solid ${ev.color}"></div>
                </div>`
            });
        }

        // 위치가 아직 없거나 이미 초기화 완료면 경로 계산 건너뜀
        if (!currentPos || routeInitDoneRef.current) return;
        routeInitDoneRef.current = true;

        const startPos = currentPos;
        const myLL = new window.kakao.maps.LatLng(startPos.lat, startPos.lng);

        // ── 내 위치 마커 (이동 가능) — 기본 혜니 이미지 + 선택 테마색 ──
        const myOverlay = new window.kakao.maps.CustomOverlay({
            map: mapInst.current, position: myLL, yAnchor: 0.85, zIndex: 10,
            content: `<div style="display:flex;flex-direction:column;align-items:center;font-family:var(--font-sans)">
                <div style="width:56px;height:56px;border-radius:20px;background:#fff;border:3px solid ${currentMarkerColor};box-shadow:0 0 0 8px color-mix(in srgb, ${currentMarkerColor} 18%, transparent),0 7px 18px rgba(15,23,42,0.22);display:flex;align-items:center;justify-content:center;line-height:1;overflow:hidden;position:relative">${childMarkerImageHtml(currentMarkerPhotoUrl)}</div>
                <div style="margin-top:5px;background:${currentMarkerColor};color:white;padding:5px 10px;border-radius:12px;font-size:11px;font-weight: 760;box-shadow:0 4px 12px rgba(15,23,42,0.18);white-space:nowrap">${escHtml(currentMarkerLabel)}</div>
            </div>`
        });
        myMarkerRef.current = myOverlay;

        // ── "출발" 라벨 오버레이 (내 위치 위에) ──
        const startOv = new window.kakao.maps.CustomOverlay({
            map: mapInst.current, position: myLL, yAnchor: 2.6, zIndex: 9,
            content: `<div style="background:linear-gradient(135deg,var(--status-positive),#059669);color:white;padding:6px 14px;border-radius:12px;font-size:13px;font-weight: 760;box-shadow:0 3px 12px rgba(16,185,129,0.4);font-family:var(--font-sans);border:2px solid white">🚶 출발</div>`
        });
        startOverlayRef.current = startOv;

    }, [mapReady, ev, currentPos, currentMarkerColor, currentMarkerPhotoUrl, currentMarkerLabel]);

    useEffect(() => {
        if (!mapReady || !mapInst.current || !routeInfo?.start || !routeInfo?.destination || !hasDetailedWalkingRoute) return;
        drawWalkingRoutePoints(detailedRoutePoints, routeInfo.start, routeInfo.destination, { fit: true });
    }, [mapReady, routeInfo?.start, routeInfo?.destination, hasDetailedWalkingRoute, detailedRoutePoints, drawWalkingRoutePoints]);

    const recenterMap = () => {
        if (!mapInst.current || !currentPos) return;
        setCentered(true);
        const latlng = new window.kakao.maps.LatLng(currentPos.lat, currentPos.lng);
        markProgrammaticViewportChange();
        mapInst.current.setLevel(1, { animate: true });
        mapInst.current.panTo(latlng);
    };

    const toggleMapType = () => {
        if (!mapInst.current) return;
        const next = mapType === "hybrid" ? "roadmap" : "hybrid";
        setMapType(next);
        mapInst.current.setMapTypeId(
            next === "hybrid" ? window.kakao.maps.MapTypeId.HYBRID : window.kakao.maps.MapTypeId.ROADMAP
        );
    };

    const fitFullRoute = () => {
        if (!mapInst.current || !currentPos || !ev.location) return;
        setCentered(false);
        const bounds = new window.kakao.maps.LatLngBounds();
        bounds.extend(new window.kakao.maps.LatLng(currentPos.lat, currentPos.lng));
        bounds.extend(new window.kakao.maps.LatLng(ev.location.lat, ev.location.lng));
        if (routePathRef.current) routePathRef.current.forEach(p => bounds.extend(p));
        mapInst.current.setBounds(bounds, 60);
    };

    const startInAppGuidance = () => {
        setGuidanceStarted(true);
        fitFullRoute();
    };

    // Cleanup overlays on unmount
    useEffect(() => {
        return () => {
            arrowOverlaysRef.current.forEach(o => o.setMap(null));
            arrowOverlaysRef.current = [];
            if (startOverlayRef.current) { startOverlayRef.current.setMap(null); startOverlayRef.current = null; }
            if (myMarkerRef.current) { myMarkerRef.current.setMap(null); myMarkerRef.current = null; }
        };
    }, []);

    // Arrived check
    const arrived = liveDist != null && liveDist < 100;

    // Child-friendly bunny encouragement messages
    const bunnyEncouragement = (() => {
        if (!isChildMode || liveDist == null) return null;
        if (arrived) return { emoji: "🎉", msg: "도착이야! 잘했어! 🐰💕" };
        if (liveDist < 200) return { emoji: "🐰", msg: "거의 다 왔어! 조금만 더!" };
        if (liveDist < 500) return { emoji: "🏃", msg: "잘 가고 있어! 화이팅~!" };
        if (displayMin != null && displayMin <= 5) return { emoji: "🐰", msg: "금방 도착해! 힘내!" };
        return { emoji: "🐰", msg: "천천히 안전하게 가자~!" };
    })();

    const sheetCardStyle = {
        background: "rgba(255,255,255,0.92)",
        borderRadius: 26,
        padding: "14px 14px 16px",
        boxShadow: "0 18px 48px rgba(15, 23, 42, 0.16)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(255,255,255,0.8)",
    };
    const fallbackMapSubtitle = mapLoadError || (KAKAO_APP_KEY ? "지도 연결 중" : "지도 설정을 확인하지 못해 간이 지도 표시");

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: DESIGN.gradients.map, display: "flex", flexDirection: "column", fontFamily: FF }}>
            {/* Navigation Header */}
            <div style={{ padding: "12px 16px", paddingTop: "max(12px, env(safe-area-inset-top))", background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, zIndex: 2 }}>
                <button onClick={onClose} style={{ background: "var(--bg-muted)", border: "none", borderRadius: 12, width: 40, height: 40, cursor: "pointer", fontWeight: 700, fontSize: 18, fontFamily: FF, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-secondary)", flexShrink: 0 }}>←</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.emoji} {ev.title}</div>
                    <div style={{ fontSize: 11, color: "var(--fg-tertiary)", marginTop: 1 }}>
                        ⏰ {ev.time} {ev.location?.address ? `· 📍 ${ev.location.address.split(" ").slice(0, 3).join(" ")}` : ""}
                    </div>
                </div>
                {isChildMode && isTracking && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--theme-accent-text)", background: "var(--theme-accent-soft)", padding: "4px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--theme-accent)", animation: "pulse 1.5s infinite" }} />
                        위치
                    </div>
                )}
            </div>

            {/* Route info bar */}
            {routeInfo?.error && !routeInfo?.loading && (
                <div style={{
                    margin: "0 16px", marginTop: 10, background: "var(--status-cautionary-subtle)",
                    borderRadius: 20, padding: "14px 20px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    display: "flex", alignItems: "center", gap: 14, zIndex: 2,
                    border: "1px solid #FED7AA"
                }}>
                    <div style={{ width: 48, height: 48, borderRadius: 16, background: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                        🚶
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 760, fontSize: 16, color: "var(--status-cautionary-strong)" }}>
                            도보 경로를 불러오지 못했어요
                        </div>
                        <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 2 }}>
                            {isChildMode ? "조금 뒤에 다시 열어줘" : "잠시 후 다시 열면 상세 도보 경로로 다시 확인해요"}
                        </div>
                    </div>
                </div>
            )}
            {!routeInfo?.loading && distLabel && (
                <div style={{
                    margin: "0 16px", marginTop: 10, background: arrived ? "var(--status-positive-subtle)" : "white",
                    borderRadius: 20, padding: "14px 20px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    display: "flex", alignItems: "center", gap: 14, zIndex: 2
                }}>
                    <div style={{ width: 48, height: 48, borderRadius: 16, background: arrived ? "#ECFDF5" : ev.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                        {arrived ? "🎉" : "🚶"}
                    </div>
                    <div style={{ flex: 1 }}>
                        {arrived ? (
                            <>
                                <div style={{ fontWeight: 760, fontSize: 18, color: "var(--status-safe-text)" }}>{isChildMode ? "도착이야! 잘했어! 🐰" : "도착했어요!"}</div>
                                <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 2 }}>{isChildMode ? "목적지에 잘 도착했어! 💕" : "목적지 근처에 있어요"}</div>
                            </>
                        ) : (
                            <>
                                <div style={{ fontWeight: 760, fontSize: 20, color: ev.color }}>{distLabel}</div>
                                <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 2 }}>
                                    도보 약 {timeLabel}
                                </div>
                                {bunnyEncouragement && (
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--theme-accent-text)", marginTop: 4 }}>
                                        {bunnyEncouragement.emoji} {bunnyEncouragement.msg}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    {!arrived && displayMin != null && !routeInfo?.error && (
                        <div style={{ textAlign: "center", flexShrink: 0 }}>
                            <div style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 600 }}>도착 예정</div>
                            <div style={{ fontSize: 16, fontWeight: 760, color: "var(--fg-primary)", marginTop: 2 }}>
                                {(() => {
                                    const now = new Date();
                                    const eta = new Date(now.getTime() + displayMin * 60000);
                                    return `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
                                })()}
                            </div>
                        </div>
                    )}
                </div>
            )}
            {routeInfo?.loading && (
                <div style={{ margin: "0 16px", marginTop: 10, background: "white", borderRadius: 20, padding: "14px 20px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)", textAlign: "center", zIndex: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-secondary)" }}>🔍 경로 검색 중...</div>
                </div>
            )}

            {/* Map */}
            <div style={{ flex: 1, margin: "10px 16px", borderRadius: 24, overflow: "hidden", boxShadow: "var(--hyeni-theme-shadow-soft)", position: "relative", minHeight: 0, border: "2px solid var(--theme-accent-line)" }}>
                {!mapReady && (
                    <FallbackMapCanvas
                        center={currentPos || ev.location}
                        children={currentPos ? [{ ...currentPos, name: isChildMode ? "내 위치" : `${childProfile?.name || "아이"} 위치`, color: currentMarkerColor, photo_url: currentMarkerPhotoUrl || null }] : []}
                        eventPlaces={ev.location ? [{ key: ev.id || "destination", title: ev.title, emoji: ev.emoji || "📍", color: ev.color || DESIGN.colors.pink, location: ev.location }] : []}
                        routePoints={detailedRoutePoints}
                        title={ev.title || "경로"}
                        subtitle={fallbackMapSubtitle}
                        showRadius={Boolean(currentPos)}
                    />
                )}
                <div ref={mapRef} style={{ width: "100%", height: "100%", display: mapReady ? "block" : "none" }} />
                {mapReady && <MapZoomControls mapObj={mapInst} onManualZoom={() => setCentered(false)} />}

                {/* GPS 위치 찾는 중 / 오류 오버레이 */}
                {!currentPos && (
                    <div style={{
                        position: "absolute", inset: 0, zIndex: 20,
                        background: "var(--glass-sheet-bg)", backdropFilter: "blur(4px)",
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12
                    }}>
                        {gpsError ? (
                            <>
                                <div style={{ fontSize: 40 }}>📍</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--status-cautionary-strong)", fontFamily: FF }}>
                                    위치를 찾을 수 없어요
                                </div>
                                <div style={{ fontSize: 12, color: "var(--fg-secondary)", fontFamily: FF, textAlign: "center", lineHeight: 1.5 }}>
                                    위치 사용이 꺼져 있거나<br />위치 허용이 필요해요
                                </div>
                                <button onClick={() => {
                                    setGpsError(false);
                                    navigator.geolocation?.getCurrentPosition(
                                        (pos) => { setLivePos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsError(false); },
                                        () => { setGpsError(true); },
                                        { enableHighAccuracy: true, timeout: 10000 }
                                    );
                                }} style={{
                                    marginTop: 4, padding: "10px 24px", borderRadius: 14,
                                    background: "var(--hyeni-theme-gradient)", border: "none",
                                    color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer",
                                    fontFamily: FF, boxShadow: "var(--hyeni-theme-shadow-soft)"
                                }}>
                                    다시 찾기
                                </button>
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 40, animation: "pulse 1.5s infinite" }}>📍</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--theme-accent-text)", fontFamily: FF }}>
                                    내 위치를 찾고 있어요...
                                </div>
                                <div style={{ fontSize: 12, color: "var(--fg-tertiary)", fontFamily: FF }}>
                                    위치 신호를 기다리는 중
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Heading compass indicator (top-right) */}
                {mapReady && heading != null && (
                    <div style={{ position: "absolute", left: 14, top: 14, zIndex: 5, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{
                            width: 48, height: 48, borderRadius: "50%", background: "white",
                            boxShadow: "0 2px 12px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center",
                            position: "relative"
                        }}>
                            <div style={{ position: "absolute", top: 3, fontSize: 8, fontWeight: 700, color: "var(--status-negative)", fontFamily: FF }}>N</div>
                            <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: `rotate(${heading}deg)`, transition: "transform 0.3s ease-out" }}>
                                <polygon points="16,4 12,20 16,17 20,20" fill="var(--theme-accent)" stroke="var(--theme-accent-text)" strokeWidth="1" />
                                <polygon points="16,28 12,20 16,17 20,20" fill="var(--line-strong)" stroke="var(--fg-tertiary)" strokeWidth="0.5" />
                            </svg>
                        </div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "var(--fg-secondary)", marginTop: 2, fontFamily: FF }}>
                            {Math.round(heading)}°
                        </div>
                    </div>
                )}

                {/* Map overlay buttons */}
                {mapReady && <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 5 }}>
                    <button onClick={toggleMapType} title="지도 타입"
                        style={{ width: 44, height: 44, borderRadius: 14, background: "white", border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "var(--fg-secondary)", fontFamily: FF }}>
                        {mapType === "hybrid" ? "🛣️" : "🛰️"}
                    </button>
                    <button onClick={recenterMap} title="내 위치"
                        style={{
                            minWidth: 56, height: 56, borderRadius: 16, padding: "0 16px",
                            background: centered ? "var(--hyeni-theme-gradient)" : "white",
                            border: centered ? "none" : "2px solid var(--theme-accent-line)",
                            cursor: "pointer", boxShadow: centered ? "var(--hyeni-theme-shadow-soft)" : "0 2px 8px rgba(0,0,0,0.15)",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                            fontSize: 14, fontWeight: 700, color: centered ? "white" : "var(--theme-accent-text)", fontFamily: FF,
                            transition: "all 0.2s ease"
                        }}>
                        {isChildMode ? "🐰 내 위치" : "🐰 아이 위치"}
                    </button>
                    <button onClick={fitFullRoute} title="전체 경로"
                        style={{ width: 44, height: 44, borderRadius: 14, background: "white", border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--fg-secondary)" }}>
                        🗺️
                    </button>
                </div>}
            </div>

            {/* Bottom route sheet */}
            <div style={{ padding: "0 16px max(28px, calc(28px + env(safe-area-inset-bottom)))", flexShrink: 0 }}>
                <div style={sheetCardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-tertiary)", letterSpacing: 0.2 }}>{isChildMode ? "🐰 길찾기" : "ROUTE"}</div>
                            <div style={{ fontSize: 16, fontWeight: 760, color: "var(--fg-primary)", marginTop: 2 }}>
                                {arrived
                                    ? (isChildMode ? "도착! 잘했어! 💕" : "도착 완료")
                                    : (guidanceStarted ? "길안내를 시작했어요" : "안전하게 가자")}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <div style={{ padding: "7px 10px", borderRadius: 999, background: arrived ? "var(--status-positive-subtle)" : ev.bg, color: arrived ? "var(--status-safe-text)" : ev.color, fontSize: 11, fontWeight: 700 }}>
                                {arrived ? "근처 도착" : distLabel || "도보 경로 확인"}
                            </div>
                            {displayMin != null && (
                                <div style={{ padding: "7px 10px", borderRadius: 999, background: "var(--theme-accent-soft)", color: "var(--theme-accent-text)", fontSize: 11, fontWeight: 700 }}>
                                    도보 {timeLabel}
                                </div>
                            )}
                            {routeInfo?.error && (
                                <div style={{ padding: "7px 10px", borderRadius: 999, background: "var(--bg-subtle)", color: "var(--theme-accent-text)", fontSize: 11, fontWeight: 700 }}>
                                    도보 경로 필요
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            onClick={guidanceStarted ? fitFullRoute : startInAppGuidance}
                            disabled={!canStartGuidance}
                            style={{ flex: 1, padding: "15px 14px", borderRadius: 18, border: "none", cursor: canStartGuidance ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 700, fontFamily: FF, color: "white", background: canStartGuidance ? "var(--hyeni-theme-gradient)" : "#D1D5DB", boxShadow: canStartGuidance ? "var(--hyeni-theme-shadow-soft)" : "none" }}
                        >
                            {guidanceStarted ? "전체 경로 보기" : "길안내 시작"}
                        </button>
                        <button
                            onClick={onClose}
                            style={{ padding: "15px 16px", borderRadius: 18, border: "1px solid var(--line-soft)", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: FF, color: "var(--fg-secondary)", background: "#FFFFFF" }}
                        >
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
