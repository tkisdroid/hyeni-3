import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/app/toast";
import { KakaoMap } from "@/components/KakaoMap";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { hasKakaoKey } from "@/config/env";
import { useCreateDangerZone, useUpdateDangerZone } from "@/queries/useLocation";
import type { DangerZone } from "@/lib/api/endpoints/location";
import "./DangerZoneForm.css";

interface LatLng {
  lat: number;
  lng: number;
}

/** 반경 범위(m) — 지오펜스 판정에 쓰는 안전 반경. */
const RADIUS_MIN = 50;
const RADIUS_MAX = 1000;
const RADIUS_STEP = 50;
const RADIUS_DEFAULT = 300;

/** P-17 위험구역 추가·편집. 지도 핀으로 중심 선택 + 반경 슬라이더 + 진입/이탈 알림 토글. */
export function DangerZoneForm() {
  const navigate = useNavigate();
  const { show } = useToast();
  const routeState = (useLocation().state ?? null) as { zone?: DangerZone } | null;
  const editing = routeState?.zone ?? null;

  const createZone = useCreateDangerZone();
  const updateZone = useUpdateDangerZone();

  const [name, setName] = useState(editing?.name ?? "");
  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState(editing?.radius_m ?? RADIUS_DEFAULT);
  const [picked, setPicked] = useState<LatLng | null>(
    editing ? { lat: editing.lat, lng: editing.lng } : null,
  );
  const [center, setCenter] = useState<LatLng | null>(
    editing ? { lat: editing.lat, lng: editing.lng } : null,
  );
  // 알림 토글 — UI 상태(서버 저장은 준비 중, 아래 안내 참고).
  const [entryAlert, setEntryAlert] = useState(true);
  const [exitAlert, setExitAlert] = useState(false);

  // Kakao Geocoder(주소↔좌표) — 키 미설정이면 로드 실패해도 화면은 동작.
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

  // 지도 클릭 → 중심 좌표 선택 + 역지오코딩으로 주소 자동 채움.
  const handlePick = (lat: number, lng: number) => {
    setPicked({ lat, lng });
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

  // 주소 검색(Enter) → 좌표로 이동 + 마커.
  const searchAddress = () => {
    const geocoder = geocoderRef.current;
    const query = address.trim();
    if (!query) return;
    if (!geocoder) {
      show("주소 검색을 사용할 수 없어요", "🔍");
      return;
    }
    geocoder.addressSearch(
      query,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[], status: string) => {
        if (status === "OK" && results[0]) {
          const lat = Number(results[0].y);
          const lng = Number(results[0].x);
          setPicked({ lat, lng });
          setCenter({ lat, lng });
        } else {
          show("주소를 찾지 못했어요", "🔍");
        }
      },
    );
  };

  const saving = createZone.isPending || updateZone.isPending;

  // 저장 — 사용자 onClick 에서만. 편집이면 같은 구역을 부분수정(id·created_at 보존), 신규면 생성.
  const save = () => {
    if (saving) return;
    if (!picked) {
      show(
        hasKakaoKey ? "지도를 눌러 구역 중심을 선택해 주세요" : "지도 설정 전이라 구역을 저장할 수 없어요",
        "📍",
      );
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      show("구역 이름을 입력해 주세요", "✏️");
      return;
    }
    const payload = {
      name: trimmed,
      lat: picked.lat,
      lng: picked.lng,
      radius_m: radius,
      zone_type: editing?.zone_type ?? "custom",
    };
    const handlers = {
      onSuccess: () => {
        show(editing ? "위험구역을 수정했어요" : "위험구역을 추가했어요", "🛡️");
        navigate(-1);
      },
      onError: () => show("저장에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️"),
    };
    if (editing?.id) {
      updateZone.mutate({ id: editing.id, zone: payload }, handlers);
    } else {
      createZone.mutate(payload, handlers);
    }
  };

  return (
    <div className="dzf-screen">
      <header className="dzf-header">
        <button type="button" className="dzf-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="dzf-title">{editing ? "위험구역 편집" : "위험구역 추가"}</span>
      </header>

      <div className="dzf-body">
        {/* 지도 — 눌러서 구역 중심 선택(반경 원 미리보기) */}
        <div className="dzf-map">
          <KakaoMap
            className="dzf-map__canvas"
            center={center}
            picked={picked}
            zones={picked ? [{ lat: picked.lat, lng: picked.lng, radiusM: radius, name: name.trim() || "위험구역" }] : []}
            onPick={handlePick}
          />
          {!picked && (
            <span className="dzf-map__hint">
              {hasKakaoKey ? "지도를 눌러 구역 중심을 선택하세요" : "지도 기능 설정 전이에요"}
            </span>
          )}
        </div>

        {/* 구역 이름 */}
        <div>
          <div className="dzf-label">구역 이름</div>
          <input
            className="dzf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예) 공사장 인근"
          />
        </div>

        {/* 주소 */}
        <div>
          <div className="dzf-label">주소</div>
          <input
            className="dzf-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchAddress();
              }
            }}
            placeholder="주소 검색"
          />
        </div>

        {/* 반경 */}
        <div>
          <div className="dzf-radius-head">
            <span className="dzf-radius-label">안전 반경</span>
            <span className="dzf-radius-value">{radius}m</span>
          </div>
          <input
            className="dzf-range"
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={RADIUS_STEP}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </div>

        {/* 진입/이탈 알림 */}
        <div className="dzf-toggles">
          <div className="dzf-toggle-row">
            <span className="dzf-toggle-label">진입 시 알림</span>
            <button
              type="button"
              className="dzf-toggle"
              role="switch"
              aria-checked={entryAlert}
              data-on={entryAlert}
              onClick={() => setEntryAlert((v) => !v)}
            >
              <span className="dzf-toggle__knob" />
            </button>
          </div>
          <div className="dzf-toggle-row">
            <span className="dzf-toggle-label">이탈 시 알림</span>
            <button
              type="button"
              className="dzf-toggle"
              role="switch"
              aria-checked={exitAlert}
              data-on={exitAlert}
              onClick={() => setExitAlert((v) => !v)}
            >
              <span className="dzf-toggle__knob" />
            </button>
          </div>
          <div className="dzf-toggle-note">
            진입·이탈 알림 세부 설정 저장은 준비 중이에요. 저장한 구역은 접근 시 자동으로 알려드려요.
          </div>
        </div>

        {/* 저장 */}
        <button type="button" className="dzf-save hy-press" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : editing ? "구역 수정하기" : "구역 저장하기"}
        </button>
      </div>
    </div>
  );
}
