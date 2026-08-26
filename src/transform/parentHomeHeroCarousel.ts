/**
 * 부모 홈 히어로 캐러셀 정본(순수).
 *
 * 히어로는 원래 "오늘" 한 장이었다. 여기서 좌우로 넘기고 자동 전환되는 캐러셀로 넓히면서
 * 두 가지를 계약으로 못박는다.
 *
 *  1) **첫 장은 항상 `today`** 다. 오늘 일정 수와 아이 위치는 부모가 앱을 여는 이유이므로
 *     홍보 슬라이드가 그 자리를 밀어내지 않는다. 표시 개수가 0 이어도 today 는 남는다.
 *  2) **구독 가족에게는 `ad` 종류를 보여주지 않는다.** 광고를 없애는 것이 구독의 값어치 중 하나라서다.
 *     `promo`(자사 사이드 프로젝트·유튜브)는 광고가 아니라 소식이므로 구독 여부와 무관하게 노출한다.
 *
 * ⚠️ 엔타이틀먼트가 확정되지 않았으면(`ready === false`) **무료 개수로 강등하지 않는다**(R9).
 * 조회 실패로 프리미엄 가족에게 광고를 띄우는 일이 없어야 한다. 미확정에서는 today 한 장만 둔다.
 *
 * ⚠️ `ad` 종류를 실제로 켜려면 Play Console 의 "광고 포함" 선언과 스토어 설명의
 * "광고를 표시하지 않으며" 문구를 함께 고쳐야 한다. Google 은 자사 앱 크로스 프로모션도 광고로 본다.
 * 그래서 `DEFAULT_PARENT_HOME_HERO_SLIDES` 에는 `ad` 가 없다.
 */

/** 슬라이드 성격. `ad` 만 구독 가족에게서 숨긴다. */
export type ParentHomeHeroSlideKind = "today" | "promo" | "ad";

export interface ParentHomeHeroSlide {
  /** 안정 식별자. 분석·운영 설정에서 이 값을 쓴다(문구가 바뀌어도 유지). */
  id: string;
  kind: ParentHomeHeroSlideKind;
  /** promo·ad 가 열 외부 링크. today 는 앱 내부로 이동하므로 없다. */
  externalUrl?: string;
  /** today 가 이동할 앱 내부 경로. */
  route?: string;
}

/** 히어로에 둘 수 있는 슬라이드 상한. 운영자 입력 검증에도 쓴다. */
export const MAX_PARENT_HOME_HERO_SLIDES = 6;

/**
 * 기본 슬라이드 3개. `ad` 는 의도적으로 없다(위 주석의 Play 선언 이유).
 * 순서가 곧 표시 순서이며 첫 장은 반드시 `today` 여야 한다.
 */
export const DEFAULT_PARENT_HOME_HERO_SLIDES: readonly ParentHomeHeroSlide[] = Object.freeze([
  { id: "today", kind: "today", route: "/parent/calendar" },
  { id: "hyeni_study", kind: "promo", externalUrl: "https://hyenistudy.com" },
  { id: "hyeni_world", kind: "promo", externalUrl: "https://www.youtube.com/@hyeniworld" },
]);

/** 운영자가 정하는 값. 한 행 JSON 으로 저장해 구독/비구독 개수가 어긋난 중간 상태를 만들지 않는다. */
export interface ParentHomeHeroControls {
  /** 비구독 가족에게 보일 슬라이드 수(첫 장 today 포함). */
  freeVisibleCount: number;
  /** 구독 가족에게 보일 슬라이드 수(첫 장 today 포함). */
  premiumVisibleCount: number;
  /** 자동 전환 간격(ms). 0 이면 자동 전환하지 않는다. */
  autoPlayMs: number;
}

/** 운영자가 아직 설정하지 않았을 때 쓰는 안전 기본값. */
export const DEFAULT_PARENT_HOME_HERO_CONTROLS: ParentHomeHeroControls = Object.freeze({
  freeVisibleCount: 3,
  premiumVisibleCount: 2,
  autoPlayMs: 6000,
});

/** 자동 전환 간격 허용 범위. 너무 짧으면 읽을 수 없고 0 은 "자동 전환 끄기"다. */
export const MIN_HERO_AUTOPLAY_MS = 3000;
export const MAX_HERO_AUTOPLAY_MS = 30_000;

function isCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_PARENT_HOME_HERO_SLIDES;
}

function isAutoPlay(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  if (value === 0) return true;
  return value >= MIN_HERO_AUTOPLAY_MS && value <= MAX_HERO_AUTOPLAY_MS;
}

/**
 * 저장된 값 → 컨트롤. 형식·범위가 어긋나면 **부분 수용하지 않고** null 을 돌려준다.
 * 절반만 맞는 설정을 적용하면 운영자가 의도하지 않은 조합이 화면에 나간다.
 */
export function parseParentHomeHeroControls(value: unknown): ParentHomeHeroControls | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isCount(row.freeVisibleCount)) return null;
  if (!isCount(row.premiumVisibleCount)) return null;
  if (!isAutoPlay(row.autoPlayMs)) return null;
  return {
    freeVisibleCount: row.freeVisibleCount,
    premiumVisibleCount: row.premiumVisibleCount,
    autoPlayMs: row.autoPlayMs,
  };
}

export interface ResolveParentHomeHeroSlidesInput {
  /** 정의된 슬라이드 목록. 기본값은 `DEFAULT_PARENT_HOME_HERO_SLIDES`. */
  slides?: readonly ParentHomeHeroSlide[];
  controls: ParentHomeHeroControls;
  /** `useEntitlement().ready` — false 면 구독 여부를 아직 모른다. */
  entitlementReady: boolean;
  /** `useEntitlement().isPremium`. `entitlementReady` 가 false 면 읽지 않는다. */
  isPremium: boolean;
}

/**
 * 실제로 보여줄 슬라이드.
 *
 * 순서: ①`ad` 를 구독 가족에게서 제거 → ②티어별 개수로 자르기 → ③첫 장 today 보장.
 * 엔타이틀먼트 미확정이면 today 한 장만 돌려준다(광고·홍보를 추측으로 띄우지 않는다).
 */
export function resolveParentHomeHeroSlides(
  input: ResolveParentHomeHeroSlidesInput,
): readonly ParentHomeHeroSlide[] {
  const all = input.slides ?? DEFAULT_PARENT_HOME_HERO_SLIDES;
  const today = all.find((slide) => slide.kind === "today");
  const fallback = today ? [today] : [];
  if (!input.entitlementReady) return Object.freeze(fallback);

  const premium = input.isPremium;
  // 광고는 구독 가족에게 보여주지 않는다. promo 는 소식이라 남긴다.
  const allowed = all.filter((slide) => !(premium && slide.kind === "ad"));
  const limit = premium ? input.controls.premiumVisibleCount : input.controls.freeVisibleCount;

  const visible = allowed.slice(0, Math.max(0, limit));
  if (today && !visible.some((slide) => slide.id === today.id)) {
    // 개수가 0 이거나 today 가 잘려 나갔으면 되살린다 — 오늘 요약은 히어로의 본문이다.
    return Object.freeze([today]);
  }
  return Object.freeze(visible.length > 0 ? visible : fallback);
}

export interface ResolveHeroAutoPlayInput {
  controls: ParentHomeHeroControls;
  slideCount: number;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** 사용자가 방금 손으로 넘겼는지(직접 조작 중에는 자동 전환하지 않는다). */
  userInteracting?: boolean;
}

/** 자동 전환 간격(ms). 0 이면 타이머를 걸지 않는다. */
export function resolveHeroAutoPlayMs(input: ResolveHeroAutoPlayInput): number {
  if (input.slideCount < 2) return 0;
  if (input.reducedMotion) return 0;
  if (input.userInteracting) return 0;
  const ms = input.controls.autoPlayMs;
  if (!isAutoPlay(ms) || ms === 0) return 0;
  return ms;
}

/** 다음 인덱스(순환). 슬라이드가 없으면 0. */
export function nextHeroIndex(current: number, slideCount: number, step = 1): number {
  if (slideCount <= 0) return 0;
  const raw = (current + step) % slideCount;
  return raw < 0 ? raw + slideCount : raw;
}
