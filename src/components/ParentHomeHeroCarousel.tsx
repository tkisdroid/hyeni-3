/**
 * 부모 홈 히어로 캐러셀.
 *
 * 기존 "오늘" 히어로를 첫 슬라이드로 감싸고, 뒤에 소식 슬라이드를 붙인다.
 *
 * 지켜야 하는 것
 *  · **가로 overflow 를 문서에 만들지 않는다.** 트랙은 내부 컨테이너에서만 스크롤하고
 *    `html/body` 는 그대로 둔다(부모 홈 CDP 스모크가 `scrollWidth - clientWidth > 1` 이면 실패시킨다).
 *  · `prefers-reduced-motion` 에서는 자동 전환을 멈춘다(판정은 `resolveHeroAutoPlayMs`).
 *  · 좌우 버튼·점 표시는 `hy-press` 를 붙인다(`tests/pressFeedbackCoverage.test.mjs` 계약).
 *  · 슬라이드가 한 장이면 컨트롤을 아예 렌더하지 않는다 — 누를 곳이 없는 버튼을 두지 않는다.
 *
 * 판정은 전부 `transform/parentHomeHeroCarousel` 의 순수 함수가 하고 여기서는 그리기만 한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { MessageId } from "@/i18n/generated/messageIds";
import { asset } from "@/lib/assets";
import {
  nextHeroIndex,
  resolveHeroAutoPlayMs,
  type ParentHomeHeroControls,
  type ParentHomeHeroSlide,
} from "@/transform/parentHomeHeroCarousel";

/**
 * 슬라이드 id → 문구·이미지. today 는 호출부가 children 으로 넘긴다.
 *
 * ⚠️ 이미지는 `public/assets` 에 **실제로 있는 파일**만 쓴다. 없는 경로를 넣으면
 * `.ph-hero__mascot` 크기(128×146)의 깨진 이미지 상자가 히어로 오른쪽에 그대로 보인다
 * (2026-08-25 A17 실기기에서 `ui/clay/book.webp`·`star.webp` 로 실제 발생).
 * 회귀는 `tests/assetReferenceExistence.test.mjs` 가 전수로 막는다.
 */
const SLIDE_COPY: Record<string, { eyebrow: MessageId; title: MessageId; body: MessageId; image: string }> = {
  hyeni_study: {
    eyebrow: "parent.home.heroSlide.study.eyebrow" as MessageId,
    title: "parent.home.heroSlide.study.title" as MessageId,
    body: "parent.home.heroSlide.study.body" as MessageId,
    image: "mascot/diary.webp",
  },
  hyeni_world: {
    eyebrow: "parent.home.heroSlide.world.eyebrow" as MessageId,
    title: "parent.home.heroSlide.world.title" as MessageId,
    body: "parent.home.heroSlide.world.body" as MessageId,
    image: "mascot/cheer.webp",
  },
};

export interface ParentHomeHeroCarouselProps {
  slides: readonly ParentHomeHeroSlide[];
  controls: ParentHomeHeroControls;
  /** 첫 슬라이드(오늘 요약). 기존 히어로 마크업을 그대로 넘긴다. */
  children: React.ReactNode;
  /** 소식 슬라이드를 눌러 외부 링크를 열 때. 호출부가 네이티브/웹을 구분한다. */
  onOpenExternal: (url: string, slideId: string) => void;
  /** 캘린더 안에 포함된 기능 슬라이드로 이동할 때. */
  onNavigateInternal: (path: string) => void;
}

export function ParentHomeHeroCarousel({
  slides,
  controls,
  children,
  onOpenExternal,
  onNavigateInternal,
}: ParentHomeHeroCarouselProps) {
  const intl = useIntl();
  const [index, setIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const interactionTimer = useRef<number | null>(null);

  const count = slides.length;
  // 표시 개수가 줄어드는 설정 변경에서 인덱스가 범위를 벗어나지 않게 한다.
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;

  const reducedMotion = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const autoPlayMs = resolveHeroAutoPlayMs({
    controls,
    slideCount: count,
    reducedMotion,
    userInteracting: interacting,
  });

  /** 손으로 넘긴 뒤 잠시 자동 전환을 멈춘다 — 읽는 중에 화면이 바뀌면 안 된다. */
  const holdAutoPlay = useCallback(() => {
    setInteracting(true);
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
    interactionTimer.current = window.setTimeout(() => setInteracting(false), 8000);
  }, []);

  useEffect(() => () => {
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
  }, []);

  /**
   * 표시 인덱스 → 트랙 스크롤 위치. **커밋 뒤 effect 에서만** 옮긴다.
   *
   * ⚠️ 클릭 핸들러 안에서 곧바로 `scrollTo` 하면 같은 프레임의 재렌더와
   * `scroll-snap-type: x mandatory` 재스냅이 방금 시작한 smooth 스크롤을 되돌려
   * **화살표를 눌러도 아무 일도 일어나지 않는다**(2026-08-25 A17 실기기에서 재현).
   * 그래서 인덱스만 상태로 바꾸고, 실제 스크롤은 DOM 커밋 뒤 rAF 에서 1회 지시한다.
   *
   * 손가락 스크롤과 싸우지 않도록 목표와 현재 위치가 8px 이내면 건드리지 않는다.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track || count <= 1) return;
    const frame = window.requestAnimationFrame(() => {
      const width = track.clientWidth;
      if (width <= 0) return;
      const child = track.children[safeIndex] as HTMLElement | undefined;
      const offset = child?.offsetLeft ?? 0;
      // 콜드 스타트에는 레이아웃이 끝나지 않아 offsetLeft 가 0 으로 나온다 → 폭으로 대체한다.
      const target = offset > 0 || safeIndex === 0 ? offset : width * safeIndex;
      if (Math.abs(track.scrollLeft - target) <= 8) return;
      track.scrollTo({ left: target, behavior: reducedMotion ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [safeIndex, count, reducedMotion]);

  const goTo = useCallback((next: number, options?: { manual?: boolean }) => {
    if (options?.manual) holdAutoPlay();
    // 스크롤은 위 effect 가 커밋 뒤에 지시한다(여기서 직접 옮기지 않는다).
    setIndex(next);
  }, [holdAutoPlay]);

  useEffect(() => {
    if (autoPlayMs <= 0) return;
    const timer = window.setInterval(() => {
      setIndex((current) => nextHeroIndex(current, count));
    }, autoPlayMs);
    return () => window.clearInterval(timer);
  }, [autoPlayMs, count]);

  // 손가락으로 밀었을 때 현재 슬라이드를 따라간다(스크롤 스냅과 점 표시를 맞춘다).
  // 폭이 아직 0 이면 판정하지 않는다 — 0 으로 나눈 결과가 방금 누른 인덱스를 되돌린다.
  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const width = track.clientWidth;
    if (width <= 0) return;
    const next = Math.round(track.scrollLeft / width);
    setIndex((current) => (current === next ? current : Math.min(Math.max(next, 0), Math.max(count - 1, 0))));
  }, [count]);

  if (count <= 1) {
    // 한 장이면 캐러셀 껍데기를 만들지 않는다 — 기존 히어로와 같은 DOM 을 유지한다.
    return <>{children}</>;
  }

  return (
    <section
      className="ph-hero-carousel"
      aria-roledescription="carousel"
      aria-label={intl.formatMessage({ id: "parent.home.heroCarousel.label" as MessageId })}
    >
      <div
        className="ph-hero-carousel__track"
        ref={trackRef}
        onScroll={handleScroll}
        onPointerDown={holdAutoPlay}
      >
        {slides.map((slide, position) => (
          <div
            className="ph-hero-carousel__slide"
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={intl.formatMessage(
              { id: "parent.home.heroCarousel.slidePosition" as MessageId },
              { position: position + 1, total: count },
            )}
          >
            {slide.kind === "today" ? children : renderPromoSlide(slide)}
          </div>
        ))}
      </div>

      <div className="ph-hero-carousel__controls">
        <button
          type="button"
          className="ph-hero-carousel__arrow hy-press"
          onClick={() => goTo(nextHeroIndex(safeIndex, count, -1), { manual: true })}
          aria-label={intl.formatMessage({ id: "parent.home.heroCarousel.previous" as MessageId })}
        >
          <ChevronLeft size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <div className="ph-hero-carousel__dots">
          {slides.map((slide, position) => (
            <button
              type="button"
              key={slide.id}
              className="ph-hero-carousel__dot hy-press"
              data-active={position === safeIndex ? "true" : "false"}
              aria-current={position === safeIndex ? "true" : undefined}
              onClick={() => goTo(position, { manual: true })}
              aria-label={intl.formatMessage(
                { id: "parent.home.heroCarousel.goToSlide" as MessageId },
                { position: position + 1 },
              )}
            />
          ))}
        </div>
        <button
          type="button"
          className="ph-hero-carousel__arrow hy-press"
          onClick={() => goTo(nextHeroIndex(safeIndex, count), { manual: true })}
          aria-label={intl.formatMessage({ id: "parent.home.heroCarousel.next" as MessageId })}
        >
          <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </section>
  );

  function renderPromoSlide(slide: ParentHomeHeroSlide) {
    const copy = SLIDE_COPY[slide.id];
    if (!copy) return null;
    const url = slide.externalUrl;
    const path = slide.internalPath;
    return (
      <button
        type="button"
        className="ph-hero ph-hero--promo"
        onClick={() => {
          if (path) onNavigateInternal(path);
          else if (url) onOpenExternal(url, slide.id);
        }}
      >
        <span className="ph-hero__mascot">
          <img src={asset(copy.image)} alt="" />
        </span>
        <span className="ph-hero__badge">{intl.formatMessage({ id: copy.eyebrow })}</span>
        <div className="ph-hero__title">{intl.formatMessage({ id: copy.title })}</div>
        <div className="ph-hero__live">
          <span className="ph-hero__location-state">{intl.formatMessage({ id: copy.body })}</span>
          {path
            ? <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
            : <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />}
        </div>
      </button>
    );
  }
}
