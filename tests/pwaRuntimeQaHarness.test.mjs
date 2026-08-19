import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  extractPwaEntryAssets,
  fingerprintDirectory,
  isAllowedQaRequest,
  isExpectedOfflineLoadingFailure,
  PWA_RUNTIME_QA_OFFLINE_PROBE_PATH,
  PWA_RUNTIME_QA_OUTPUT_DIR,
  PWA_RUNTIME_QA_ROUTE,
  PWA_RUNTIME_QA_ROUTE_SELECTOR,
  PWA_RUNTIME_QA_UPDATE_VERSION,
  PWA_RUNTIME_QA_VIEWPORT,
  resolvePwaRuntimeQaOutputDir,
} from "../scripts/pwa-runtime-qa.mjs";

const source = readFileSync(new URL("../scripts/pwa-runtime-qa.mjs", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../src/sw.ts", import.meta.url), "utf8");

test("PWA 런타임 QA는 exact production dist와 중요 작업 보호형 업데이트 계약을 사용한다", () => {
  assert.deepEqual(PWA_RUNTIME_QA_VIEWPORT, { width: 390, height: 844 });
  assert.equal(PWA_RUNTIME_QA_ROUTE, "/app-update");
  assert.equal(PWA_RUNTIME_QA_ROUTE_SELECTOR, ".au-root");
  assert.match(source, /const DIST_DIR = resolve\(ROOT_DIR, "dist"\)/);
  assert.match(source, /const DIST_INDEX = resolve\(DIST_DIR, "index\.html"\)/);
  assert.match(source, /const DIST_SW = resolve\(DIST_DIR, "sw\.js"\)/);
  assert.match(viteConfig, /registerType:\s*"prompt"/);
  assert.match(viteConfig, /strategies:\s*"injectManifest"/);
  assert.match(mainSource, /const nativePlatform = isNativePlatform\(\)/);
  assert.match(mainSource, /const serviceWorkerContainer = nativePlatform \? null : browserServiceWorkerContainer/);
  assert.match(mainSource, /nativePlatform && browserServiceWorkerContainer/);
  assert.match(mainSource, /getRegistrations\(\)/);
  assert.match(mainSource, /registration\.unregister\(\)/);
  assert.match(mainSource, /if \(serviceWorkerContainer\) \{[\s\S]*registerSW\(\{/);
  assert.match(mainSource, /registerSW\(\{/);
  assert.match(mainSource, /immediate:\s*true/);
  assert.match(mainSource, /onNeedRefresh/);
  assert.match(mainSource, /onNeedReload/);
  assert.match(mainSource, /queuePwaUpdateAction\("activate"/);
  assert.match(mainSource, /queuePwaUpdateAction\("reload"/);
  assert.match(mainSource, /observePwaControllerChanges/);
  assert.match(mainSource, /activatePwaUpdateAndWaitForControllerChange/);
  assert.match(mainSource, /registration\?\.waiting/);
  assert.match(mainSource, /pwaUpdateCoordinatorState\(\)\.criticalSectionCount/);
  assert.match(serviceWorkerSource, /type\s*===\s*"SKIP_WAITING"/);
  assert.match(serviceWorkerSource, /event\.waitUntil\(self\.skipWaiting\(\)\)/);
  assert.doesNotMatch(
    serviceWorkerSource.split('self.addEventListener("message"')[0],
    /self\.skipWaiting\(\)/,
  );
  assert.match(serviceWorkerSource, /self\.clients\.claim\(\)/);
  assert.match(source, /sourceBeforeCopyTreeSha256/);
  assert.match(source, /sourceAfterCopyTreeSha256/);
  assert.match(source, /sourceStableDuringCopy/);
  assert.match(source, /snapshotMatchesSource/);
  assert.match(source, /entryAssetFingerprints/);
});

test("PWA 런타임 QA는 Service Worker 우회 없이 install·offline route·controller를 검증한다", () => {
  assert.match(source, /Network\.setBypassServiceWorker",\s*\{\s*bypass:\s*false\s*\}/);
  assert.doesNotMatch(source, /bypass:\s*true/);
  assert.match(source, /Network\.setCacheDisabled/);
  assert.match(source, /setNetworkOfflineState\(cdp, true\)/);
  assert.match(source, /Network\.overrideNetworkState/);
  assert.match(source, /Page\.reload",\s*\{\s*ignoreCache:\s*true\s*\}/);
  assert.match(source, /networkEmulationOffline:\s*true/);
  assert.equal(PWA_RUNTIME_QA_OFFLINE_PROBE_PATH, "/__pwa-runtime-qa-offline-probe__.txt");
  assert.match(source, /runOfflineNetworkProbe\(cdp, origin\)/);
  assert.match(source, /navigatorOnlineAdvisory === false/);
  assert.match(source, /if \(!offlineNetworkProbe\.rejected\)/);
  assert.match(source, /activeState === "activated"/);
  assert.match(source, /controllerState === "activated"/);
  assert.match(source, /PWA_RUNTIME_QA_ROUTE_SELECTOR/);
  assert.match(source, /offlineServerRequests\.length > 0/);
});

test("PWA 런타임 QA는 의도적으로 precache에서 뺀 Jua 폰트의 오프라인 실패만 예외로 분류한다", () => {
  const origin = "http://127.0.0.1:43123";
  const offlineError = "net::ERR_INTERNET_DISCONNECTED";
  assert.equal(isExpectedOfflineLoadingFailure({
    phase: "offline",
    error: offlineError,
    url: `${origin}/fonts/jua/co3KmW9ljjATdOrY.woff2`,
  }, origin), true);
  assert.equal(isExpectedOfflineLoadingFailure({
    phase: "offline",
    error: offlineError,
    url: `${origin}${PWA_RUNTIME_QA_OFFLINE_PROBE_PATH}`,
  }, origin), true);
  assert.equal(isExpectedOfflineLoadingFailure({
    phase: "offline",
    error: offlineError,
    url: `${origin}/assets/index.js`,
  }, origin), false);
  assert.equal(isExpectedOfflineLoadingFailure({
    phase: "online",
    error: offlineError,
    url: `${origin}/fonts/jua/co3KmW9ljjATdOrY.woff2`,
  }, origin), false);
  assert.equal(isExpectedOfflineLoadingFailure({
    phase: "offline",
    error: offlineError,
    url: "https://example.com/fonts/jua/co3KmW9ljjATdOrY.woff2",
  }, origin), false);
});

test("PWA 런타임 QA는 임시 sw.js 업데이트와 실제 controllerchange·안전 자동 reload를 증명한다", () => {
  assert.equal(PWA_RUNTIME_QA_UPDATE_VERSION, "pwa-runtime-qa-v2");
  assert.match(source, /cp\(DIST_DIR, tempDist, \{ recursive: true \}\)/);
  assert.match(source, /updateServiceWorkerFixture\(tempSwPath\)/);
  assert.match(source, /navigator\.serviceWorker\.getRegistration\(\)/);
  assert.match(source, /registration\.update\(\)/);
  assert.match(source, /controllerchange/);
  assert.match(source, /controllerChanges > beforeUpdateInstrumentation\.controllerChanges/);
  assert.match(source, /documentLoads > beforeUpdateInstrumentation\.documentLoads/);
  assert.match(source, /HYENI_PWA_RUNTIME_QA_VERSION/);
  assert.match(source, /controlledVersion !== PWA_RUNTIME_QA_UPDATE_VERSION/);
  assert.doesNotMatch(source, /writeFile\(DIST_SW/);
});

test("PWA 런타임 QA는 localhost 외 통신과 사용자 브라우저 상태를 차단한다", () => {
  const origin = "http://127.0.0.1:43123";
  assert.equal(isAllowedQaRequest(`${origin}/index.html`, origin), true);
  assert.equal(isAllowedQaRequest("data:text/plain,ok", origin), true);
  assert.equal(isAllowedQaRequest("blob:https://example.com/id", origin), true);
  assert.equal(isAllowedQaRequest("about:blank", origin), true);
  assert.equal(isAllowedQaRequest("https://example.com/api", origin), false);
  assert.equal(isAllowedQaRequest("http://203.0.113.1/api", origin), false);
  assert.equal(isAllowedQaRequest("ws://203.0.113.1/socket", origin), false);
  assert.equal(isAllowedQaRequest("wss://example.com/socket", origin), false);
  assert.equal(isAllowedQaRequest("file:///C:/private.txt", origin), false);
  assert.equal(isAllowedQaRequest("not a url", origin), false);
  assert.match(source, /--user-data-dir=/);
  assert.match(source, /--remote-debugging-port=0/);
  assert.match(source, /DevToolsActivePort/);
  assert.match(source, /--host-resolver-rules=MAP \* ~NOTFOUND/);
  assert.match(source, /--proxy-server=http:\/\/127\.0\.0\.1:/);
  assert.match(source, /--proxy-bypass-list=127\.0\.0\.1;localhost/);
  assert.match(source, /--disable-quic/);
  assert.match(source, /disable_non_proxied_udp/);
  assert.match(source, /Target\.setAutoAttach/);
  assert.match(source, /type: "service_worker"/);
  assert.match(source, /serviceWorkerTargetObserved/);
  assert.match(source, /Network\.enable", \{\}, 20_000, sessionId/);
  assert.match(source, /\{ env: \{\}, shell: false, stdio: "ignore", windowsHide: true \}/);
  assert.match(source, /Fetch\.failRequest/);
  assert.match(source, /BlockedByClient/);
  assert.match(source, /externalNetwork:\s*false/);
  // 앱 이름 등 한국어 정본 문구를 검사하므로 표시 언어를 고정한다.
  // 고정하지 않으면 Linux CI(en-US)에서 영어 화면을 한국어로 검사해 항상 실패한다(2026-08-19 실사고).
  assert.match(source, /"--lang=ko-KR"/);
  // navigator.languages 는 --lang 이 아니라 --accept-lang 이 정한다.
  // 이걸 빼면 Linux CI 에서 여전히 영어로 렌더된다(2026-08-19 실측).
  assert.match(source, /"--accept-lang=ko-KR,ko"/);
  assert.doesNotMatch(source, /process\.env|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /hyeni-calendar\.pages\.dev|workers\.dev|wrangler|\badb\b/i);
});

test("PWA 런타임 QA는 Windows 프로세스 트리·서버·임시 프로필을 항상 정리한다", () => {
  assert.match(source, /C:\/Windows\/System32\/taskkill\.exe/);
  assert.match(source, /\["\/PID", String\(processHandle\.pid\), "\/T", "\/F"\]/);
  assert.match(source, /shell:\s*false/);
  assert.match(source, /windowsHide:\s*true/);
  assert.match(source, /server\.closeIdleConnections/);
  assert.match(source, /server\.closeAllConnections/);
  assert.match(source, /SIGINT/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /rm\(tempRoot, \{ recursive: true, force: true/);
  assert.match(source, /browserProcessExited/);
  assert.match(source, /localhostServerClosed/);
  assert.match(source, /temporaryDistRemoved/);
  assert.match(source, /temporaryProfileRemoved/);
  assert.match(source, /denyProxyClosed/);
});

test("PWA 런타임 QA는 실패 단계에서도 수집한 관측값을 JSON에 보존한다", () => {
  const finallyOffset = source.lastIndexOf("} finally {");
  assert.ok(finallyOffset > 0);
  assert.ok(source.indexOf("report.console = uniqueRows", finallyOffset) > finallyOffset);
  assert.ok(source.indexOf("report.network.externalRequests = uniqueRows", finallyOffset) > finallyOffset);
  assert.ok(source.indexOf("report.server.requestCount", finallyOffset) > finallyOffset);
  assert.ok(source.indexOf("report.network.browserDenyProxy", finallyOffset) > finallyOffset);
});

test("PWA 런타임 QA는 추적 가능한 JSON 증거만 ignored artifacts 경로에 남긴다", () => {
  assert.match(PWA_RUNTIME_QA_OUTPUT_DIR.replaceAll("\\", "/"), /artifacts\/release-evidence\/pwa-runtime-qa$/);
  assert.match(source, /prepareFreshQaOutputDir/);
  assert.match(
    resolvePwaRuntimeQaOutputDir(["--out-dir", "artifacts/release-evidence/pwa-runtime-qa/ci-1"])
      .replaceAll("\\", "/"),
    /artifacts\/release-evidence\/pwa-runtime-qa\/ci-1$/,
  );
  assert.match(source, /local-exact-production-dist-pwa-runtime-isolated/);
  assert.match(source, /buildFingerprint/);
  assert.match(source, /serviceWorkerSha256/);
  assert.match(source, /operationalAccess/);
  assert.match(source, /report\.json/);
});

test("PWA entry fingerprint는 상대·루트 JS/CSS만 중복 없이 추출한다", () => {
  assert.deepEqual(
    extractPwaEntryAssets([
      '<script type="module" src="./assets/index-app.js"></script>',
      '<link rel="stylesheet" href="/assets/index-style.css?version=1">',
      '<script src="./assets/index-app.js"></script>',
      '<link rel="manifest" href="./manifest.webmanifest">',
    ].join("")),
    ["assets/index-app.js", "assets/index-style.css"],
  );
});

test("dist tree fingerprint는 모든 파일 바이트와 상대 경로 변경을 감지한다", async (context) => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "hyeni-pwa-fingerprint-test-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(resolve(fixtureRoot, "assets"));
  await writeFile(resolve(fixtureRoot, "index.html"), "index-v1", "utf8");
  await writeFile(resolve(fixtureRoot, "assets/app.js"), "app-v1", "utf8");

  const before = await fingerprintDirectory(fixtureRoot);
  await writeFile(resolve(fixtureRoot, "assets/app.js"), "app-v2", "utf8");
  const after = await fingerprintDirectory(fixtureRoot);

  assert.equal(before.fileCount, 2);
  assert.deepEqual(before.files.map((file) => file.path), ["assets/app.js", "index.html"]);
  assert.notEqual(before.treeSha256, after.treeSha256);
});
