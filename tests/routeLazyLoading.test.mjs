import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

test("사용자 화면은 정적 import 대신 named export 지연 로더를 쓴다", () => {
  const app = read("src/app/App.tsx");
  const staticScreenImports = [...app.matchAll(/import\s+\{[^}]+\}\s+from\s+"(@\/screens\/[^"]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path !== "@/screens/Splash");
  const lazyImports = [...app.matchAll(/lazyScreen\(\(\) => import\("@\/screens\/[^"]+"\),\s*"[^"]+"\)/g)];

  assert.deepEqual(staticScreenImports, []);
  assert.ok(lazyImports.length >= 50, `지연 로드 화면이 부족함: ${lazyImports.length}`);
  assert.match(app, /import \{ lazyScreen \} from "\.\/lazyScreen"/);
});

test("named export 화면 로더는 React.lazy의 default 모듈 계약으로 변환한다", () => {
  const helper = read("src/app/lazyScreen.tsx");
  assert.match(helper, /export function lazyScreen/);
  assert.match(helper, /lazy\(async \(\) =>/);
  assert.match(helper, /default:\s*loaded\[exportName\]/);
});

test("각 지연 화면은 공통 Suspense 전환 상태 안에서 렌더된다", () => {
  const app = read("src/app/App.tsx");
  const screenNames = [...app.matchAll(/const\s+(\w+)\s*=\s*lazyScreen\(/g)].map((match) => match[1]);

  assert.match(app, /<Suspense fallback=\{<RouteLoading \/>\}>/);
  for (const name of screenNames) {
    assert.match(app, new RegExp(`routeElement\\(<${name} \\/>\\)`), `${name} Suspense 경계 누락`);
  }
});

test("공통 라우트 로더는 안정된 높이·상태 안내·모션 축소를 제공한다", () => {
  const component = read("src/components/ui/RouteLoading.tsx");
  const css = read("src/components/ui/RouteLoading.css");

  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /화면을 불러오는 중/);
  assert.match(css, /\.route-loading\s*\{[^}]*min-height:\s*(?:var\([^;]+\)|\d+px)/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation:\s*none/);
});
