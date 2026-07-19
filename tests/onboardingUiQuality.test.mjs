import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} CSS 블록을 찾지 못했습니다`);
  return match[1];
}

test("역할 선택 약관 링크는 문장 안에서도 44px 터치 영역을 제공한다", () => {
  const css = source("src/screens/onboarding/Onboarding.css");
  const link = cssBlock(css, ".ob-role-terms a");

  assert.match(link, /display:\s*inline-flex\s*;/);
  assert.match(link, /align-items:\s*center\s*;/);
  assert.match(link, /min-height:\s*var\(--control-min-size\)\s*;/);
});

test("온보딩과 권한 안내의 작은 아이콘은 승인된 16px·24px 척도를 쓴다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const denied = source("src/screens/feature/PermDenied.tsx");

  assert.match(onboarding, /<Camera\s+size=\{16\}\s+strokeWidth=\{2\.4\}/);
  assert.doesNotMatch(onboarding, /<Camera\s+size=\{15\}/);
  assert.equal((denied.match(/size=\{24\}/g) ?? []).length, 4);
  assert.doesNotMatch(denied, /size=\{26\}/);
});

test("권한 예정 배지는 인라인 스타일 없이 caption 토큰 묶음을 쓴다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const css = source("src/screens/onboarding/Onboarding.css");
  const badge = cssBlock(css, ".ob-perm-check");
  const badgeTag = /<span\s+className="ob-perm-check"[^>]*>/s.exec(onboarding)?.[0] ?? "";

  assert.ok(badgeTag, "권한 예정 배지를 찾지 못했습니다");
  assert.doesNotMatch(badgeTag, /style=\{/);
  assert.match(badge, /font-size:\s*var\(--type-caption\)\s*;/);
  assert.match(badge, /line-height:\s*var\(--type-caption-line-height\)\s*;/);
  assert.match(badge, /font-weight:\s*var\(--type-caption-weight\)\s*;/);
  assert.match(badge, /background:\s*var\(--bg-page\)\s*;/);
  assert.match(badge, /color:\s*var\(--fg-muted\)\s*;/);
});
