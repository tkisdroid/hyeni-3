import { useIntl } from "react-intl";
/**
 * 지도 장소 피커 시트 — 일정 등록/수정에서 장소를 지도로 지정(TK 요구).
 * 현재 위치(geolocation) 기준으로 지도를 열고, 지도를 탭해 좌표 선택 + 역지오코딩으로
 * 주소 자동 채움. 저장된 장소(장소관리)는 지도 마커 + 하단 칩으로 바로 선택 가능.
 * 현재 위치 실패 시 폴백: 집(is_home) > 첫 저장장소 > 서울 시청.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Home, MapPin, X } from "lucide-react";
import { FamilyMap, type MapPlace } from "@/maps/FamilyMap";
import { reverseRawMapLabel } from "@/lib/mapActions";
import { useAuth } from "@/auth/AuthContext";
import type { SavedPlace } from "@/lib/api/endpoints/location";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import "./MapPickerSheet.css";

export interface PickedPlace {
  lat: number;
  lng: number;
  /** 역지오코딩 주소(없으면 좌표만). */
  address: string;
  /** 저장장소를 고른 경우 그 이름(표시 라벨 우선). */
  name?: string;
}

const SEOUL = { lat: 37.5665, lng: 126.978 };

export function MapPickerSheet({
  savedPlaces,
  initial,
  onConfirm,
  onClose,
}: {
  savedPlaces: SavedPlace[];
  /** 수정 모드 등 기존 좌표(있으면 그 위치에서 시작). */
  initial?: { lat: number; lng: number } | null;
  onConfirm: (sel: PickedPlace) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const { familyId } = useAuth();
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [address, setAddress] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: true,
    onClose,
    initialFocusRef: closeRef,
  });

  // 초기 중심: 기존 좌표 > 현재 위치(4초 제한) > 집 > 첫 저장장소 > 서울.
  useEffect(() => {
    if (center) return;
    const fallback = () => {
      const home = savedPlaces.find((p) => p.is_home && p.location) ?? savedPlaces[0] ?? null;
      setCenter(home?.location ? { lat: home.location.lat, lng: home.location.lng } : SEOUL);
    };
    if (!navigator.geolocation) {
      fallback();
      return;
    }
    let done = false;
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true;
        fallback();
      }
    }, 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        fallback();
      },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 120_000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 지도 탭 → 좌표 선택 + 역지오코딩 주소(수동 선택은 저장장소 이름 해제).
  const handlePick = (lat: number, lng: number) => {
    setPicked({ lat, lng });
    setPickedName(null);
    setAddress("");
    if (familyId) void reverseRawMapLabel(familyId, { lat, lng }, intl.locale, "picker_pin").then(setAddress).catch(() => undefined);
  };

  // 저장장소 칩 선택 → 그 좌표·이름으로 지정 + 지도 중심 이동.
  const pickSaved = (p: SavedPlace) => {
    if (!p.location) return;
    setPicked({ lat: p.location.lat, lng: p.location.lng });
    setCenter({ lat: p.location.lat, lng: p.location.lng });
    setPickedName(p.name);
    setAddress(p.location.address ?? "");
  };

  const mapPlaces = useMemo<MapPlace[]>(
    () =>
      savedPlaces
        .filter((p) => typeof p.location?.lat === "number" && typeof p.location?.lng === "number")
        .map((p) => ({ lat: p.location.lat, lng: p.location.lng, name: p.name, isHome: p.is_home })),
    [savedPlaces],
  );

  const confirm = () => {
    if (!picked) return;
    onConfirm({
      lat: picked.lat,
      lng: picked.lng,
      address,
      name: pickedName ?? undefined,
    });
  };

  const selectionLabel = pickedName || address || (picked ? intl.formatMessage({ id: "parent.eventForm.copy066" }) : "");

  return (
    <div
      ref={dialogRef}
      className="mps-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <button
        type="button"
        className="mps-scrim"
        tabIndex={-1}
        aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })}
        onClick={onClose}
      />
      <div className="mps-sheet">
        <div className="mps-head">
          <span id={titleId} className="mps-title">{intl.formatMessage({ id: "parent.eventForm.copy039" })}</span>
          <button ref={closeRef} type="button" className="mps-close hy-press" aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })} onClick={onClose}>
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>

        <div className="mps-map">
          <FamilyMap className="mps-map__canvas" center={center} picked={picked} onPick={handlePick} places={mapPlaces} />
          {!picked && <span className="mps-map__hint">{intl.formatMessage({ id: "parent.mapPickerSheet.copy001" })}</span>}
        </div>

        {savedPlaces.length > 0 && (
          <div className="mps-saved">
            {savedPlaces.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`mps-saved__chip hy-press${pickedName === p.name ? " mps-saved__chip--on" : ""}`}
                aria-pressed={pickedName === p.name}
                onClick={() => pickSaved(p)}
              >
                {p.is_home ? <Home size={16} strokeWidth={2.4} /> : <MapPin size={16} strokeWidth={2.4} />}
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="mps-foot">
          <span className="mps-sel">
            <MapPin size={16} strokeWidth={2.2} />
            <span id={descriptionId} className="mps-sel__text">{selectionLabel || intl.formatMessage({ id: "parent.mapPickerSheet.copy002" })}</span>
          </span>
          <button type="button" className="mps-confirm hy-press" onClick={confirm} disabled={!picked}>
            {intl.formatMessage({ id: "parent.mapPickerSheet.copy003" })}
          </button>
        </div>
      </div>
    </div>
  );
}
