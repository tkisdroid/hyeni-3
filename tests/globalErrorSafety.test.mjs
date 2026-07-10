// 조용한 에러 금지 안전망 3겹의 배선 회귀 가드.
// ①렌더 크래시 → RouteErrorScreen/RootErrorBoundary(흰 화면 금지)
// ②uncaught/unhandledrejection → 전역 폴백 토스트(잡음 필터 + 스로틀)
// ③onError 없는 mutation → 지연 폴백 토스트(화면 토스트가 이기면 자동 양보)
// 런타임 검증(2026-07-11, dev 서버 + CDP): crash-test 복구 화면 렌더,
// rejection→토스트, 스로틀 억제, AbortError 필터 4케이스 실측 통과.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isNoiseError, announceGlobalToast } from "../src/lib/globalToast.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(rootDir, p), "utf8");

test("라우터 전체가 errorElement 로 감싸이고 루트 바운더리가 이중 방어한다", () => {
  const app = read("src/app/App.tsx");
  assert.match(app, /errorElement: <RouteErrorScreen \/>/);
  assert.match(app, /<RootErrorBoundary>\s*<RouterProvider router=\{router\} \/>\s*<\/RootErrorBoundary>/);
  assert.match(app, /<GlobalErrorListeners \/>/);
  // 크래시 프로브는 DEV 전용 — 프로덕션 번들에 크래시 트리거를 싣지 않는다.
  assert.match(app, /import\.meta\.env\.DEV \? \[\{ path: "crash-test"/);

  const boundary = read("src/app/ErrorBoundary.tsx");
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /useRouteError/);
  assert.match(boundary, /hy-crash/);

  const css = read("src/styles/components.css");
  assert.match(css, /\.hy-crash \{/);
  assert.match(css, /\.hy-crash,\s*\n\s*\.hy-crash__img \{\s*\n\s*animation: none/);
});

test("ToastProvider 는 전역 토스트 이벤트를 구독하고 표시 시각을 기록한다", () => {
  const toast = read("src/app/toast.tsx");
  assert.match(toast, /GLOBAL_TOAST_EVENT/);
  assert.match(toast, /markToastShown\(\)/);
});

test("mutation 전역 폴백 — onError 있는 화면은 건너뛰고, silentError 로 옵트아웃한다", () => {
  const qp = read("src/queries/QueryProvider.tsx");
  assert.match(qp, /new MutationCache\(/);
  assert.match(qp, /if \(mutation\.options\.onError\) return;/);
  assert.match(qp, /meta\?\.silentError === true\) return;/);
  assert.match(qp, /announceFallbackToast\(/);
  assert.match(qp, /mutationCache,/);
});

test("isNoiseError — 사용자에게 보여줄 가치가 없는 잡음만 거른다", () => {
  assert.equal(isNoiseError(Object.assign(new Error("x"), { name: "AbortError" })), true);
  assert.equal(isNoiseError(new Error("ResizeObserver loop completed with undelivered notifications.")), true);
  assert.equal(isNoiseError(new Error("The user aborted a request.")), true);
  assert.equal(isNoiseError("Script error."), true);
  assert.equal(isNoiseError(null), true);
  assert.equal(isNoiseError(new Error("network down")), false);
  assert.equal(isNoiseError(new Error("저장 실패")), false);
});

test("announceGlobalToast 는 window 없는 환경(SSR/테스트)에서 조용히 실패한다", () => {
  assert.equal(announceGlobalToast("x"), false);
});

test("온보딩 역할 카드 3개는 같은 cover 확대를 쓴다(아이만 작아 보이던 회귀 금지)", () => {
  const css = read("src/screens/onboarding/Onboarding.css");
  const child = /\.ob-role-img--child \{[^}]*\}/s.exec(css)?.[0] ?? "";
  assert.match(child, /width: 76px/);
  assert.match(child, /object-fit: cover/);
  assert.doesNotMatch(child, /contain/);
});
