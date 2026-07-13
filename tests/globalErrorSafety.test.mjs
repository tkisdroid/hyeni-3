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

test("친구놀이 하드 에러는 '친구 없음'으로 위장하지 않는다(razr Red 재현 2026-07-11)", async () => {
  const { playdateCandidateNotice } = await import("../src/transform/playdateNotice.ts");
  assert.equal(playdateCandidateNotice(undefined, true, true), "친구 목록을 불러오지 못했어. 다시 해볼래?");
  assert.equal(playdateCandidateNotice(undefined, true, false), "근처에 놀 수 있는 친구가 아직 없어. 조금 있다 다시 볼까?");
  assert.equal(playdateCandidateNotice("forbidden", true, false), "지금은 친구를 찾을 수 없어.");
  // 하드 에러가 soft error 보다 우선(soft 는 200 응답이라 동시에 오지 않지만 방어)
  assert.equal(playdateCandidateNotice("forbidden", true, true), "친구 목록을 불러오지 못했어. 다시 해볼래?");

  const sheet = readFileSync(new URL("../src/screens/child/overlays/PlaydateSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /candidatesQuery\.isError/);
  assert.match(sheet, /다시 찾기/);
  const fp = readFileSync(new URL("../src/screens/feature/FriendPlay.tsx", import.meta.url), "utf8");
  assert.match(fp, /candidatesQ\.isError/);
});

test("외부 열기·전화 콜사이트는 실패 피드백을 가진다(void 방치 금지)", () => {
  const sites = [
    // 사진은 JWT를 외부 브라우저에 넘기지 않고 앱 내부 dialog로 열므로 위치 링크 1건만 남는다.
    ["src/screens/shared/MemoChat.tsx", /openExternal\([^;]*\)\.catch/s, 1],
    ["src/screens/feature/RouteView.tsx", /openExternal\([^;]*\)\.catch/s, 1],
    ["src/screens/teacher/TeacherSettings.tsx", /openExternal\(PRIVACY_POLICY_URL\)\.catch/, 1],
    ["src/screens/feature/AppUpdate.tsx", /openExternal\(STORE_URL\)\.catch/, 1],
  ];
  for (const [file, re, min] of sites) {
    const src = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const n = (src.match(new RegExp(re.source, re.flags + (re.flags.includes("g") ? "" : "g"))) || []).length;
    assert.ok(n >= min, `${file}: openExternal .catch ${n} < ${min}`);
    assert.doesNotMatch(src, /void openExternal\(/);
  }
  for (const file of [
    "src/screens/child/ChildHome.tsx", "src/screens/child/ChildSos.tsx",
    "src/screens/feature/SosReceive.tsx", "src/screens/feature/RemoteAudio.tsx",
    "src/screens/parent/ParentLocation.tsx",
  ]) {
    const src = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.match(src, /placePhoneCall\([^)]*\)\.then\(\(r\) => \{\s*\n\s*if \(!r\.ok\)/, file);
  }
});

test("잠금해제 횟수 라벨 — 숫자만 N회, 미보고·잘못된 값은 0회 —", async () => {
  const { unlockCountLabel } = await import("../src/transform/deviceUnlock.ts");
  assert.equal(unlockCountLabel(6), "6회");
  assert.equal(unlockCountLabel(0), "0회");
  assert.equal(unlockCountLabel(null), "0회");
  assert.equal(unlockCountLabel(undefined), "0회");
  assert.equal(unlockCountLabel(-1), "0회");
  assert.equal(unlockCountLabel(NaN), "0회");
});
