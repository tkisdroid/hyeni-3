/**
 * Kakao 지도 컴포넌트. 자녀 마커(아바타 오버레이) + 위험구역(원) + 저장장소(마커).
 * SDK 로드 실패(키 미인증 등) 시 스타일 폴백으로 대체.
 */
import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { asset } from "@/lib/assets";
import {
  splitLocationRouteSegments,
  type LocationRoutePoint,
} from "@/transform/locationRoute";

export interface MapChild {
  lat: number;
  lng: number;
  name: string;
  avatar: string; // asset 경로 또는 URL
  tone?: "normal" | "danger";
}
export interface MapZone {
  lat: number;
  lng: number;
  radiusM: number;
  name: string;
}
export interface MapPlace {
  lat: number;
  lng: number;
  name: string;
  isHome?: boolean;
}

function src(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface MapStay {
  lat: number;
  lng: number;
  /** 방문 순번(1부터). 마커에 표시. */
  order: number;
  /** 체류 시간 라벨(예: "1시간 20분"). */
  dwellLabel: string;
  /** 장소명(있으면). */
  placeName?: string | null;
  /** 강조(목록에서 선택) 여부. */
  active?: boolean;
}

export function KakaoMap({
  child,
  zones = [],
  places = [],
  route,
  stays = [],
  destination = null,
  picked = null,
  onPick,
  center = null,
  recenterKey = 0,
  className,
}: {
  child?: MapChild | null;
  zones?: MapZone[];
  places?: MapPlace[];
  /** 도보 경로 폴리라인 좌표(출발→도착). 2점 이상이면 그린다. */
  route?: LocationRoutePoint[];
  /** 스테이포인트(머무른 장소) 마커 + 순번·체류시간 라벨 + 연결 폴리라인. */
  stays?: MapStay[];
  /** 도착지 마커(경로 끝점). */
  destination?: MapPlace | null;
  /** 선택된 위치(picker 모드) — 있으면 해당 좌표에 마커. */
  picked?: LatLngPoint | null;
  /** 지도 클릭 시 좌표 콜백(picker 모드). */
  onPick?: (lat: number, lng: number) => void;
  /** 명시적 중심(주소 검색 결과 등). 없으면 자녀 위치/기본값. */
  center?: LatLngPoint | null;
  /** 값이 바뀌면 center 가 같은 좌표여도 강제로 재이동(현재 위치 버튼 등). */
  recenterKey?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resizeObsRef = useRef<any>(null);
  // 최신 onPick 콜백을 ref 로 유지(리스너 재부착 없이 최신 클로저 호출).
  const onPickRef = useRef(onPick);
  // 마지막으로 적용한 중심(중복 setCenter 방지 → 클릭 시 지도 튐 방지).
  const lastCenterRef = useRef<string | null>(null);
  // 마지막으로 적용한 recenterKey — 바뀌면 같은 좌표라도 강제 재이동.
  const lastRecenterRef = useRef(0);
  const [failed, setFailed] = useState(false);
  // 지도가 그려지기 전엔 흰 사각형 대신 부드러운 자리표시자를 보여준다(체감 지연 감소).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((maps: any) => {
        if (cancelled || !ref.current) return;
        // 중심 우선순위: 명시적 center > 자녀 위치 > 서울 기본값.
        const desired = center ?? (child ? { lat: child.lat, lng: child.lng } : { lat: 37.5665, lng: 126.978 });
        const centerKey = `${desired.lat},${desired.lng}`;
        const centerLatLng = new maps.LatLng(desired.lat, desired.lng);
        if (!mapRef.current) {
          mapRef.current = new maps.Map(ref.current, { center: centerLatLng, level: 4 });
          lastCenterRef.current = centerKey;
          setReady(true);
          // 컨테이너 크기 변화(드래그 리사이즈 등) → relayout + 중심 유지.
          // Kakao 지도는 컨테이너가 커져도 스스로 타일을 다시 깔지 않는다(회색 여백 버그 방지).
          if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => {
              const map = mapRef.current;
              if (!map) return;
              const keep = map.getCenter();
              map.relayout();
              map.setCenter(keep);
            });
            ro.observe(ref.current);
            resizeObsRef.current = ro;
          }
          // 지도 클릭 → 좌표 선택. 리스너는 최초 1회만 부착하고 최신 콜백은 ref 로 호출.
          maps.event.addListener(
            mapRef.current,
            "click",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mouseEvent: any) => {
              const latlng = mouseEvent.latLng;
              onPickRef.current?.(latlng.getLat(), latlng.getLng());
            },
          );
        } else if (centerKey !== lastCenterRef.current || recenterKey !== lastRecenterRef.current) {
          // 중심이 실제로 바뀔 때만 이동(클릭으로 picked 만 갱신될 땐 지도 튐 방지).
          // 단 recenterKey 가 갱신되면 같은 좌표여도 강제 재이동(현재 위치 버튼).
          mapRef.current.setCenter(centerLatLng);
          lastCenterRef.current = centerKey;
        }
        lastRecenterRef.current = recenterKey;
        // 이전 오버레이 제거
        overlaysRef.current.forEach((o) => o.setMap(null));
        overlaysRef.current = [];

        // 위험구역(원)
        for (const z of zones) {
          const circle = new maps.Circle({
            center: new maps.LatLng(z.lat, z.lng),
            radius: z.radiusM,
            strokeWeight: 2,
            strokeColor: "#E5484D",
            strokeOpacity: 0.85,
            strokeStyle: "solid",
            fillColor: "#E5484D",
            fillOpacity: 0.14,
          });
          circle.setMap(mapRef.current);
          overlaysRef.current.push(circle);
        }

        // 저장장소(마커)
        for (const p of places) {
          const marker = new maps.Marker({
            position: new maps.LatLng(p.lat, p.lng),
            map: mapRef.current,
            title: p.name,
          });
          overlaysRef.current.push(marker);
        }

        // 선택된 위치(picker 모드) 마커
        if (picked) {
          const marker = new maps.Marker({
            position: new maps.LatLng(picked.lat, picked.lng),
            map: mapRef.current,
          });
          overlaysRef.current.push(marker);
        }

        // 도착지 마커(경로 끝점)
        if (destination) {
          const marker = new maps.Marker({
            position: new maps.LatLng(destination.lat, destination.lng),
            map: mapRef.current,
            title: destination.name,
          });
          overlaysRef.current.push(marker);
        }

        // 경로 폴리라인. 실측점 사이만 실선, 보간된 추정 구간은 점선으로 정직하게 구분한다.
        if (route && route.length >= 2) {
          const rootStyle = getComputedStyle(document.documentElement);
          const actualRouteColor = rootStyle.getPropertyValue("--mint-500").trim();
          const estimatedRouteColor = rootStyle.getPropertyValue("--lav-400").trim();
          for (const segment of splitLocationRouteSegments(route)) {
            const path = segment.points.map((p) => new maps.LatLng(p.lat, p.lng));
            const polyline = new maps.Polyline({
              path,
              strokeWeight: segment.estimated ? 4 : 6,
              strokeColor: segment.estimated ? estimatedRouteColor : actualRouteColor,
              strokeOpacity: segment.estimated ? 0.72 : 0.9,
              strokeStyle: segment.estimated ? "shortdash" : "solid",
            });
            polyline.setMap(mapRef.current);
            overlaysRef.current.push(polyline);
          }
        }

        // 스테이포인트(머무른 장소) — 순서 연결선(점선) + 순번·체류시간 핀.
        if (stays && stays.length > 0) {
          if (stays.length >= 2) {
            const path = stays.map((s) => new maps.LatLng(s.lat, s.lng));
            const link = new maps.Polyline({
              path,
              strokeWeight: 3,
              strokeColor: "#A78BFA",
              strokeOpacity: 0.8,
              strokeStyle: "shortdash",
            });
            link.setMap(mapRef.current);
            overlaysRef.current.push(link);
          }
          for (const s of stays) {
            const el = document.createElement("div");
            const accent = s.active ? "#7C3AED" : "#A78BFA";
            el.style.cssText = "transform:translateY(-4px);text-align:center;white-space:nowrap;pointer-events:none";
            el.innerHTML =
              `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px 3px 5px;border-radius:999px;` +
              `background:${accent};color:#fff;box-shadow:0 4px 12px rgba(124,58,237,.4);font-size:11.5px;font-weight:800;` +
              (s.active ? "outline:2px solid #fff;" : "") +
              `">` +
              `<span style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.28);` +
              `align-items:center;justify-content:center;font-size:10px">${s.order}</span>` +
              `<span>${s.dwellLabel}</span></div>`;
            const overlay = new maps.CustomOverlay({
              position: new maps.LatLng(s.lat, s.lng),
              content: el,
              yAnchor: 1,
              zIndex: s.active ? 30 : 20,
            });
            overlay.setMap(mapRef.current);
            overlaysRef.current.push(overlay);
          }
        }

        // 자녀(아바타 커스텀 오버레이)
        if (child) {
          const content = document.createElement("div");
          const danger = child.tone === "danger";
          content.style.cssText =
            "width:48px;height:48px;border-radius:50%;overflow:hidden;transform:translateY(-6px);" +
            (danger
              ? "border:3px solid #E5484D;box-shadow:0 0 0 8px rgba(229,72,77,.18),0 6px 18px rgba(229,72,77,.55);background:#FFE5E8;"
              : "border:3px solid #fff;box-shadow:0 4px 14px rgba(240,81,143,.5);background:#FDE7F1;");
          content.innerHTML = `<img src="${src(child.avatar)}" alt="${child.name}" style="width:100%;height:100%;object-fit:cover"/>`;
          const overlay = new maps.CustomOverlay({
            position: centerLatLng,
            content,
            yAnchor: 1,
            zIndex: 10,
          });
          overlay.setMap(mapRef.current);
          overlaysRef.current.push(overlay);
        }

        // 경로가 있으면 출발·도착이 모두 보이도록 bounds 맞춤(중심/레벨 대체).
        if (route && route.length >= 2) {
          const bounds = new maps.LatLngBounds();
          route.forEach((p) => bounds.extend(new maps.LatLng(p.lat, p.lng)));
          if (destination) bounds.extend(new maps.LatLng(destination.lat, destination.lng));
          if (child) bounds.extend(new maps.LatLng(child.lat, child.lng));
          mapRef.current.setBounds(bounds);
        } else if (stays && stays.length > 0 && !center) {
          // 스테이포인트 전체가 보이도록 bounds. 단 명시적 center(목록 항목 선택)면 그 지점 우선.
          const bounds = new maps.LatLngBounds();
          stays.forEach((s) => bounds.extend(new maps.LatLng(s.lat, s.lng)));
          if (stays.length === 1) mapRef.current.setCenter(new maps.LatLng(stays[0].lat, stays[0].lng));
          else mapRef.current.setBounds(bounds);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [child, zones, places, route, stays, destination, picked, center, recenterKey]);

  // 언마운트 시 ResizeObserver 해제.
  useEffect(
    () => () => {
      resizeObsRef.current?.disconnect?.();
      resizeObsRef.current = null;
    },
    [],
  );

  if (failed) {
    return (
      <div className={className} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#EAF3FB,#F3ECFF)", color: "#8B7E84", fontSize: 13, fontWeight: 600 }}>
        지도를 불러오지 못했어요
      </div>
    );
  }
  // ⚠️ 인라인 style 로 position 을 주면 안 된다. 소비 화면의 클래스가 이미 배치를 정한다
  //    (예: .pl-map 은 position:absolute; inset:0). 인라인은 그것을 덮어써 지도가 사라진다.
  //    .km-host 는 position 이 지정되지 않은 컨테이너에만 relative 를 얹는다.
  return (
    <div className={`${className} km-host`}>
      <div ref={ref} className="km-canvas" />
      {!ready && (
        <div className="km-skeleton" aria-hidden="true">
          <span className="km-skeleton__shimmer" />
        </div>
      )}
    </div>
  );
}
