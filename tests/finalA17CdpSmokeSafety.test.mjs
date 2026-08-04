import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../scripts/final-a17-cdp-smoke.mjs", import.meta.url),
  "utf8",
);

const redactionStart = source.indexOf("const UUID_VALUE_PATTERN");
const redactionEnd = source.indexOf('socket.addEventListener("message"');
assert.ok(redactionStart >= 0 && redactionEnd > redactionStart, "CDP 마스킹 함수 범위가 필요합니다");
const redactionContext = { URL };
runInNewContext(
  `${source.slice(redactionStart, redactionEnd)}; globalThis.__redaction = { safeMessage, safeNetworkPath };`,
  redactionContext,
);
const { safeMessage, safeNetworkPath } = redactionContext.__redaction;

test("A17 CDP 최종 점검은 refresh 필드·값을 반환·출력·회전하지 않는다", () => {
  assert.match(source, /localStorage\.getItem\("hyeni-api-session-v1"\)/);
  assert.match(source, /const accessToken = session\?\.access/);
  assert.doesNotMatch(source, /session\?\.(?:refresh|refresh_token)/);
  assert.doesNotMatch(source, /refresh\s*:/);
  assert.doesNotMatch(source, /rotate|\/refresh/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:accessToken|raw|localFamilyId)/);
  assert.match(source, /familyMineStatus/);
  assert.match(source, /familyMatches/);
  assert.match(source, /const serverRole = body\?\.myRole === "parent" \|\| body\?\.myRole === "child"/);
  assert.match(source, /sessionCheck\?\.serverRole !== expectedRole/);
  assert.match(source, /!sessionCheck\?\.roleMatches/);
});

test("CDP 오류와 네트워크 경로는 사용자 식별자·연락처·민감 경로 값을 출력하지 않는다", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const email = "parent@example.com";
  const phone = "010-1234-5678";
  const message = safeMessage(`family=${uuid} email=${email} phone=${phone}`);
  assert.doesNotMatch(message, new RegExp(uuid));
  assert.doesNotMatch(message, new RegExp(email.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(message, /010-1234-5678/);
  assert.match(message, /\[UUID 숨김\]/);
  assert.match(message, /\[이메일 숨김\]/);
  assert.match(message, /\[전화번호 숨김\]/);

  const sensitivePath = safeNetworkPath(
    `https://api.example.com/api/memos/replies/${uuid}/report?token=secret`,
  );
  assert.equal(sensitivePath, "https://api.example.com/api/memos/replies/[경로 식별자 숨김]/report");
  assert.equal(
    safeNetworkPath("https://api.example.com/api/premium-funnel/events?family_id=secret"),
    "https://api.example.com/api/premium-funnel/events",
  );
  assert.equal(
    safeNetworkPath("https://api.example.com/api/users/opaqueUser1234567890"),
    "https://api.example.com/api/users/[경로 식별자 숨김]",
  );
});

test("A17 CDP 최종 점검은 부모 주요 화면과 지도 실패를 모두 게이트한다", () => {
  for (const route of [
    "#/parent/home",
    "#/parent/calendar",
    "#/parent/location",
    "#/parent/location?view=history",
    "#/parent/memo",
    "#/notifications",
    "#/notification-settings",
    "#/subscription",
    "#/parent/settings",
  ]) {
    assert.match(source, new RegExp(route.replace(/[?]/g, "\\?")));
  }
  assert.match(source, /지도를 불러오지 못했어요/);
  assert.match(source, /mapReady/);
  assert.match(source, /horizontalOverflowPx/);
  assert.match(source, /newConsoleOrRuntimeErrors/);
  assert.match(source, /requiredPhrases: \["플랜 비교", "무료", "프리미엄", "SOS · 긴급 알림"\]/);
});

test("CDP 핵심 화면 범위는 명시적으로만 구독을 분리하고 전체 검증이 기본값이다", () => {
  assert.match(source, /process\.env\.ROUTE_SCOPE \?\? "all"/);
  assert.match(source, /routeScope !== "all" && routeScope !== "core"/);
  assert.match(source, /routeScope !== "core" \|\| route\.hash !== "#\/subscription"/);
  assert.match(source, /routeScope,/);
  assert.doesNotMatch(source, /allowedNetwork|allowlist.*404|status === 404/);
});

test("실기기 CDP 점검은 전면 WebView가 아니면 앱 결함과 분리해 중단한다", () => {
  assert.match(source, /document\.visibilityState/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /document\.hasFocus\(\)/);
  assert.match(source, /environmentBlocked/);
  assert.match(source, /webview_not_foreground/);
  assert.match(source, /process\.exit\(2\)/);
  assert.match(source, /ROUTE_WAIT_MS는 0ms 이상이어야 합니다/);
  assert.match(source, /ROUTE_SETTLE_TIMEOUT_MS는 0ms 이상이어야 합니다/);
  assert.match(source, /const settleDeadline = Date\.now\(\) \+ routeSettleTimeoutMs/);
  assert.match(source, /if \(view\.busyCount === 0 \|\| Date\.now\(\) >= settleDeadline\) break/);
});

test("A17 CDP 최종 점검은 각 화면의 실제 루트 선택자로 표시 여부를 판정한다", () => {
  assert.match(source, /const requiredSelectorVisible = isElementVisible\(required\)/);
  assert.match(source, /visible: requiredSelectorVisible/);
  assert.doesNotMatch(source, /querySelectorAll\("main, section, article, \[role='main'\]"\)/);
});

test("같은 CDP 점검은 razr 아이모드 핵심 화면을 안전하게 검사한다", () => {
  assert.match(source, /process\.env\.EXPECTED_ROLE/);
  assert.match(source, /sessionCheck\?\.localRole !== expectedRole/);
  assert.match(source, /sessionCheck\?\.serverRole !== expectedRole/);
  assert.match(source, /localRole === serverRole/);
  for (const route of [
    "#/child/home",
    "#/child/sticker",
    "#/child/memo",
    "#/child/location-status",
    "#/child/settings",
    "#/supplies",
    "#/route",
    "#/child/sos",
  ]) {
    assert.match(source, new RegExp(route.replace(/[?]/g, "\\?")));
  }
  for (const selector of [
    ".kd-root",
    ".sb-root",
    ".mc-root",
    ".cls-screen",
    ".ks-root",
    ".sup-screen",
    ".rv-screen",
    ".cs-root",
  ]) {
    assert.match(source, new RegExp(selector.replace(/[.]/g, "\\.")));
  }
  assert.doesNotMatch(source, /\.click\s*\(/, "SOS를 포함한 실기기 버튼을 자동 클릭하면 안 됩니다");
});

test("A17 CDP 최종 점검은 새로고침부터 실패 응답의 경로만 안전하게 수집한다", () => {
  assert.match(source, /await send\("Network\.enable"\)/);
  assert.match(source, /message\.method === "Network\.responseReceived"/);
  assert.match(source, /message\.method === "Network\.loadingFailed"/);
  assert.match(source, /networkFailures\.push\(failure\)/);
  assert.match(source, /if \(!failure\.canceled\)/);
  assert.match(source, /networkErrors/);
  assert.match(source, /parsed\.origin.*maskSensitivePathname\(parsed\.pathname\)/);
  assert.match(source, /setTimeout\(\(\) => location\.reload\(\), 0\)/);
  assert.match(source, /await send\("Log\.clear"\)/);
  assert.match(source, /consoleErrors\.length = 0/);
  assert.doesNotMatch(source, /parsed\.search/);
});

test("실기기 CDP와 가족 정본 확인은 네트워크 무응답에도 유한 시간 안에 실패한다", () => {
  assert.match(source, /CDP_COMMAND_TIMEOUT_MS/);
  assert.match(source, /CDP \$\{method\} 응답 시간 초과/);
  assert.match(source, /fetch\(`\$\{baseUrl\}\/json\/list`, \{ signal: targetsController\.signal \}\)/);
  assert.match(source, /CDP 대상 조회 응답 시간 초과/);
  assert.match(source, /CDP WebSocket 연결 응답 시간 초과/);
  assert.match(source, /socket\.removeEventListener\("open", handleOpen\)/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 10000\)/);
  assert.match(source, /finally \{\s*clearTimeout\(timeoutId\)/);
});

test("실기기 검증은 44px 미만 조작부를 실패시키고 역할별 안전한 홈으로 복귀한다", () => {
  assert.match(source, /smallControlCount/);
  assert.match(source, /rect\.width >= 44 && rect\.height >= 44/);
  assert.match(source, /Number\(rect\.width\.toFixed\(2\)\)/);
  assert.match(source, /route\.busyCount > 0/);
  assert.match(source, /route\.smallControlCount > 0/);
  assert.match(source, /expectedRole === "parent" \? "#\/parent\/home" : "#\/child\/home"/);
  assert.match(source, /location\.hash = \$\{JSON\.stringify\(safeHomeHash\)\}/);
});
