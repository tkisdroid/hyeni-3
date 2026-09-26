import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const home = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
const redesignCss = readFileSync(new URL("../src/screens/parent/ParentHome.redesign.css", import.meta.url), "utf8");
const glassCss = readFileSync(new URL("../src/styles/glass.css", import.meta.url), "utf8");

test("부모 홈의 실데이터 주요 카드는 모두 같은 유리 재질을 쓴다", () => {
  const sectionClassNames = [...home.matchAll(/className="([^"]*\bph-section-shell\b[^"]*)"/g)]
    .map((match) => match[1]);

  assert.ok(sectionClassNames.length >= 7, "부모 홈 주요 섹션 표면을 찾지 못했습니다");
  for (const className of sectionClassNames) {
    assert.match(className, /\bph-glass\b/, `유리 재질이 빠진 부모 홈 섹션: ${className}`);
  }
});

test("큰 유리 섹션은 하나의 서리 유리판이고 안쪽에 또 판을 겹치지 않는다", () => {
  const sectionRule = redesignCss.match(/\.ph-page \.ph-section-shell,\s*[\s\S]*?\{([^}]*)\}/)?.[1] ?? "";
  const innerRule = redesignCss.match(/\.ph-page \.ph-inner-surface\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(sectionRule, /background:\s*var\(--ph-glass-fill\)/);
  // 경계는 테두리가 아니라 rim(안쪽 하이라이트)이 만든다 — 합성 그림자 토큰 하나로 선언한다.
  assert.match(sectionRule, /border:\s*0/);
  assert.match(sectionRule, /box-shadow:\s*var\(--ph-panel-shadow\)/);
  assert.match(sectionRule, /backdrop-filter:\s*var\(--ph-glass-blur\)/);
  assert.doesNotMatch(redesignCss, /\.ph-section-shell::(?:before|after)/);

  // ② 한 섹션은 한 장 — 안쪽 면은 채움도 그림자도 갖지 않는다.
  assert.match(innerRule, /border:\s*0/);
  assert.match(innerRule, /background:\s*transparent/);
  assert.match(innerRule, /box-shadow:\s*none/);
});

test("화면별 파일은 바닥·팔레트를 다시 그리지 않고 glass.css 오로라를 쓴다", () => {
  // 바닥 그라데이션(오로라)은 공용 언어에만 있어야 한다. 화면이 자기 바닥을 칠하면
  // 예전처럼 화면마다 다른 색 배경이 생겨 일관성이 깨진다.
  assert.doesNotMatch(redesignCss, /(?:linear|radial|conic)-gradient/);
  assert.match(glassCss, /\.hy-adult \.hy-screen \{[^}]*background-image:[^}]*radial-gradient/);
  assert.match(redesignCss, /\.ph-page::before\s*\{\s*content:\s*none;\s*\}/);
});
