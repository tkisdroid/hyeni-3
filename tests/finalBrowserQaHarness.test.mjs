import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BROWSER_QA_OUTPUT_DIR,
  BROWSER_QA_VIEWPORT,
  CHILD_BROWSER_QA_ROUTES,
  extractDistEntryAssets,
  PARENT_BROWSER_QA_ROUTES,
  resolveBrowserQaOutputDir,
} from "../scripts/final-browser-qa.mjs";

const source = readFileSync(new URL("../scripts/final-browser-qa.mjs", import.meta.url), "utf8");

test("최종 브라우저 QA는 production dist를 390x844 격리 프로필에서 검증한다", () => {
  assert.deepEqual(BROWSER_QA_VIEWPORT, { width: 390, height: 844 });
  assert.match(source, /dist\/index\.html/);
  assert.match(source, /--user-data-dir=/);
  assert.match(source, /Network\.setBypassServiceWorker/);
  assert.match(source, /Fetch\.enable/);
  assert.doesNotMatch(source, /hyeni-calendar\.pages\.dev|hyeni-calendar-api\.tkisdroid\.workers\.dev/);
  assert.doesNotMatch(source, /spawn\([^\n]*["']adb["']/i);
});

test("최종 브라우저 QA는 부모·아이 출시 화면과 핵심 전환 계약을 빠짐없이 고정한다", () => {
  assert.equal(PARENT_BROWSER_QA_ROUTES.length, 42);
  assert.equal(CHILD_BROWSER_QA_ROUTES.length, 14);
  assert.ok(PARENT_BROWSER_QA_ROUTES.includes("subscription"));
  assert.ok(PARENT_BROWSER_QA_ROUTES.includes("place-manager"));
  assert.ok(CHILD_BROWSER_QA_ROUTES.includes("child/home"));
  assert.match(source, /월 4,900원/);
  assert.match(source, /연 39,000원/);
  assert.match(source, /결제 시작을 잠시 닫았어요/);
  assert.match(source, /무료로 계속 쓰기/);
  assert.match(source, /AI 일정 정리/);
  assert.match(source, /ai_schedule_limit/);
  assert.match(source, /daily_limit_reached/);
  assert.match(source, /aiScheduleIntentFacts\.hash !== "#\/subscription"/);
  assert.match(source, /aiScheduleIntentFacts\.source !== "ai_schedule_limit"/);
  assert.match(source, /aiScheduleIntentFacts\.feature !== "ai_schedule_daily_limit"/);
  assert.match(source, /aiScheduleIntentFacts\.returnTo !== "\/ai-schedule\?tab=text"/);
  assert.match(source, /aiScheduleContinueScenario/);
  assert.match(source, /hyeni:premium-return-intent:v1/);
  assert.match(source, /저장됨 · 프리미엄에서 알림 대상/);
  assert.match(source, /혜니캘린더 v1\.3\.0/);
  assert.match(source, /parent\/location\?view=history/);
  assert.match(source, /parent-location-history-interaction/);
  assert.match(source, /locationHistoryAfterReplay\.followsLatest !== "false"/);
  assert.match(source, /locationHistoryLatest\.followsLatest !== "true"/);
  assert.match(source, /parent-home-shortcuts-free/);
  assert.match(source, /parent-home-shortcuts-premium/);
  assert.match(source, /아이 기기 찾기/);
  assert.match(source, /구독 시 혜택/);
  assert.match(source, /구독 관리/);
  assert.match(source, /history\.state\?\.usr\?\.childUserId/);
});

test("최종 브라우저 QA는 출시 품질 결함을 JSON과 스크린샷 증거로 남긴다", () => {
  assert.match(source, /Runtime\.consoleAPICalled/);
  assert.match(source, /Network\.loadingFailed/);
  assert.match(source, /brokenImages/);
  assert.match(source, /smallTargets/);
  assert.match(source, /overflowX/);
  assert.match(source, /Page\.captureScreenshot/);
  assert.match(source, /parent-location-history\.png/);
  assert.match(source, /buildFingerprint/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /report\.json/);
  assert.match(BROWSER_QA_OUTPUT_DIR.replaceAll("\\", "/"), /artifacts\/release-evidence\/browser-qa$/);
  assert.match(source, /prepareFreshQaOutputDir/);
  assert.match(
    resolveBrowserQaOutputDir(["--out-dir", "artifacts/release-evidence/browser-qa/ci-1"])
      .replaceAll("\\", "/"),
    /artifacts\/release-evidence\/browser-qa\/ci-1$/,
  );
});

test("최종 브라우저 QA는 Linux·macOS·Windows Chrome과 신호 기반 프로세스 트리 정리를 지원한다", () => {
  assert.match(source, /C:\/Program Files\/Google\/Chrome\/Application\/chrome\.exe/);
  assert.match(source, /\/Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome/);
  assert.match(source, /\/usr\/bin\/google-chrome/);
  assert.match(source, /C:\/Windows\/System32\/taskkill\.exe/);
  assert.match(source, /process\.kill\(-processHandle\.pid, signal\)/);
  assert.match(source, /detached:\s*process\.platform !== "win32"/);
  assert.match(source, /SIGINT/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /if \(interrupted\(\)\)/);
  assert.match(source, /QA_INTERRUPTED/);
});

test("최종 브라우저 QA는 상대·루트 경로 production 엔트리 자산을 fingerprint에 포함한다", () => {
  assert.deepEqual(
    extractDistEntryAssets([
      '<script type="module" src="./assets/index-app.js"></script>',
      '<link rel="stylesheet" href="/assets/index-style.css?version=1">',
      '<link rel="icon" href="./favicon.svg">',
    ].join("")),
    ["assets/index-app.js", "assets/index-style.css"],
  );
});
