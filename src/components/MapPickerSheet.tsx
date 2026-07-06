/**
 * 지도 장소 피커 시트 — 일정 등록/수정에서 장소를 지도로 지정(TK 요구).
 * 현재 위치(geolocation) 기준으로 지도를 열고, 지도를 탭해 좌표 선택 + 역지오코딩으로
 * 주소 자동 채움. 저장된 장소(장소관리)는 지도 마커 + 하단 칩으로 바로 선택 가능.
 * 현재 위치 실패 시 폴백: 집(is_home) > 첫 저장장소 > 서울 시청.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { KakaoMap, type MapPlace } from "@/components/KakaoMap";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import type { SavedPlace } from "@/lib/api/endpoints/location";
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
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [address, setAddress] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(initial ?? null);

  // 역지오코더(coord→주소). 로드 실패해도 좌표 선택 자체는 가능(주소만 빈 값).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geocoderRef = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((maps: any) => {
        if (!cancelled && maps.services) geocoderRef.current = new maps.services.Geocoder();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    const geocoder = geocoderRef.current;
    if (!geocoder) return;
    geocoder.coord2Address(
      lng,
      lat,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[], status: string) => {
        if (status !== "OK" || !results[0]) return;
        const road = results[0].road_address?.address_name;
        const jibun = results[0].address?.address_name;
        if (road || jibun) setAddress(road || jibun);
      },
    );
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

  const selectionLabel = pickedName || address || (picked ? "지도에서 선택한 위치" : "");

  return (
    <div className="mps-root" role="dialog" aria-modal="true" aria-label="지도에서 장소 선택">
      <button
        type="button"
        className="mps-scrim"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="mps-sheet">
        <div className="mps-head">
          <span className="mps-title">지도에서 장소 지정</span>
          <button type="button" className="mps-close hy-press" aria-label="닫기" onClick={onClose}>
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>

        <div className="mps-map">
          <KakaoMap className="mps-map__canvas" center={center} picked={picked} onPick={handlePick} places={mapPlaces} />
          {!picked && <span className="mps-map__hint">지도를 눌러 위치를 선택하세요</span>}
        </div>

        {savedPlaces.length > 0 && (
          <div className="mps-saved">
            {savedPlaces.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`mps-saved__chip hy-press${pickedName === p.name ? " mps-saved__chip--on" : ""}`}
                onClick={() => pickSaved(p)}
              >
                {p.is_home ? "🏠" : "📍"} {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="mps-foot">
          <span className="mps-sel">
            <MapPin size={15} strokeWidth={2.2} />
            <span className="mps-sel__text">{selectionLabel || "위치를 선택해 주세요"}</span>
          </span>
          <button type="button" className="mps-confirm hy-press" onClick={confirm} disabled={!picked}>
            이 위치로 지정
          </button>
        </div>
      </div>
    </div>
  );
}
