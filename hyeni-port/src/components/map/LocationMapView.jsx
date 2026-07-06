// src/components/map/LocationMapView.jsx
// 부모 모드 지도 뷰: 자녀 위치 + 일정 장소 + 자주 가는 장소 표시.
// 다중 자녀(2명+)일 때 자녀별 색/이름 라벨 마커, 단일 자녀는 파란 점.
// Extracted from App.jsx (Phase 5 #4 / B6).

import { useEffect, useMemo, useRef, useState } from "react";
import { buildEventPlaceItems, buildSavedPlaceItems, getPlaceLocationKey } from "../../lib/placeFormat.js";
import { haversineM } from "../../lib/trailMath.js";
import { DESIGN, FF } from "../../lib/styleHelpers.js";
import { KAKAO_APP_KEY } from "../../lib/kakaoMap.js";
import { escHtml } from "../../lib/htmlEscape.js";
import { CHILD_MARKER_COLORS } from "../../lib/markerColors.js";
import {
    HYENI_DEFAULT_CHILD_IMAGE_CROP,
    HYENI_DEFAULT_CHILD_IMAGE_STYLE_HTML,
    HYENI_DEFAULT_CHILD_IMAGE_URL,
} from "../../lib/childDefaultImage.js";
import { FallbackMapCanvas } from "./FallbackMapCanvas.jsx";
import { MapZoomControls } from "./MapZoomControls.jsx";

function childMarkerImageHtml(child) {
    const photoUrl = typeof child?.photo_url === "string" && child.photo_url.trim() ? child.photo_url : "";
    const src = photoUrl || HYENI_DEFAULT_CHILD_IMAGE_URL;
    const style = photoUrl
        ? "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"
        : HYENI_DEFAULT_CHILD_IMAGE_STYLE_HTML;
    const cropAttrs = photoUrl ? "" : ` data-hyeni-default-child-image data-hyeni-default-child-image-crop="${HYENI_DEFAULT_CHILD_IMAGE_CROP}"`;
    return `<img src="${escHtml(src)}" alt="" aria-hidden="true"${cropAttrs} style="${style}" />`;
}

export function LocationMapView({
    events,
    childPos,
    mapReady,
    mapLoadError = "",
    arrivedSet,
    locationHint = "",
    savedPlaces = [],
    academies = [],
    dangerZones = [],
    isParentMode = false,
    savedPlacesLocked = false,
    onAddSavedPlace,
    displayChildPositions = [],
    pairedChildren = [],
}) {
    const mapRef = useRef();
    const mapObj = useRef();
    const markersRef = useRef([]);
    const myMarkerRef = useRef();
    const childPinsRef = useRef([]);
    const initialBoundsAppliedRef = useRef(false);
    const [selected, setSelected] = useState(null);

    const savedPlaceItems = useMemo(() => buildSavedPlaceItems(savedPlaces), [savedPlaces]);
    const savedPlaceKeys = useMemo(
        () => new Set(savedPlaceItems.map((place) => getPlaceLocationKey(place.location)).filter(Boolean)),
        [savedPlaceItems]
    );
    const eventPlaceItems = useMemo(
        () => buildEventPlaceItems(events, savedPlaceKeys, arrivedSet),
        [arrivedSet, events, savedPlaceKeys]
    );
    const center = childPos || (eventPlaceItems[0]?.location) || (savedPlaceItems[0]?.location) || { lat: 37.5665, lng: 126.9780 };
    const fallbackMapSubtitle = mapLoadError || (KAKAO_APP_KEY ? "지도 연결 중" : "지도 설정을 확인하지 못해 간이 지도 표시");
    const distLabel = (meters) => (meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`);

    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        if (!mapObj.current) {
            mapObj.current = new window.kakao.maps.Map(mapRef.current, {
                center: new window.kakao.maps.LatLng(center.lat, center.lng),
                level: 5
            });
        }
        mapObj.current.relayout();

        // Clear old markers
        markersRef.current.forEach(m => m.setMap(null));
        markersRef.current = [];
        if (myMarkerRef.current) { myMarkerRef.current.setMap(null); myMarkerRef.current = null; }
        childPinsRef.current.forEach(m => m.setMap(null));
        childPinsRef.current = [];

        // 다중 자녀 핀: 학부모 + 자녀 2명 이상이면 자녀별 색상 + 이름 라벨 마커
        const multiChildPins = isParentMode && Array.isArray(displayChildPositions) && displayChildPositions.length > 1;
        if (multiChildPins) {
            displayChildPositions.forEach((pos) => {
                if (!Number.isFinite(Number(pos?.lat)) || !Number.isFinite(Number(pos?.lng))) return;
                const child = pairedChildren.find((c) => c.user_id === pos.user_id);
                const color = child?.color_hex || "#F779A8";
                const name = child?.name || "아이";
                // Labeled pin: default Hyeni image + 이름 badge with colored border + dot under
                const content = `
                    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;font-family:var(--font-sans)">
                        <div style="background:#FFFFFF;color:#171719;padding:5px 10px 5px 6px;border-radius:999px;border:2px solid ${color};box-shadow:0 2px 10px rgba(15,15,18,0.16);display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;white-space:nowrap;letter-spacing:0;max-width:140px">
                            <span style="width:22px;height:22px;border-radius:9px;overflow:hidden;position:relative;display:inline-flex;flex-shrink:0;background:#fff;border:1px solid ${color}33">${childMarkerImageHtml(child)}</span>
                            <span style="overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span>
                        </div>
                        <div style="width:14px;height:14px;background:${color};border:2.5px solid #FFFFFF;border-radius:50%;box-shadow:0 2px 6px ${color}66;margin-top:-3px"></div>
                    </div>`;
                const overlay = new window.kakao.maps.CustomOverlay({
                    position: new window.kakao.maps.LatLng(Number(pos.lat), Number(pos.lng)),
                    content,
                    yAnchor: 1, xAnchor: 0.5,
                });
                overlay.setMap(mapObj.current);
                childPinsRef.current.push(overlay);
            });
        } else if (childPos) {
            // 단일 자녀(또는 자녀 모드): 기존 단일 파란 점
            const myOverlay = new window.kakao.maps.CustomOverlay({
                position: new window.kakao.maps.LatLng(childPos.lat, childPos.lng),
                content: '<div style="width:18px;height:18px;background:var(--theme-accent);border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(247,107,166,0.5)"></div>',
                yAnchor: 0.5, xAnchor: 0.5
            });
            myOverlay.setMap(mapObj.current);
            myMarkerRef.current = myOverlay;
        }

        // Event location markers
        const bounds = new window.kakao.maps.LatLngBounds();
        let boundCount = 0;
        if (multiChildPins) {
            displayChildPositions.forEach((pos) => {
                if (!Number.isFinite(Number(pos?.lat)) || !Number.isFinite(Number(pos?.lng))) return;
                bounds.extend(new window.kakao.maps.LatLng(Number(pos.lat), Number(pos.lng)));
                boundCount += 1;
            });
        } else if (childPos) {
            bounds.extend(new window.kakao.maps.LatLng(childPos.lat, childPos.lng));
            boundCount += 1;
        }

        eventPlaceItems.forEach((place) => {
            const pos = new window.kakao.maps.LatLng(place.location.lat, place.location.lng);
            bounds.extend(pos);
            boundCount += 1;

            const nextEvent = place.nextEvent;
            const arrived = place.arrivedCount > 0 && place.arrivedCount === place.eventCount;
            const overlay = new window.kakao.maps.CustomOverlay({
                position: pos,
                content: `<div style="display:flex;flex-direction:column;align-items:center;cursor:pointer" data-marker-key="event:${place.key}">
                    <div style="background:${arrived ? 'var(--status-safe)' : nextEvent?.color || 'var(--theme-accent)'};color:white;padding:6px 10px;border-radius:14px;font-size:12px;font-weight: 700;box-shadow:0 3px 12px rgba(0,0,0,0.2);white-space:nowrap;font-family:var(--font-sans)">
                        ${escHtml(nextEvent?.emoji || '📍')} ${escHtml(place.title)}${place.eventCount > 1 ? ` · ${place.eventCount}` : ''}${arrived ? ' ✅' : ''}
                    </div>
                    <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${arrived ? 'var(--status-safe)' : nextEvent?.color || 'var(--theme-accent)'}"></div>
                </div>`,
                yAnchor: 1.3, xAnchor: 0.5
            });
            overlay.setMap(mapObj.current);
            markersRef.current.push(overlay);
        });

        savedPlaceItems.forEach((place) => {
            const pos = new window.kakao.maps.LatLng(place.location.lat, place.location.lng);
            bounds.extend(pos);
            boundCount += 1;

            const overlay = new window.kakao.maps.CustomOverlay({
                position: pos,
                content: `<div style="display:flex;flex-direction:column;align-items:center;cursor:pointer" data-marker-key="saved:${place.id}">
                    <div style="background:var(--theme-accent);color:white;padding:6px 10px;border-radius:14px;font-size:12px;font-weight: 700;box-shadow:var(--hyeni-theme-shadow-soft);white-space:nowrap;font-family:var(--font-sans)">
                        📍 ${escHtml(place.name)}
                    </div>
                    <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--theme-accent)"></div>
                </div>`,
                yAnchor: 1.3,
                xAnchor: 0.5,
            });
            overlay.setMap(mapObj.current);
            markersRef.current.push(overlay);
        });

        if (boundCount > 0 && !initialBoundsAppliedRef.current) {
            mapObj.current.setBounds(bounds, 60);
            initialBoundsAppliedRef.current = true;
        }
    }, [mapReady, childPos, eventPlaceItems, savedPlaceItems, academies, dangerZones, center.lat, center.lng, isParentMode, displayChildPositions, pairedChildren]);

    // Handle click on overlay via map container click delegation
    useEffect(() => {
        const mapEl = mapRef.current;
        if (!mapEl) return;
        const handler = (e) => {
            const target = e.target.closest('[data-marker-key]');
            if (target) {
                const id = target.dataset.markerKey;
                setSelected(prev => prev === id ? null : id);
            }
        };
        mapEl.addEventListener('click', handler);
        return () => mapEl.removeEventListener('click', handler);
    }, []);

    const selectedEventPlace = selected?.startsWith("event:") ? eventPlaceItems.find((place) => `event:${place.key}` === selected) : null;
    const selectedPlace = selected?.startsWith("saved:") ? savedPlaceItems.find(place => `saved:${place.id}` === selected) : null;
    const fallbackChildren = (isParentMode && Array.isArray(displayChildPositions) && displayChildPositions.length > 0)
        ? displayChildPositions
            .map((pos, index) => {
                const child = pairedChildren.find((c) => c.user_id === pos.user_id) || {};
                return {
                    ...pos,
                    key: child.id || pos.user_id || `child-${index}`,
                    name: child.name || pos.name || "아이",
                    color: child.color_hex || pos.color || CHILD_MARKER_COLORS[index % CHILD_MARKER_COLORS.length],
                    photo_url: child.photo_url || pos.photo_url || null,
                };
            })
        : (childPos ? [{ ...childPos, name: "내 위치", color: DESIGN.colors.pink, photo_url: pairedChildren?.[0]?.photo_url || null }] : []);
    const focusLocation = (key, location) => {
        setSelected(key);
        if (mapObj.current && location?.lat && location?.lng) {
            mapObj.current.setCenter(new window.kakao.maps.LatLng(location.lat, location.lng));
            mapObj.current.setLevel(3);
            initialBoundsAppliedRef.current = true;
        }
    };

    return (
        <div style={{ width: "100%", maxWidth: 420, marginBottom: 0 }}>
            {/* Map */}
            <div style={{ width: "100%", height: 300, borderRadius: 24, overflow: "hidden", boxShadow: "var(--hyeni-theme-shadow-soft)", marginBottom: 14, position: "relative", background: DESIGN.gradients.map, border: "2px solid var(--theme-accent-line)" }}>
                {!mapReady && (
                    <FallbackMapCanvas
                        center={center}
                        children={fallbackChildren}
                        eventPlaces={eventPlaceItems.map(place => ({ ...place, key: `event:${place.key}` }))}
                        savedPlaces={savedPlaceItems.map(place => ({ ...place, key: `saved:${place.id}` }))}
                        selectedKey={selected || ""}
                        onSelect={(marker) => setSelected(marker.key)}
                        title="아이 위치 · 안전"
                        subtitle={fallbackMapSubtitle}
                        showRadius={Boolean(childPos)}
                    />
                )}
                <div ref={mapRef} style={{ width: "100%", height: "100%", display: mapReady ? "block" : "none" }} />
                {mapReady && <MapZoomControls mapObj={mapObj} onManualZoom={() => { initialBoundsAppliedRef.current = true; }} />}
                {childPos && (
                    <div style={{ position: "absolute", top: 12, left: 12, background: "white", borderRadius: 999, padding: "8px 14px", fontSize: 11, fontWeight: 700, color: DESIGN.colors.ink, boxShadow: "0 6px 20px rgba(180,120,150,0.15)", fontFamily: FF, display: mapReady ? "flex" : "none", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-positive)", boxShadow: "0 0 0 3px rgba(16,185,129,0.25)" }} /> 실시간
                    </div>
                )}
                {mapReady && childPos && (
                    <button
                        type="button"
                        aria-label="현재 위치로 이동"
                        title="현재 위치로 이동"
                        onClick={() => focusLocation("child:current", childPos)}
                        style={{ position: "absolute", top: 52, left: 12, width: 42, height: 42, borderRadius: 14, border: "none", background: "white", color: "var(--theme-accent)", fontSize: 20, fontWeight: 760, cursor: "pointer", boxShadow: "0 6px 18px rgba(31,24,28,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FF }}
                    >
                        🎯
                    </button>
                )}
                <div style={{ position: "absolute", top: 12, right: 12, background: "white", borderRadius: 999, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: DESIGN.colors.inkSoft, boxShadow: "0 6px 20px rgba(180,120,150,0.15)", fontFamily: FF, display: mapReady ? "block" : "none" }}>
                    📍 {eventPlaceItems.length + savedPlaceItems.length}개 장소
                </div>
                {isParentMode && (
                    <button
                        type="button"
                        aria-label="📍 장소 추가"
                        onClick={onAddSavedPlace}
                        style={{
                            position: "absolute",
                            right: 14,
                            bottom: 14,
                            width: 52,
                            height: 52,
                            borderRadius: 18,
                            border: "none",
                            background: "var(--hyeni-theme-gradient)",
                            color: "white",
                            fontSize: 28,
                            fontWeight: 760,
                            cursor: "pointer",
                            boxShadow: "var(--hyeni-theme-shadow-soft)",
                            fontFamily: FF,
                        }}
                    >
                        +
                    </button>
                )}
            </div>

            {/* Selected card */}
            {selectedEventPlace && (
                <div style={{ background: selectedEventPlace.nextEvent?.bg || "var(--theme-accent-soft)", borderRadius: 20, padding: 16, marginBottom: 12, borderLeft: `4px solid ${selectedEventPlace.nextEvent?.color || "var(--theme-accent)"}`, boxShadow: "var(--hyeni-theme-shadow-soft)" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div style={{ fontSize: 28 }}>{selectedEventPlace.nextEvent?.emoji || "📍"}</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--fg-primary)", fontFamily: FF }}>{selectedEventPlace.title}</div>
                            <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 2, fontFamily: FF }}>
                                일정 {selectedEventPlace.eventCount}개
                                {selectedEventPlace.nextEvent ? ` · 다음 ${selectedEventPlace.nextEvent.time}` : ""}
                            </div>
                            <div style={{ fontSize: 12, color: selectedEventPlace.nextEvent?.color || "var(--theme-accent-text)", marginTop: 3, fontWeight: 600, fontFamily: FF }}>📍 {selectedEventPlace.location.address}</div>
                            {selectedEventPlace.events.slice(0, 2).map((event) => (
                                <div key={event.id} style={{ fontSize: 11, color: "var(--fg-secondary)", marginTop: 4, fontFamily: FF }}>
                                    • {event.time}{event.endTime ? ` ~ ${event.endTime}` : ""} {event.title}
                                </div>
                            ))}
                            {selectedEventPlace.eventCount > 2 && (
                                <div style={{ fontSize: 11, color: "var(--fg-tertiary)", marginTop: 4, fontFamily: FF }}>
                                    외 {selectedEventPlace.eventCount - 2}개 일정
                                </div>
                            )}
                        </div>
                        {selectedEventPlace.arrivedCount > 0
                            ? <span style={{ fontSize: 12, padding: "6px 12px", borderRadius: 12, background: "var(--status-positive-subtle)", color: "var(--status-safe-text)", fontWeight: 700, fontFamily: FF }}>✅ {selectedEventPlace.arrivedCount}개 도착</span>
                            : <span style={{ fontSize: 12, padding: "6px 12px", borderRadius: 12, background: "var(--status-cautionary-subtle)", color: "var(--status-cautionary-strong)", fontWeight: 700, fontFamily: FF }}>대기</span>}
                    </div>
                </div>
            )}
            {selectedPlace && (
                <div style={{ background: "var(--theme-accent-soft)", borderRadius: 20, padding: 16, marginBottom: 12, borderLeft: "4px solid var(--theme-accent)", boxShadow: "var(--hyeni-theme-shadow-soft)" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div style={{ fontSize: 28 }}>📍</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--fg-primary)", fontFamily: FF }}>{selectedPlace.name}</div>
                            <div style={{ fontSize: 12, color: "var(--theme-accent-text)", marginTop: 3, fontWeight: 600, fontFamily: FF }}>{selectedPlace.location.address}</div>
                            {childPos && <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 4, fontFamily: FF }}>현재 위치에서 {distLabel(haversineM(childPos.lat, childPos.lng, selectedPlace.location.lat, selectedPlace.location.lng))}</div>}
                        </div>
                        <span style={{ fontSize: 12, padding: "6px 12px", borderRadius: 12, background: "var(--theme-accent-soft)", color: "var(--theme-accent-text)", border: "1px solid var(--theme-accent-line)", fontWeight: 700, fontFamily: FF }}>저장됨</span>
                    </div>
                </div>
            )}

            {/* Card list */}
            <div style={{ background: "white", borderRadius: 24, boxShadow: "var(--hyeni-theme-shadow-soft)", padding: 16, border: "1px solid var(--theme-accent-line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-primary)", fontFamily: FF }}>📍 등록된 장소</div>
                    {isParentMode && (
                        <button
                            type="button"
                            aria-label="📍 자주 가는 장소 추가"
                            onClick={onAddSavedPlace}
                            style={{ border: "none", borderRadius: 14, padding: "8px 12px", background: "var(--hyeni-theme-gradient)", color: "white", fontWeight: 700, cursor: "pointer", fontFamily: FF, fontSize: 12, boxShadow: "var(--hyeni-theme-shadow-soft)" }}
                        >
                            + 자주 가는 장소
                        </button>
                    )}
                </div>
                {isParentMode && savedPlacesLocked && (
                    <div style={{ background: "var(--status-cautionary-subtle)", color: "var(--status-cautionary-strong)", borderRadius: 14, padding: "10px 12px", fontSize: 12, fontWeight: 700, marginBottom: 12, fontFamily: FF }}>
                        프리미엄에서는 자주 가는 장소를 무제한 등록할 수 있어요
                    </div>
                )}
                {locationHint && (
                    <div
                        role="status"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            background: "var(--status-cautionary-subtle)",
                            color: "var(--status-cautionary-strong)",
                            borderRadius: 14,
                            padding: "10px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            marginBottom: 12,
                            lineHeight: 1.5,
                        }}
                    >
                        <span aria-hidden="true" style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 18,
                            height: 18,
                            borderRadius: 999,
                            background: "var(--status-caution)",
                            color: "#fff",
                            fontWeight: 760,
                            fontSize: 11,
                            flexShrink: 0,
                        }}>!</span>
                        <span>{locationHint}</span>
                    </div>
                )}
                {savedPlaceItems.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--theme-accent-text)", marginBottom: 8, fontFamily: FF }}>자주 가는 장소</div>
                        {savedPlaceItems.map((place) => (
                            <div
                                key={place.id}
                                onClick={() => focusLocation(`saved:${place.id}`, place.location)}
                                style={{
                                    display: "flex", gap: 10, alignItems: "center", padding: "12px", borderRadius: 16, marginBottom: 8, cursor: "pointer", fontFamily: FF,
                                    background: selected === `saved:${place.id}` ? "var(--theme-accent-soft)" : "var(--hyeni-surface-warm)", borderLeft: "3px solid var(--theme-accent)",
                                    transition: "all 0.15s",
                                }}
                            >
                                <div style={{ fontSize: 22 }}>📍</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--fg-primary)" }}>{place.name}</div>
                                    <div style={{ fontSize: 11, color: "var(--fg-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {place.location.address}</div>
                                </div>
                                {childPos && <div style={{ fontSize: 11, color: "var(--theme-accent-text)", fontWeight: 700, flexShrink: 0 }}>{distLabel(haversineM(childPos.lat, childPos.lng, place.location.lat, place.location.lng))}</div>}
                            </div>
                        ))}
                    </div>
                )}
                {eventPlaceItems.length > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-secondary)", marginBottom: 8, fontFamily: FF }}>일정 장소</div>
                )}
                {eventPlaceItems.length === 0 && savedPlaceItems.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "var(--fg-tertiary)", fontFamily: FF }}>
                        <div style={{ fontSize: 36, marginBottom: 8 }}>🗺️</div>
                        <div style={{ fontSize: 14 }}>등록된 장소가 없어요</div>
                    </div>
                ) : eventPlaceItems.map((place) => (
                    <div key={place.key}
                        onClick={() => {
                            focusLocation(`event:${place.key}`, place.location);
                        }}
                        style={{
                            display: "flex", gap: 10, alignItems: "center", padding: "12px", borderRadius: 16, marginBottom: 8, cursor: "pointer", fontFamily: FF,
                            background: selected === `event:${place.key}` ? (place.nextEvent?.bg || "var(--theme-accent-soft)") : "var(--bg-subtle)", borderLeft: `3px solid ${place.nextEvent?.color || "var(--theme-accent)"}`,
                            transition: "all 0.15s"
                        }}>
                        <div style={{ fontSize: 22 }}>{place.nextEvent?.emoji || "📍"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--fg-primary)" }}>{place.title}</div>
                            <div style={{ fontSize: 11, color: "var(--fg-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {place.location.address}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--fg-secondary)", fontWeight: 600, flexShrink: 0 }}>
                            {place.eventCount}개 일정
                            {place.nextEvent ? ` · ${place.nextEvent.time}` : ""}
                        </div>
                        {place.arrivedCount > 0 ? <span style={{ fontSize: 10, color: "var(--status-safe-text)", fontWeight: 700 }}>✅</span> : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
