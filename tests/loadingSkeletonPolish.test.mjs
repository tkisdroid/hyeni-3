import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

test("공용 스켈레톤은 장식 전용이고 reduced motion에서 멈춘다", () => {  const css = read("src/styles/components.css");
  assert.match(css, /\.hy-skel\s*\{[^}]*background: var\(--bg-page\)/s);
  assert.match(css, /\.hy-skel::after\s*\{[^}]*animation: km-shimmer/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hy-skel::after\s*\{\s*animation: none/s);
});

test("부모 홈 일정 목록 로딩은 스켈레톤으로 자리를 잡고 상태를 읽어준다", () => {
  const home = read("src/screens/parent/ParentHome.tsx");
  const homeCss = read("src/screens/parent/ParentHome.css");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.match(home, /className="ph-sched-skel" role="status" aria-label=\{intl\.formatMessage\(\{ id: "parent\.parentHome\.copy020" \}\)\}/);
  assert.equal(koParent["parent.parentHome.copy020"], "일정을 불러오는 중");
  assert.match(home, /className="hy-skel hy-skel--avatar" aria-hidden="true"/);
  // 실제 행과 같은 여백이라 로딩→완료 전환에서 레이아웃이 튀지 않는다.
  assert.match(homeCss, /\.ph-sched-skel\s*\{[^}]*padding: 12px/s);
  assert.match(homeCss, /\.ph-sched-skel\s*\{[^}]*gap: 12px/s);
});
