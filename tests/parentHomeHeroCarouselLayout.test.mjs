/**
 * 부모 홈 히어로 캐러셀의 레이아웃·조작 계약.
 *
 * 판정 로직은 `tests/parentHomeHeroCarousel.test.ts` 가 순수 함수로 지키고, 여기서는
 * **화면이 깨지는 방식**만 막는다.
 *
 *  · 가로 overflow 를 문서에 만들지 않는다. 부모 홈 CDP 스모크가
 *    `documentElement.scrollWidth - clientWidth > 1` 이면 라우트를 실패시키므로,
 *    트랙 안에서만 스크롤해야 한다.
 *  · 슬라이드 상한(6장)에서 점 표시가 잘리지 않는다 — 캐러셀이 `overflow:hidden` 이라
 *    넘친 점은 스크롤도 되지 않고 그냥 사라진다.
 *  · 좌우 화살표·점은 실제 버튼이라 눌림 피드백(`hy-press`)과 44px 터치 영역을 갖는다.
 *  · 유리 표면은 `prefers-reduced-transparency` 폴백을 함께 둔다(부모 홈 글래스 계약).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(`${repoRoot}src/screens/parent/ParentHome.redesign.css`, "utf8");
const component = readFileSync(`${repoRoot}src/components/ParentHomeHeroCarousel.tsx`, "utf8");

/** 선택자의 최상위 블록 선언부를 뽑는다(중첩 at-rule 안은 별도로 확인한다). */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${selector} 블록을 찾지 못했습니다`);
  return match[1];
}

test("히어로 캐러셀의 가로 스크롤은 트랙 안에서만 일어난다", () => {
  const root = block(".ph-hero-carousel");
  const track = block(".ph-hero-carousel__track");

  // 껍데기는 넘친 부분을 잘라 문서 스크롤폭을 늘리지 않는다.
  assert.match(root, /overflow:\s*hidden/);
  assert.match(root, /min-width:\s*0/);
  // 실제 스크롤은 트랙만 갖는다.
  assert.match(track, /overflow-x:\s*auto/);
  assert.match(track, /min-width:\s*0/);
  // 스크롤 연쇄가 문서로 번지지 않게 막는다(모바일에서 페이지가 좌우로 밀리는 원인).
  assert.match(track, /overscroll-behavior-x:\s*contain/);
  assert.match(track, /scroll-snap-type:\s*x\s+mandatory/);

  // 슬라이드는 트랙 폭 100% 를 차지하되 스스로는 줄어들 수 있어야 한다.
  const slide = block(".ph-hero-carousel__slide");
  assert.match(slide, /flex:\s*0\s+0\s+100%/);
  assert.match(slide, /min-width:\s*0/);
});

test("캐러셀 CSS는 html·body·#root 의 overflow 를 건드리지 않는다", () => {
  const carouselSection = css.slice(css.indexOf(".ph-hero-carousel"));
  assert.doesNotMatch(carouselSection, /(?:^|\n)\s*(?:html|body|#root)\b[^{]*\{[^}]*overflow/);
});

test("슬라이드 상한에서도 점 표시가 잘리지 않게 줄바꿈한다", () => {
  const dots = block(".ph-hero-carousel__dots");
  assert.match(dots, /flex-wrap:\s*wrap/);
  assert.match(dots, /min-width:\s*0/);

  // 44px 점 6개가 최소 폭(320px - 좌우 16px 패딩 - 화살표 2×44px - 4px 간격 2개)에서
  // 한 줄에 들어가지 않는다는 사실을 계산으로 고정한다 → 그래서 wrap 이 필수다.
  const available = 320 - 16 * 2 - 44 * 2 - 4 * 2;
  const singleRow = 44 * 6 + 8 * 5;
  assert.ok(singleRow > available, "한 줄에 들어간다면 wrap 계약을 다시 검토해야 합니다");
});

test("좌우 화살표와 점은 44px 터치 영역과 눌림 피드백을 갖는다", () => {
  const arrow = block(".ph-hero-carousel__arrow");
  const dot = block(".ph-hero-carousel__dot");
  for (const rule of [arrow, dot]) {
    assert.match(rule, /width:\s*44px/);
    assert.match(rule, /height:\s*44px/);
  }

  // 실제 버튼에는 hy-press 가 붙어 있어야 한다(눌림 피드백 계약).
  const pressed = component.match(/className="ph-hero-carousel__(?:arrow|dot) hy-press"/g) ?? [];
  assert.equal(pressed.length, 3, "화살표 2개와 점 버튼 1개 모두 hy-press 를 써야 합니다");
});

test("좌우 화살표는 공통 유리 조작 면에 작은 아이콘을 표시한다", () => {
  const controls = block(".ph-hero-carousel__controls");
  const arrow = block(".ph-hero-carousel__arrow");
  assert.match(controls, /gap:\s*4px/);
  assert.match(arrow, /background:\s*var\(--control-fill\)/);
  assert.match(arrow, /box-shadow:\s*var\(--control-shadow\)/);
  assert.doesNotMatch(arrow, /backdrop-filter/);

  const icons = component.match(/<Chevron(?:Left|Right) size=\{16\} strokeWidth=\{2\.2\}/g) ?? [];
  assert.equal(icons.length, 2, "좌우 화살표가 모두 16px 저대비 아이콘이어야 합니다");
});

test("슬라이드가 한 장이면 캐러셀 껍데기와 컨트롤을 렌더하지 않는다", () => {
  // 누를 곳이 없는 화살표·점을 남기지 않고, 기존 히어로와 같은 DOM 을 유지한다.
  assert.match(component, /if \(count <= 1\) \{[\s\S]*?return <>\{children\}<\/>;/);
});

test("스크롤은 클릭 핸들러가 아니라 커밋 뒤 effect 가 지시한다", () => {
  // 같은 프레임의 재렌더·재스냅이 smooth 스크롤을 되돌려 화살표가 먹지 않던 A17 실사고 대응.
  assert.match(component, /const goTo = useCallback\(\(next: number, options\?: \{ manual\?: boolean \}\) => \{\s*\n\s*if \(options\?\.manual\) holdAutoPlay\(\);[\s\S]*?setIndex\(next\);\s*\n\s*\}, \[holdAutoPlay\]\);/);
  assert.match(component, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?track\.scrollTo\(/);
  assert.match(component, /return \(\) => window\.cancelAnimationFrame\(frame\);/);
  // 자동 전환도 인덱스만 바꾼다 — 스크롤 지시가 두 곳에 있으면 다시 서로를 되돌린다.
  assert.match(component, /setIndex\(\(current\) => nextHeroIndex\(current, count\)\);/);
  assert.equal((component.match(/track\.scrollTo\(/g) ?? []).length, 1, "scrollTo 는 effect 한 곳에서만 호출해야 합니다");

  // 콜드 스타트 레이아웃 전 offsetLeft 0 대체와, 손가락 스크롤과 싸우지 않는 8px 여유.
  assert.match(component, /const target = offset > 0 \|\| safeIndex === 0 \? offset : width \* safeIndex;/);
  assert.match(component, /if \(Math\.abs\(track\.scrollLeft - target\) <= 8\) return;/);
  // 폭이 0 인 동안의 scroll 이벤트가 방금 누른 인덱스를 0 으로 되돌리지 않게 한다.
  assert.match(component, /const width = track\.clientWidth;\s*\n\s*if \(width <= 0\) return;/);
  assert.doesNotMatch(component, /track\.clientWidth \|\| 1/);
});

test("소식 슬라이드는 외부 링크임을 문구와 아이콘으로 함께 알린다", () => {
  // 링크 열기는 호출부(네이티브/웹 구분)가 하고, 컴포넌트는 슬라이드 id 를 함께 넘긴다.
  assert.match(component, /onOpenExternal\(url, slide\.id\)/);
  assert.match(component, /<ExternalLink size=\{14\}/);
  for (const id of ["parent.home.heroSlide.study.body", "parent.home.heroSlide.world.body"]) {
    const shared = JSON.parse(readFileSync(`${repoRoot}locales/ko/parent.json`, "utf8"));
    assert.ok(typeof shared[id] === "string" && shared[id].length > 0, `${id} 문구가 없습니다`);
  }
});
