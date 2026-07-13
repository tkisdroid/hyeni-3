import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("아이의 서버 동의가 성공하기 전에는 마이크 서비스를 시작하지 않는다", () => {
  const activity = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenActivity.java");
  const confirmIndex = activity.indexOf("RemoteListenConsentClient.confirm(");
  const launchIndex = activity.indexOf("startForegroundService(serviceIntent)");

  assert.ok(confirmIndex >= 0);
  assert.ok(launchIndex > confirmIndex);
  assert.match(activity, /result\.isSuccess\(\)/);
  assert.match(activity, /EXTRA_CAPTURE_EXPIRES_AT_MS/);
});

test("네이티브 캡처도 서버가 준 절대 만료시각과 60초 상한을 함께 지킨다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/AmbientListenService.java");

  assert.match(service, /EXTRA_CAPTURE_EXPIRES_AT_MS/);
  assert.match(service, /captureDeadlineMs\(\s*System\.currentTimeMillis\(\),\s*captureExpiresAtMs\s*\)/);
  assert.doesNotMatch(service, /long stopAt = System\.currentTimeMillis\(\) \+ durationSec \* 1000L/);
});

test("부모 화면은 60초 안에 확정된 서버 동의의 첫 청크가 도착할 정산 여유를 둔다", () => {
  const timing = read("src/transform/remoteListenSessionTiming.ts");

  assert.match(timing, /REMOTE_AUDIO_CONSENT_SETTLE_GRACE_MS = 5_000/);
  assert.match(
    timing,
    /REMOTE_AUDIO_REQUEST_TIMEOUT_MS\s*\+\s*REMOTE_AUDIO_CONSENT_SETTLE_GRACE_MS/,
  );
});

test("부모 화면은 서버 세션 상태를 폴링하고 캡처 절대 만료시각으로 종료한다", () => {
  const endpoint = read("src/lib/api/endpoints/remoteAudit.ts");
  const query = read("src/queries/useRemoteAudit.ts");
  const screen = read("src/screens/feature/RemoteAudio.tsx");

  assert.match(endpoint, /fetchRemoteListenSessionStatus/);
  assert.match(endpoint, /capture_expires_at_ms/);
  assert.match(endpoint, /server_now_ms/);
  assert.match(query, /useRemoteListenSessionStatus/);
  assert.match(query, /refetchInterval:\s*1_000/);
  assert.match(screen, /resolveRemoteListenSessionTiming/);
  assert.match(screen, /capture_expired/);
  assert.doesNotMatch(screen, /setRemaining\(LISTEN_SECONDS\)/);
});
