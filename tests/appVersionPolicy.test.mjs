import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  compareAppVersions,
  forcedUpdateHash,
  resolveAppUpdateDecision,
  shouldEnforceForcedUpdate,
  shouldReleaseForcedUpdate,
} = await import(
  "../src/transform/appVersionPolicy.ts"
);

test("버전 비교는 숫자 구성요소를 기준으로 처리한다", () => {
  assert.equal(compareAppVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareAppVersions("1.10.0", "1.2.9"), 1);
  assert.equal(compareAppVersions("2.0", "2.0.1"), -1);
});

// 업데이트가 나왔다는 이유만으로 앱을 잠그면 위치·SOS까지 함께 막힌다. 차단은
// 운영자가 blockingUpdate로 명시할 때만 한다(2026-08-04 보호자 결정).
test("최소 지원 버전보다 낮아도 기본은 기존 버전을 계속 쓸 수 있다", () => {
  assert.deepEqual(
    resolveAppUpdateDecision("1.2.0", { minimumSupportedVersion: "1.3.0", latestVersion: "1.4.0" }),
    { kind: "optional", targetVersion: "1.4.0" },
  );
  assert.deepEqual(
    resolveAppUpdateDecision("1.2.0", {
      minimumSupportedVersion: "1.3.0",
      latestVersion: "1.4.0",
      blockingUpdate: false,
    }),
    { kind: "optional", targetVersion: "1.4.0" },
  );
});

test("운영자가 blockingUpdate를 켠 경우에만 강제 업데이트로 판정한다", () => {
  assert.deepEqual(
    resolveAppUpdateDecision("1.2.0", {
      minimumSupportedVersion: "1.3.0",
      latestVersion: "1.4.0",
      blockingUpdate: true,
    }),
    { kind: "forced", targetVersion: "1.4.0" },
  );
  // 차단을 켜도 지원 범위 안이면 권장에 머문다.
  assert.deepEqual(
    resolveAppUpdateDecision("1.3.0", {
      minimumSupportedVersion: "1.3.0",
      latestVersion: "1.4.0",
      blockingUpdate: true,
    }),
    { kind: "optional", targetVersion: "1.4.0" },
  );
});

test("최신 버전보다 낮지만 지원 범위면 권장 업데이트로 판정한다", () => {
  assert.deepEqual(
    resolveAppUpdateDecision("1.3.0", { minimumSupportedVersion: "1.2.0", latestVersion: "1.4.0" }),
    { kind: "optional", targetVersion: "1.4.0" },
  );
});

test("현재 버전이 최신이거나 정책 값이 유효하지 않으면 진입하지 않는다", () => {
  assert.equal(
    resolveAppUpdateDecision("1.4.0", { minimumSupportedVersion: "1.2.0", latestVersion: "1.4.0" }),
    null,
  );
  assert.equal(
    resolveAppUpdateDecision("1.4.0", { minimumSupportedVersion: "invalid", latestVersion: "1.5.0" }),
    null,
  );
  assert.equal(
    resolveAppUpdateDecision("1.4.0", { minimumSupportedVersion: "1.5.0", latestVersion: "1.4.0" }),
    null,
  );
});

test("Android 부팅 게이트는 원격 정책을 읽어 업데이트 화면으로 자동 진입한다", () => {
  const gate = readFileSync(new URL("../src/app/AppVersionGate.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");

  assert.match(gate, /isNativePlatform\(\)/);
  assert.match(gate, /fetch\(APP_VERSION_POLICY_URL/);
  assert.match(gate, /cache:\s*"no-store"/);
  assert.match(gate, /resolveAppUpdateDecision\(APP_VERSION/);
  assert.match(gate, /forcedUpdateHash\(targetVersion\)/);
  assert.match(app, /<AppVersionGate\s*\/>/);
});

test("업데이트 화면은 자동 진입이 전달한 forced 쿼리를 실제로 집행한다", () => {
  const screen = readFileSync(new URL("../src/screens/feature/AppUpdate.tsx", import.meta.url), "utf8");
  assert.match(screen, /useLocation\(\)/);
  assert.match(screen, /new URLSearchParams\(search\)/);
  assert.match(screen, /get\("forced"\) === "1"/);
  assert.doesNotMatch(screen, /const forced = false/);
});

test("강제 업데이트 결정은 뒤로가기·딥링크 뒤에도 같은 화면을 재고정한다", () => {
  const expected = "#/app-update?forced=1&target=2.0.0";
  assert.equal(forcedUpdateHash("2.0.0"), expected);
  assert.equal(shouldEnforceForcedUpdate("#/parent/home", "2.0.0"), true);
  assert.equal(shouldEnforceForcedUpdate("#/child/home", "2.0.0"), true);
  assert.equal(shouldEnforceForcedUpdate(expected, "2.0.0"), false);

  const gate = readFileSync(new URL("../src/app/AppVersionGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /addEventListener\("hashchange"/);
  assert.match(gate, /removeEventListener\("hashchange"/);
  assert.match(gate, /shouldEnforceForcedUpdate\(window\.location\.hash/);
  assert.match(gate, /useLocation\(\)/);
  assert.match(gate, /location\.key/);
  assert.doesNotMatch(gate, /window\.location\.hash\.startsWith\("#\/app-update"\)\) return/);
});

test("캐시된 강제 정책이 최신 정상 정책으로 풀리면 잠금 화면도 함께 해제한다", () => {
  const forcedHash = forcedUpdateHash("2.0.0");
  assert.equal(shouldReleaseForcedUpdate(forcedHash, null), true);
  assert.equal(
    shouldReleaseForcedUpdate(forcedHash, { kind: "optional", targetVersion: "1.3.0" }),
    true,
  );
  assert.equal(
    shouldReleaseForcedUpdate(forcedHash, { kind: "forced", targetVersion: "2.1.0" }),
    false,
  );

  const gate = readFileSync(new URL("../src/app/AppVersionGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /shouldReleaseForcedUpdate\(window\.location\.hash, decision\)/);
  assert.match(
    gate,
    /if \(releaseForcedScreen\) leaveStaleForcedScreen\(\);\s*rememberOptionalPrompt/,
  );
  assert.match(gate, /#\//);
});

test("살아 있는 Android 앱도 foreground 복귀 때 최소 버전 정책을 다시 확인한다", () => {
  const gate = readFileSync(new URL("../src/app/AppVersionGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /App\.addListener\("appStateChange"/);
  assert.match(gate, /next\.isActive/);
  assert.match(gate, /refreshPolicy\(\)/);
  assert.match(gate, /VERSION_CHECK_MIN_INTERVAL_MS/);
});

test("화면 렌더 오류가 나도 앱 버전 게이트는 상위 route에서 계속 유지된다", () => {
  const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /element:\s*<AppRouteServices\s*\/>\s*,\s*children:\s*\[\s*\{\s*errorElement:\s*<RouteErrorScreen\s*\/>/,
  );
  assert.doesNotMatch(
    app,
    /element:\s*<AppRouteServices\s*\/>\s*,\s*errorElement:/,
  );
});

test("배포되는 정책 파일은 구버전 사용을 차단하지 않는다", async () => {
  const { readFile } = await import("node:fs/promises");
  const policy = JSON.parse(
    await readFile(new URL("../public/app-version.json", import.meta.url), "utf8"),
  );
  assert.equal(policy.blockingUpdate, false, "기본 배포 정책은 앱을 잠그지 않는다");
});

test("업데이트 화면은 차단이 아닐 때 계속 사용할 수 있다고 알리고 나중에를 제공한다", async () => {
  const { readFile } = await import("node:fs/promises");
  const screen = await readFile(
    new URL("../src/screens/feature/AppUpdate.tsx", import.meta.url),
    "utf8",
  );
  const koCore = JSON.parse(readFileSync(new URL("../locales/ko/core.json", import.meta.url), "utf8"));
  assert.match(screen, /core\.appUpdate\.optional\.formal/);
  assert.match(screen, /core\.appUpdate\.optional\.child/);
  assert.equal(koCore["core.appUpdate.optional.formal"], "지금 하지 않아도 계속 사용할 수 있어요.");
  assert.equal(koCore["core.appUpdate.optional.child"], "지금 하지 않아도 계속 쓸 수 있어.");
  assert.match(screen, /\{!forced && \(/);
});
