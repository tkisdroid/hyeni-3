import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/LocationService.java", import.meta.url),
  "utf8",
);

// 2026-09-26 에뮬레이터 실측: startForegroundService() 로 시작된 위치 서비스가 오래된 세션 문맥을
// 거부하고 startForeground() 없이 stopSelf() 해 ForegroundServiceDidNotStartInTimeException 으로
// 아이 앱이 강제 종료됐다. 추적을 시작하기 전의 모든 조기 종료는 foreground 요건을 먼저 채운다.
test("위치 서비스는 startForeground 전에 멈추는 경로에서도 foreground 요건을 먼저 채운다", () => {
  const helperStart = service.indexOf("private void stopBeforeTrackingStarts()");
  assert.ok(helperStart > 0, "조기 종료 helper 가 있어야 한다");
  const helper = service.slice(helperStart, service.indexOf("public int onStartCommand(", helperStart));
  assert.ok(helper.indexOf("startForeground(") >= 0, "helper 는 먼저 startForeground 를 호출한다");
  assert.ok(helper.indexOf("startForeground(") < helper.indexOf("stopSelf();"), "startForeground 가 stopSelf 보다 앞서야 한다");
  assert.match(helper, /FOREGROUND_SERVICE_TYPE_LOCATION/);
  assert.match(helper, /catch \(RuntimeException e\)/);

  const onStart = service.slice(service.indexOf("public int onStartCommand("));
  const mainPromotion = onStart.indexOf("// Android 14+ (UDC, sdk 34) requires the foreground service type");
  assert.ok(mainPromotion > 0);
  const beforeTracking = onStart.slice(0, mainPromotion);
  // 명시적 STOP 은 이미 foreground 를 내리는 정상 종료라 그대로 둔다.
  const stopBranchEnd = beforeTracking.indexOf("return START_NOT_STICKY;") + "return START_NOT_STICKY;".length;
  const afterStopBranch = beforeTracking.slice(stopBranchEnd);
  assert.doesNotMatch(afterStopBranch, /\bstopSelf\(\);/, "추적 시작 전 조기 종료는 stopSelf 를 직접 부르지 않는다");
  assert.equal((afterStopBranch.match(/stopBeforeTrackingStarts\(\);/g) ?? []).length, 5);
});
