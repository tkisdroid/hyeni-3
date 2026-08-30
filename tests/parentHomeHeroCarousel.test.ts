import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PARENT_HOME_HERO_CONTROLS,
  DEFAULT_PARENT_HOME_HERO_SLIDES,
  PARENT_HOME_HERO_SLIDE_CATALOG,
  MAX_HERO_AUTOPLAY_MS,
  MAX_PARENT_HOME_HERO_SLIDES,
  MIN_HERO_AUTOPLAY_MS,
  nextHeroIndex,
  parseParentHomeHeroControls,
  resolveHeroAutoPlayMs,
  resolveParentHomeHeroSlides,
  type ParentHomeHeroSlide,
} from "../src/transform/parentHomeHeroCarousel.ts";

const controls = DEFAULT_PARENT_HOME_HERO_CONTROLS;

test("혜니스터디 카탈로그는 미니앱 허브를 거쳐 수학으로 진입한다", () => {
  assert.deepEqual(
    PARENT_HOME_HERO_SLIDE_CATALOG,
    [
      { id: "today", kind: "today", route: "/parent/calendar" },
      { id: "hyeni_study", kind: "promo", internalPath: "/miniapps" },
      { id: "hyeni_world", kind: "promo", externalUrl: "https://www.youtube.com/@hyeniworld" },
    ],
    "추후 활성화할 전체 카탈로그는 보존해야 합니다",
  );
  assert.equal(DEFAULT_PARENT_HOME_HERO_SLIDES.length, 1);
  assert.equal(DEFAULT_PARENT_HOME_HERO_SLIDES[0].kind, "today");
  // Play Console "광고 포함" 선언과 스토어 문구를 고치기 전에는 ad 를 기본으로 넣지 않는다.
  assert.equal(DEFAULT_PARENT_HOME_HERO_SLIDES.some((slide) => slide.kind === "ad"), false);
  // id 는 안정 식별자여야 한다(분석·운영 설정이 참조한다).
  assert.deepEqual(
    DEFAULT_PARENT_HOME_HERO_SLIDES.map((slide) => slide.id),
    ["today"],
  );
  // 현재 릴리스의 today 는 앱 내부 혜니캘린더로 이동한다.
  assert.equal(DEFAULT_PARENT_HOME_HERO_SLIDES[0].route, "/parent/calendar");
  const study = PARENT_HOME_HERO_SLIDE_CATALOG.find((slide) => slide.id === "hyeni_study");
  assert.equal(study?.internalPath, "/miniapps");
  assert.equal("externalUrl" in (study ?? {}), false);
});

test("운영 설정이 최대 개수와 자동 전환을 요구해도 현재 릴리스는 한 장에서 멈춘다", () => {
  for (const isPremium of [false, true]) {
    const slides = resolveParentHomeHeroSlides({
      controls: {
        freeVisibleCount: MAX_PARENT_HOME_HERO_SLIDES,
        premiumVisibleCount: MAX_PARENT_HOME_HERO_SLIDES,
        autoPlayMs: 6000,
      },
      entitlementReady: true,
      isPremium,
    });
    assert.deepEqual(slides.map((slide) => slide.id), ["today"]);
    assert.equal(resolveHeroAutoPlayMs({
      controls,
      slideCount: slides.length,
      reducedMotion: false,
    }), 0);
  }
});

test("엔타이틀먼트가 미확정이면 무료 개수로 강등하지 않고 today 한 장만 보여준다", () => {
  const slides = resolveParentHomeHeroSlides({
    controls: { ...controls, freeVisibleCount: 3, premiumVisibleCount: 3 },
    entitlementReady: false,
    isPremium: false,
  });
  assert.deepEqual(slides.map((slide) => slide.id), ["today"]);
});

test("구독 가족에게는 ad 종류를 보여주지 않고 promo 는 남긴다", () => {
  const withAd: ParentHomeHeroSlide[] = [
    ...PARENT_HOME_HERO_SLIDE_CATALOG,
    { id: "house_ad", kind: "ad", externalUrl: "https://example.com/ad" },
  ];
  const premium = resolveParentHomeHeroSlides({
    slides: withAd,
    controls: { ...controls, premiumVisibleCount: MAX_PARENT_HOME_HERO_SLIDES },
    entitlementReady: true,
    isPremium: true,
  });
  assert.equal(premium.some((slide) => slide.kind === "ad"), false, "구독자에게 광고가 보입니다");
  assert.equal(premium.some((slide) => slide.id === "hyeni_study"), true, "promo 는 남아야 합니다");

  const free = resolveParentHomeHeroSlides({
    slides: withAd,
    controls: { ...controls, freeVisibleCount: MAX_PARENT_HOME_HERO_SLIDES },
    entitlementReady: true,
    isPremium: false,
  });
  assert.equal(free.some((slide) => slide.kind === "ad"), true, "비구독자에게는 광고를 쓸 수 있어야 합니다");
});

test("티어별 표시 개수를 따르고 첫 장 today 는 잘리지 않는다", () => {
  const free = resolveParentHomeHeroSlides({
    slides: PARENT_HOME_HERO_SLIDE_CATALOG,
    controls: { ...controls, freeVisibleCount: 2 },
    entitlementReady: true,
    isPremium: false,
  });
  assert.deepEqual(free.map((slide) => slide.id), ["today", "hyeni_study"]);

  const premium = resolveParentHomeHeroSlides({
    slides: PARENT_HOME_HERO_SLIDE_CATALOG,
    controls: { ...controls, premiumVisibleCount: 1 },
    entitlementReady: true,
    isPremium: true,
  });
  assert.deepEqual(premium.map((slide) => slide.id), ["today"]);

  // 개수 0 이어도 오늘 요약은 남는다(히어로의 본문이라 비울 수 없다).
  const zero = resolveParentHomeHeroSlides({
    slides: PARENT_HOME_HERO_SLIDE_CATALOG,
    controls: { ...controls, freeVisibleCount: 0 },
    entitlementReady: true,
    isPremium: false,
  });
  assert.deepEqual(zero.map((slide) => slide.id), ["today"]);
});

test("저장된 컨트롤은 형식·범위가 맞을 때만 수용하고 부분 수용하지 않는다", () => {
  assert.deepEqual(
    parseParentHomeHeroControls({ freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: 6000 }),
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: 6000 },
  );
  // 자동 전환 끄기
  assert.deepEqual(
    parseParentHomeHeroControls({ freeVisibleCount: 1, premiumVisibleCount: 1, autoPlayMs: 0 }),
    { freeVisibleCount: 1, premiumVisibleCount: 1, autoPlayMs: 0 },
  );
  for (const bad of [
    null,
    [],
    "3",
    { freeVisibleCount: 3, premiumVisibleCount: 2 },
    { freeVisibleCount: -1, premiumVisibleCount: 2, autoPlayMs: 6000 },
    { freeVisibleCount: 3, premiumVisibleCount: MAX_PARENT_HOME_HERO_SLIDES + 1, autoPlayMs: 6000 },
    { freeVisibleCount: 1.5, premiumVisibleCount: 2, autoPlayMs: 6000 },
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: MIN_HERO_AUTOPLAY_MS - 1 },
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: MAX_HERO_AUTOPLAY_MS + 1 },
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: "6000" },
  ]) {
    assert.equal(parseParentHomeHeroControls(bad), null, `수용돼서는 안 됩니다: ${JSON.stringify(bad)}`);
  }
});

test("자동 전환은 슬라이드 2장 이상·움직임 허용·비조작 상태에서만 돈다", () => {
  assert.equal(resolveHeroAutoPlayMs({ controls, slideCount: 3, reducedMotion: false }), controls.autoPlayMs);
  assert.equal(resolveHeroAutoPlayMs({ controls, slideCount: 1, reducedMotion: false }), 0, "한 장이면 멈춘다");
  assert.equal(resolveHeroAutoPlayMs({ controls, slideCount: 3, reducedMotion: true }), 0, "움직임 줄이기에서 멈춘다");
  assert.equal(
    resolveHeroAutoPlayMs({ controls, slideCount: 3, reducedMotion: false, userInteracting: true }),
    0,
    "직접 넘기는 중에는 멈춘다",
  );
  assert.equal(
    resolveHeroAutoPlayMs({ controls: { ...controls, autoPlayMs: 0 }, slideCount: 3, reducedMotion: false }),
    0,
    "운영자가 0 으로 끄면 멈춘다",
  );
});

test("인덱스는 양방향으로 순환한다", () => {
  assert.equal(nextHeroIndex(0, 3), 1);
  assert.equal(nextHeroIndex(2, 3), 0);
  assert.equal(nextHeroIndex(0, 3, -1), 2);
  assert.equal(nextHeroIndex(0, 0), 0);
});
