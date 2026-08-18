import { useIntl } from "react-intl";
/**
 * Kakao 지도 컴포넌트. 자녀 마커(아바타 오버레이) + 위험구역(원) + 저장장소(마커).
 * SDK 로드 실패(키 미인증 등) 시 스타일 폴백으로 대체.
 */
import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { asset } from "@/lib/assets";
import { LoaderMark } from "@/components/ui/LoaderMark";
import type { LocationRoutePoint } from "@/transform/locationRoute";
import {
  getMapFocusPanOffset,
  normalizeMapViewportPadding,
  type MapViewportPadding,
} from "@/transform/mapViewportPadding";

export interface MapChild {
  lat: number;
  lng: number;
  name: string;
  avatar: string; // asset 경로 또는 http/blob URL
  /** 특정 시각 위치를 보고 있을 때 아바타 위에 표시할 시각. */
  caption?: string;
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
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
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
  centerLevel = null,
  recenterKey = 0,
  viewportPadding,
  className,
  tone = "formal",
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
  /**
   * 명시적 중심으로 이동할 때 원하는 확대 단계(작을수록 확대).
   * 이미 더 확대된 화면은 건드리지 않는다(사용자 확대 존중 — 확대 방향으로만 보정).
   */
  centerLevel?: number | null;
  /** 값이 바뀌면 center 가 같은 좌표여도 강제로 재이동(현재 위치 버튼 등). */
  recenterKey?: number;
  /** 자동 bounds 맞춤 시 상단 도구막대와 패널을 피하기 위한 화면 안쪽 여백. */
  viewportPadding?: Partial<MapViewportPadding>;
  className?: string;
  tone?: "formal" | "child";
}) {
  const intl = useIntl();
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
  // 패널 크기가 바뀌면 같은 좌표라도 새 가시 영역의 중앙으로 다시 맞춘다.
  const lastFitPaddingRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // 지도가 그려지기 전엔 흰 사각형 대신 부드러운 자리표시자를 보여준다(체감 지연 감소).
  const [ready, setReady] = useState(false);
  const fitPadding = normalizeMapViewportPadding(viewportPadding);
  const fitPaddingKey = `${fitPadding.top}:${fitPadding.right}:${fitPadding.bottom}:${fitPadding.left}`;

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
        const mapExisted = Boolean(mapRef.current);
        const shouldMoveCenter =
          !mapExisted || centerKey !== lastCenterRef.current || recenterKey !== lastRecenterRef.current;
        const shouldRefocusVisibleArea =
          Boolean(center) && (shouldMoveCenter || fitPaddingKey !== lastFitPaddingRef.current);
        if (!mapRef.current) {
          mapRef.current = new maps.Map(ref.current, { center: centerLatLng, level: 4 });
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
        } else if (shouldMoveCenter) {
          // 중심이 실제로 바뀔 때만 이동(클릭으로 picked 만 갱신될 땐 지도 튐 방지).
          // 단 recenterKey 가 갱신되면 같은 좌표여도 강제 재이동(현재 위치 버튼).
          mapRef.current.setCenter(centerLatLng);
        }
        if (shouldRefocusVisibleArea) {
          // panBy 는 현재 중심으로부터 누적되므로 언제나 실제 좌표로 먼저 되돌린 뒤 한 번만 보정한다.
          mapRef.current.setCenter(centerLatLng);
          // 포커스 요청은 "더 넓게 보고 있을 때만" 확대한다(사용자가 직접 확대한 화면은 유지).
          if (centerLevel != null && typeof mapRef.current.getLevel === "function") {
            if (mapRef.current.getLevel() > centerLevel) mapRef.current.setLevel(centerLevel);
          }
          const focusPan = getMapFocusPanOffset(fitPadding);
          if (typeof mapRef.current.panBy === "function" && (focusPan.x !== 0 || focusPan.y !== 0)) {
            mapRef.current.panBy(focusPan.x, focusPan.y);
          }
        }
        lastCenterRef.current = centerKey;
        lastRecenterRef.current = recenterKey;
        lastFitPaddingRef.current = fitPaddingKey;
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

        const rootStyle = getComputedStyle(document.documentElement);

        // 경로 폴리라인 — 전 구간 실선 하나로 그린다.
        // 소비 화면이 실측점만 넘기므로(직선 보간 채움점 제외) 선의 기하는 그대로이고,
        // 끊긴 점선 때문에 이동이 '기록 안 됨'처럼 보이던 오해만 없앤다.
        if (route && route.length >= 2) {
          const routeColor = rootStyle.getPropertyValue("--mint-500").trim();
          const polyline = new maps.Polyline({
            path: route.map((p) => new maps.LatLng(p.lat, p.lng)),
            strokeWeight: 6,
            strokeColor: routeColor,
            strokeOpacity: 0.9,
            strokeStyle: "solid",
          });
          polyline.setMap(mapRef.current);
          overlaysRef.current.push(polyline);
        }

        // 스테이포인트(머무른 장소) — 순번·체류시간 핀. 경로 폴리라인이 없을 때만 순서 연결선을 얹는다
        // (경로가 있으면 실제 이동선이 이미 순서를 보여줘 선이 두 겹으로 겹친다).
        if (stays && stays.length > 0) {
          if (stays.length >= 2 && !(route && route.length >= 2)) {
            const path = stays.map((s) => new maps.LatLng(s.lat, s.lng));
            const link = new maps.Polyline({
              path,
              strokeWeight: 3,
              strokeColor: rootStyle.getPropertyValue("--mint-400").trim(),
              strokeOpacity: 0.8,
              strokeStyle: "solid",
            });
            link.setMap(mapRef.current);
            overlaysRef.current.push(link);
          }
          for (const s of stays) {
            const el = document.createElement("div");
            const stayColor = rootStyle.getPropertyValue(s.active ? "--mint-600" : "--mint-400").trim();
            const stayShadow = s.active ? "rgba(8,118,83,.44)" : "rgba(49,196,141,.34)";
            el.style.cssText = "transform:translateY(-4px);text-align:center;white-space:nowrap;pointer-events:none";
            const stayChip = document.createElement("div");
            stayChip.style.cssText =
              "display:inline-flex;align-items:center;gap:4px;padding:3px 9px 3px 5px;border-radius:999px;" +
              `background:${stayColor};color:#fff;box-shadow:0 4px 12px ${stayShadow};font-size:11.5px;font-weight:800;` +
              (s.active ? "outline:2px solid #fff;" : "");
            const orderText = document.createElement("span");
            orderText.style.cssText =
              "display:inline-flex;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.28);" +
              "align-items:center;justify-content:center;font-size:10px";
            orderText.textContent = String(s.order);
            const dwellText = document.createElement("span");
            dwellText.textContent = s.dwellLabel;
            stayChip.append(orderText, dwellText);
            el.replaceChildren(stayChip);
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
          content.className = "km-child-marker";
          content.style.cssText =
            "display:grid;justify-items:center;gap:4px;transform:translateY(-6px);pointer-events:none";
          const danger = child.tone === "danger";
          if (child.caption) {
            const timeBadge = document.createElement("span");
            timeBadge.className = "km-child-marker__time";
            timeBadge.textContent = child.caption;
            timeBadge.style.cssText =
              "padding:4px 8px;border:2px solid var(--bg-card);border-radius:999px;" +
              "background:var(--mint-600);color:var(--bg-card);box-shadow:0 3px 10px rgba(8,118,83,.34);" +
              "font-size:12px;font-weight:800;line-height:1;white-space:nowrap";
            content.append(timeBadge);
          }
          const avatarFrame = document.createElement("div");
          avatarFrame.className = "km-child-marker__avatar";
          avatarFrame.style.cssText =
            "width:48px;height:48px;border-radius:50%;overflow:hidden;" +
            (danger
              ? "border:3px solid #E5484D;box-shadow:0 0 0 8px rgba(229,72,77,.18),0 6px 18px rgba(229,72,77,.55);background:#FFE5E8;"
              : "border:3px solid #fff;box-shadow:0 4px 14px rgba(240,81,143,.5);background:#FDE7F1;");
          const avatarImage = document.createElement("img");
          avatarImage.src = src(child.avatar);
          avatarImage.alt = child.name;
          avatarImage.style.cssText = "width:100%;height:100%;object-fit:cover";
          avatarFrame.replaceChildren(avatarImage);
          content.append(avatarFrame);
          const overlay = new maps.CustomOverlay({
            // 지도 중심(center)과 자녀 좌표를 분리한다. 머문 곳·특정 시각으로 지도를 옮겨도
            // 아바타는 실제 이력점에 남아야 한다.
            position: new maps.LatLng(child.lat, child.lng),
            content,
            yAnchor: 1,
            zIndex: child.caption ? 40 : 10,
          });
          overlay.setMap(mapRef.current);
          overlaysRef.current.push(overlay);
        }

        // 경로가 있으면 출발·도착이 모두 보이도록 bounds 맞춤(중심/레벨 대체).
        // 단 소비 화면이 명시적 center 를 주면(시간대 포커스·머문 곳 선택) 그 지점을 유지한다.
        if (!center && route && route.length >= 2) {
          const bounds = new maps.LatLngBounds();
          route.forEach((p) => bounds.extend(new maps.LatLng(p.lat, p.lng)));
          if (destination) bounds.extend(new maps.LatLng(destination.lat, destination.lng));
          if (child) bounds.extend(new maps.LatLng(child.lat, child.lng));
          mapRef.current.setBounds(
            bounds,
            fitPadding.top,
            fitPadding.right,
            fitPadding.bottom,
            fitPadding.left,
          );
        } else if (!center && stays && stays.length > 0) {
          // 스테이포인트 전체가 보이도록 bounds. 단 명시적 center(목록 항목 선택)면 그 지점 우선.
          const bounds = new maps.LatLngBounds();
          stays.forEach((s) => bounds.extend(new maps.LatLng(s.lat, s.lng)));
          if (stays.length === 1) mapRef.current.setCenter(new maps.LatLng(stays[0].lat, stays[0].lng));
          else {
            mapRef.current.setBounds(
              bounds,
              fitPadding.top,
              fitPadding.right,
              fitPadding.bottom,
              fitPadding.left,
            );
          }
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    child,
    zones,
    places,
    route,
    stays,
    destination,
    picked,
    center,
    centerLevel,
    recenterKey,
    viewportPadding?.top,
    viewportPadding?.right,
    viewportPadding?.bottom,
    viewportPadding?.left,
    retryKey,
  ]);

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
      <div className={[className, "km-error"].filter(Boolean).join(" ")} role="status">
        <strong className="km-error__title">
          {tone === "child" ? intl.formatMessage({ id: "shared.kakaoMap.copy001" }) : intl.formatMessage({ id: "shared.kakaoMap.copy002" })}
        </strong>
        <span className="km-error__detail">
          {tone === "child" ? intl.formatMessage({ id: "shared.kakaoMap.copy003" }) : intl.formatMessage({ id: "shared.kakaoMap.copy004" })}
        </span>
        <button
          type="button"
          className="km-error__retry hy-press"
          onClick={() => {
            setFailed(false);
            setReady(false);
            setRetryKey((value) => value + 1);
          }}
        >
          {intl.formatMessage({ id: "shared.kakaoMap.copy005" })}
        </button>
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
          <LoaderMark variant="location" />
        </div>
      )}
    </div>
  );
}
