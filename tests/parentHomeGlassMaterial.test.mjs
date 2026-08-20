import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const home = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/screens/parent/ParentHome.css", import.meta.url), "utf8");

test("부모 홈의 실데이터 주요 카드는 모두 같은 유리 재질을 쓴다", () => {
  const sectionClassNames = [...home.matchAll(/className="([^"]*\bph-section-shell\b[^"]*)"/g)]
    .map((match) => match[1]);

  assert.ok(sectionClassNames.length >= 7, "부모 홈 주요 섹션 표면을 찾지 못했습니다");
  for (const className of sectionClassNames) {
    assert.match(className, /\bph-glass\b/, `유리 재질이 빠진 부모 홈 섹션: ${className}`);
  }
});

test("큰 유리 섹션과 안쪽 정보 면은 한 단계 차이의 깊이를 유지한다", () => {
  const sectionRule = css.match(/\.ph-section-shell\s*\{([^}]*)\}/s)?.[1] ?? "";
  const innerRule = css.match(/\.ph-inner-surface\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(sectionRule, /background:\s*var\(--glass-fill\)/);
  assert.match(sectionRule, /var\(--glass-rim\)/);
  assert.match(sectionRule, /var\(--glass-lift\)/);
  assert.match(sectionRule, /backdrop-filter:\s*var\(--glass-blur\)/);
  assert.match(innerRule, /background:\s*var\(--glass-tile\)/);
  assert.match(innerRule, /box-shadow:\s*none/);
});
