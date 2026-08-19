import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const home = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/screens/parent/ParentHome.css", import.meta.url), "utf8");

test("부모 홈의 실데이터 주요 카드는 모두 같은 유리 재질을 쓴다", () => {
  const cardClassNames = [...home.matchAll(/className=(?:"([^"]*\bhy-card\b[^"]*)"|\{`([^`]*\bhy-card\b[^`]*)`\})/g)]
    .map((match) => match[1] ?? match[2]);

  assert.ok(cardClassNames.length >= 8, "부모 홈 주요 카드 표면을 찾지 못했습니다");
  for (const className of cardClassNames) {
    assert.match(className, /\bph-glass\b/, `유리 재질이 빠진 부모 홈 카드: ${className}`);
  }
});

test("AI와 활성 아이 카드가 공통 유리 깊이를 유지한다", () => {
  const aiRule = css.match(/\.ph-ai\s*\{([^}]*)\}/s)?.[1] ?? "";
  const activeChildRule = css.match(/\.ph-child--active\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(aiRule, /var\(--glass-rim\)/);
  assert.match(aiRule, /var\(--glass-lift\)/);
  assert.match(activeChildRule, /var\(--glass-rim\)/);
  assert.match(activeChildRule, /var\(--glass-lift\)/);
});
