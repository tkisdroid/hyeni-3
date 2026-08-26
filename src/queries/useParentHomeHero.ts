/**
 * 부모 홈 히어로 캐러셀 조회 훅.
 *
 * 운영자 전역 설정이라 가족별 키가 없다. 조회가 실패하거나 아직 오지 않았으면
 * **기본 컨트롤**을 쓴다 — 히어로는 안전 기능이 아니라 표시 영역이고, 설정을 못 읽었다고
 * 오늘 요약을 감추면 부모가 앱을 여는 이유가 사라진다.
 *
 * 다만 **구독 여부는 여기서 추측하지 않는다**. 슬라이드 판정은
 * `resolveParentHomeHeroSlides` 가 `useEntitlement().ready` 를 함께 보고 결정한다(R9).
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { qk } from "./keys";
import { fetchParentHomeHeroCarousel } from "@/lib/api/endpoints/family";
import {
  DEFAULT_PARENT_HOME_HERO_CONTROLS,
  type ParentHomeHeroControls,
} from "@/transform/parentHomeHeroCarousel";

export interface UseParentHomeHeroCarouselResult {
  controls: ParentHomeHeroControls;
  /** 서버 설정을 실제로 받았는지. false 면 기본값으로 렌더 중이다. */
  loaded: boolean;
}

export function useParentHomeHeroCarousel(): UseParentHomeHeroCarouselResult {
  const { status, role } = useAuth();
  const query = useQuery({
    queryKey: qk.parentHomeHeroCarousel,
    queryFn: fetchParentHomeHeroCarousel,
    // 아이·선생님 화면에는 히어로가 없다. 서버도 부모만 허용한다.
    enabled: status === "authenticated" && role === "parent",
    retry: false,
    staleTime: 5 * 60_000,
  });

  return {
    controls: query.data ?? DEFAULT_PARENT_HOME_HERO_CONTROLS,
    loaded: query.data != null,
  };
}
