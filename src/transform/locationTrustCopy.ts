import { formatFreshness } from "./locationView.ts";
import type { LocationMode } from "./tierPolicy";

export interface LocationTrustCopy {
  badge: string;
  detail: string;
}

export type LocationTrustLoadState = "ready" | "loading" | "error";

/** 위치 티어와 GPS fix 신선도를 함께 반영해 현재·지연·과거 위치를 구분한다. */
export function resolveLocationTrustCopy(input: {
  mode: LocationMode;
  modeKnown: boolean;
  updatedAt: string | null | undefined;
  loadState?: LocationTrustLoadState;
  now?: Date;
}): LocationTrustCopy {
  // 무료 잠금은 좌표 캐시·조회 상태보다 먼저 적용한다. 이전 프리미엄 좌표가
  // 캐시에 남아도 잠금 사용자의 현재 위치처럼 노출하지 않는다.
  if (input.modeKnown && input.mode === "locked") {
    return { badge: "위치 조회 제한", detail: "현재 위치는 표시되지 않아요" };
  }

  if (!input.modeKnown) {
    if (input.loadState === "error") {
      return {
        badge: "위치 조회 범위 확인 실패",
        detail: "새로고침해서 다시 확인해 주세요",
      };
    }
    if (!input.updatedAt) {
      return { badge: "위치 조회 범위 확인 중", detail: "구독 상태를 확인하고 있어요" };
    }
    const fresh = formatFreshness(input.updatedAt, input.now ?? new Date());
    return { badge: "마지막 확인 위치", detail: `${fresh.label} 갱신` };
  }

  if (!input.updatedAt) {
    if (input.loadState === "loading") {
      return { badge: "위치 불러오는 중", detail: "위치 정보를 불러오고 있어요" };
    }
    if (input.loadState === "error") {
      return { badge: "위치 조회 실패", detail: "새 위치를 불러오지 못했어요" };
    }
    if (input.mode === "delayed") {
      return { badge: "공개할 지연 위치 없음", detail: "15분 이전 위치가 아직 없어요" };
    }
    return { badge: "위치 신호 대기", detail: "아이 기기의 새 위치 신호를 기다리고 있어요" };
  }

  const fresh = formatFreshness(input.updatedAt, input.now ?? new Date());
  if (input.loadState === "error") {
    if (input.mode === "delayed") {
      return {
        badge: "15분 지연 위치",
        detail: `새 공개 위치 조회 실패 · 마지막 공개 위치 ${fresh.label}`,
      };
    }
    return { badge: "마지막 확인 위치", detail: `새 위치 조회 실패 · ${fresh.label}` };
  }
  if (input.mode === "delayed") {
    return { badge: "15분 지연 위치", detail: `마지막 공개 위치 · ${fresh.label}` };
  }
  if (fresh.status === "live") {
    return { badge: "현재 위치", detail: "방금 갱신" };
  }
  return { badge: "마지막 확인 위치", detail: `${fresh.label} 갱신` };
}
