import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/app/toast";
import { KakaoMap } from "@/components/KakaoMap";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { hasKakaoKey } from "@/config/env";
import { useCreateSavedPlace } from "@/queries/useLocation";
import "./PlaceForm.css";

/** 장소 종류 — 선택 시 신호색으로 채워진다(집=민트/학원=라벤더/자주=파랑). 위험 구역은 저장장소 API에 카테고리가 없어 별도 화면(위험구역 추가)에서 등록한다. */
const PLACE_TYPES = [
  { id: "home", label: "집", activeBg: "#31C48D", activeColor: "#fff" },
  { id: "academy", label: "학원", activeBg: "#A78BFA", activeColor: "#fff" },
  { id: "frequent", label: "자주", activeBg: "#4FB2E8", activeColor: "#fff" },
] as const;

type PlaceTypeId = (typeof PLACE_TYPES)[number]["id"];

interface LatLng {
  lat: number;
  lng: number;
}

const IDLE_BG = "#F3EEF1";
const IDLE_COLOR = "#8B7E84";

export function PlaceForm() {
  const navigate = useNavigate();
  const { show } = useToast();
  const createPlace = useCreateSavedPlace();

  const [placeName, setPlaceName] = useState("");
  const [address, setAddress] = useState("");
  const [placeType, setPlaceType] = useState<PlaceTypeId>("academy");
  const [picked, setPicked] = useState<LatLng | null>(null);
  const [center, setCenter] = useState<LatLng | null>(null);

  // Kakao services(Geocoder) — 주소↔좌표 변환용. 키 미설정으로 로드 실패해도 화면은 동작.
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

  // 지도 클릭 → 좌표 선택 + 역지오코딩으로 주소 자동 채움(모두 사용자 조작 기반).
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

  // 주소 검색(Enter) → 좌표 변환해 지도 이동 + 마커 표시. 읽기 동작이라 사용자 조작 시 실행.
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

  // 저장 — 사용자 onClick 에서만 실행. 이름·선택 위치 검증 후 useCreateSavedPlace 호출.
  const savePlace = () => {
    if (!picked) {
      // 지도 미설정(키 없음)이면 위치를 고를 수 없으니 정직하게 안내.
      show(
        hasKakaoKey ? "지도를 눌러 위치를 선택해 주세요" : "지도 설정 전이라 위치를 저장할 수 없어요",
        "📍",
      );
      return;
    }
    const name = placeName.trim();
    if (!name) {
      show("장소 이름을 입력해 주세요", "✏️");
      return;
    }
    createPlace.mutate(
      {
        name,
        location: {
          lat: picked.lat,
          lng: picked.lng,
          address: address.trim() || undefined,
        },
        is_home: placeType === "home",
      },
      {
        onSuccess: () => {
          show(`‘${name}’ 장소를 저장했어요`, "📍");
          navigate(-1);
        },
        onError: () => show("장소 저장에 실패했어요", "⚠️"),
      },
    );
  };

  return (
    <div className="pf-screen">
      <header className="pf-header">
        <button
          type="button"
          className="pf-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="pf-title">장소 등록</span>
      </header>

      <div className="pf-body">
        {/* 지도 — 눌러서 위치 선택(선택 좌표에 마커) */}
        <div className="pf-map">
          <KakaoMap
            className="pf-map__canvas"
            center={center}
            picked={picked}
            onPick={handlePick}
          />
          {!picked && (
            <span className="pf-map__hint">
              {hasKakaoKey ? "지도를 눌러 위치를 선택하세요" : "지도 기능 설정 전이에요"}
            </span>
          )}
        </div>

        {/* 장소 이름 */}
        <div>
          <div className="pf-label">장소 이름</div>
          <input
            className="pf-input"
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            placeholder="예) 피아노 학원"
          />
        </div>

        {/* 주소 */}
        <div>
          <div className="pf-label">주소</div>
          <input
            className="pf-input"
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

        {/* 종류 */}
        <div>
          <div className="pf-label pf-label--types">종류</div>
          <div className="pf-types">
            {PLACE_TYPES.map((t) => {
              const active = placeType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="pf-type hy-press"
                  style={{
                    background: active ? t.activeBg : IDLE_BG,
                    color: active ? t.activeColor : IDLE_COLOR,
                  }}
                  onClick={() => setPlaceType(t.id)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* 위험 구역은 저장장소가 아니라 지오펜스라 별도 경로에서 등록(오인 방지). */}
          <div className="pf-label" style={{ marginTop: 10, marginBottom: 0 }}>
            위험 구역은 지도의 위험구역 추가에서 등록해요.
          </div>
        </div>

        {/* 안전 반경 — 저장장소 API(radius_m 미지원)라 슬라이더 비노출. 위험구역 반경은 별도 화면에서 설정. */}

        {/* 저장 */}
        <button
          type="button"
          className="pf-save hy-press"
          onClick={savePlace}
          disabled={createPlace.isPending}
        >
          {createPlace.isPending ? "저장 중…" : "저장하기"}
        </button>
      </div>
    </div>
  );
}
