// src/components/dangerZone/DangerZoneManager.jsx
// 위험지역 관리 sheet — 카카오 지도 클릭으로 위치 + 반경 선택, 구역 추가/삭제.
// Extracted from App.jsx (Phase 5 #4 / B14).

import { useEffect, useRef, useState } from "react";
import { FF, modalBackdropStyle, makeSheetStyle } from "../../lib/styleHelpers.js";
import { SheetGrabber } from "../common/SheetGrabber.jsx";
import { SheetTitleBar } from "../common/SheetTitleBar.jsx";
import { useReverseGeocodedLabel } from "../../lib/reverseGeocode.js";
import { ThreeDIcon } from "../icons/ThreeDIcon.jsx";
import { HyeniMascot } from "../auth/HyeniMascot.jsx";
import { appConfirm } from "../../lib/appConfirm.js";

export function DangerZoneManager({ zones, familyId: _familyId, mapReady, onAdd, onDelete, onClose }) {
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState("");
    const [newRadius, setNewRadius] = useState(200);
    const [newType, setNewType] = useState("custom");
    const [selectedLoc, setSelectedLoc] = useState(null);
    const mapRef = useRef();
    const mapInst = useRef();
    const circleRef = useRef(null);
    const newRadiusRef = useRef(newRadius);

    const ZONE_TYPES = [
        { id: "construction", label: "🚧 공사장", color: "var(--status-cautionary)" },
        { id: "entertainment", label: "🎰 유흥가", color: "var(--status-negative)" },
        { id: "water", label: "🌊 수변지역", color: "#3B82F6" },
        { id: "custom", label: "📍 직접 설정", color: "var(--fg-secondary)" },
    ];

    const zoneColor = (type) => ZONE_TYPES.find(z => z.id === type)?.color || "var(--fg-secondary)";

    useEffect(() => {
        newRadiusRef.current = newRadius;
    }, [newRadius]);

    // Map for adding new zone
    useEffect(() => {
        if (!showAdd || !mapReady || !mapRef.current || mapInst.current) return;
        const center = new window.kakao.maps.LatLng(37.5665, 126.9780);
        const map = new window.kakao.maps.Map(mapRef.current, { center, level: 5 });
        mapInst.current = map;

        window.kakao.maps.event.addListener(map, "click", (e) => {
            const lat = e.latLng.getLat();
            const lng = e.latLng.getLng();
            setSelectedLoc({ lat, lng });
            if (circleRef.current) circleRef.current.setMap(null);
            circleRef.current = new window.kakao.maps.Circle({
                map, center: e.latLng, radius: newRadiusRef.current,
                strokeWeight: 3, strokeColor: "var(--status-negative)", strokeOpacity: 0.8,
                fillColor: "var(--status-negative)", fillOpacity: 0.15
            });
        });
    }, [showAdd, mapReady]);

    // Update circle radius
    useEffect(() => {
        if (circleRef.current && selectedLoc) {
            circleRef.current.setRadius(newRadius);
        }
    }, [newRadius, selectedLoc]);

    const handleAdd = async () => {
        if (!newName.trim() || !selectedLoc) return;
        try {
            await onAdd({ name: newName.trim(), lat: selectedLoc.lat, lng: selectedLoc.lng, radius_m: newRadius, zone_type: newType });
            setShowAdd(false);
            setNewName("");
            setSelectedLoc(null);
            if (circleRef.current) { circleRef.current.setMap(null); circleRef.current = null; }
            mapInst.current = null;
        } catch (err) { console.error("[DangerZone] add error:", err); }
    };

    return (
        <div style={{ position: "fixed", inset: 0, ...modalBackdropStyle, display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 300, fontFamily: FF }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div data-sheet-drag-root="true" style={makeSheetStyle({ padding: "0 20px calc(env(safe-area-inset-bottom, 0px) + 24px)", width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto" })}>
                <SheetGrabber onClose={onClose} label="조심할 곳 관리 시트 아래로 접기" />
                <SheetTitleBar title="조심할 곳 관리" subtitle="접근하면 부모에게 알려요" iconName="place-caution" onBack={onClose} />

                <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 16 }}>아이가 설정한 지역에 접근하면 알림을 받습니다.</div>

                {/* Zone list */}
                {zones.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "var(--fg-tertiary)" }}>
                        <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}>
                            <HyeniMascot variant="cheer" size={72} aria-label="" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>설정된 조심할 곳이 없어요</div>
                        <div style={{ fontSize: 12, marginTop: 4, fontWeight: 500 }}>안전한 동네예요</div>
                    </div>
                ) : zones.map(z => (
                    <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--status-negative-subtle)", borderRadius: "var(--radius-md)", marginBottom: 8, border: "1.5px solid var(--status-negative-subtle)" }}>
                        <div style={{ width: 40, height: 40, borderRadius: "var(--radius-input)", background: zoneColor(z.zone_type), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "white", fontWeight: 700, flexShrink: 0 }}>
                            {z.zone_type === "construction" ? "🚧" : z.zone_type === "entertainment" ? "🎰" : z.zone_type === "water" ? "🌊" : "⚠️"}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--fg-primary)" }}>{z.name}</div>
                            <div style={{ fontSize: 11, color: "var(--fg-secondary)", marginTop: 2 }}>반경 {z.radius_m}m</div>
                        </div>
                        <button onClick={async () => {
                                const ok = await appConfirm({
                                    title: "조심할 곳 삭제",
                                    message: `"${z.name}" 조심할 곳을 삭제할까요?`,
                                    confirmLabel: "삭제",
                                    tone: "danger",
                                });
                                if (ok) onDelete(z.id);
                            }}
                            style={{ minHeight: 44, minWidth: 52, padding: "8px 14px", borderRadius: 12, background: "var(--status-negative-subtle)", color: "var(--status-negative)", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FF }}>삭제</button>
                    </div>
                ))}

                {/* Add new zone */}
                {!showAdd ? (
                    <button onClick={() => setShowAdd(true)}
                        style={{ width: "100%", marginTop: 12, padding: "14px", borderRadius: "var(--radius-md)", border: "2px dashed var(--line-default)", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "var(--fg-secondary)", fontFamily: FF }}>
                        + 조심할 곳 추가
                    </button>
                ) : (
                    <div style={{ marginTop: 12, background: "var(--bg-subtle)", borderRadius: "var(--radius-lg)", padding: 16, border: "1.5px solid var(--line-soft)" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-primary)", marginBottom: 12 }}>새 조심할 곳 추가</div>

                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="지역 이름 (예: 공사장 앞)"
                            style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-input)", border: "2px solid var(--line-soft)", fontSize: 14, fontWeight: 700, fontFamily: FF, boxSizing: "border-box", marginBottom: 10 }} />

                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                            {ZONE_TYPES.map(zt => (
                                <button key={zt.id} onClick={() => setNewType(zt.id)}
                                    style={{ minHeight: 44, padding: "10px 14px", borderRadius: 12, border: newType === zt.id ? `2px solid ${zt.color}` : "1.5px solid var(--line-soft)", background: newType === zt.id ? zt.color + "15" : "white", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FF, color: newType === zt.id ? zt.color : "var(--fg-secondary)" }}>
                                    {zt.label}
                                </button>
                            ))}
                        </div>

                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-secondary)", marginBottom: 6 }}>반경: {newRadius}m</div>
                        <input type="range" min={50} max={500} step={50} value={newRadius} onChange={e => setNewRadius(Number(e.target.value))}
                            style={{ width: "100%", height: 32, marginBottom: 12 }} />

                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-secondary)", marginBottom: 6 }}>지도를 클릭해서 위치를 선택하세요</div>
                        <div data-no-sheet-drag="true" ref={mapRef} style={{ width: "100%", height: 200, borderRadius: "var(--radius-md)", overflow: "hidden", border: "2px solid var(--line-soft)", marginBottom: 12 }} />

                        {selectedLoc && <SelectedLocLabel lat={selectedLoc.lat} lng={selectedLoc.lng} />}

                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={handleAdd} disabled={!newName.trim() || !selectedLoc}
                                style={{ flex: 1, minHeight: 48, padding: "12px", borderRadius: "var(--radius-input)", border: "none", background: !newName.trim() || !selectedLoc ? "var(--bg-muted)" : "var(--status-negative)", color: "var(--fg-on-accent)", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FF }}>
                                ⚠️ 조심할 곳 등록
                            </button>
                            <button onClick={() => { setShowAdd(false); mapInst.current = null; }}
                                style={{ minHeight: 48, padding: "12px 16px", borderRadius: "var(--radius-input)", border: "1px solid var(--line-soft)", background: "var(--bg-base)", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FF, color: "var(--fg-secondary)" }}>취소</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function SelectedLocLabel({ lat, lng }) {
    const label = useReverseGeocodedLabel(lat, lng, "");
    const display = label || `좌표 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    return <div style={{ fontSize: 11, color: "var(--status-safe-text)", fontWeight: 700, marginBottom: 8 }}>✓ 위치 선택됨 — {display}</div>;
}
