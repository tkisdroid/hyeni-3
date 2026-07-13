import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("릴리즈 서명 비밀은 Gradle property를 거부하고 임시 환경변수에서만 읽는다", () => {
  const gradle = read("android/app/build.gradle");

  assert.doesNotMatch(gradle, /project\.findProperty\(name\)/);
  assert.doesNotMatch(gradle, /gradle\.startParameter\.taskNames/);
  assert.match(gradle, /gradle\.taskGraph\.whenReady/);
  assert.match(gradle, /graph\.allTasks\.any/);
  assert.match(gradle, /isHyeniReleaseArtifactTask/);
  assert.match(gradle, /project\.hasProperty\(name\)/);
  assert.match(gradle, /throw new GradleException\(/);
  assert.match(gradle, /return System\.getenv\(name\)/);
});

test("릴리즈 작업은 네 개의 서명 환경변수가 모두 없으면 즉시 실패한다", () => {
  const gradle = read("android/app/build.gradle");

  assert.match(gradle, /hyeniSigningVariableNames/);
  assert.match(gradle, /missingHyeniSigningVariables/);
  assert.match(
    gradle,
    /if \(!releaseArtifactScheduled\) return/,
  );
  assert.match(gradle, /forbiddenSigningProperties/);
  assert.match(gradle, /missingHyeniSigningVariables\.join\(["']\s*,\s*["']\)/);
  assert.match(gradle, /hasHyeniReleaseSigning = missingHyeniSigningVariables\.isEmpty\(\)/);
});

test("집계 build·assemble·bundle도 실제 task graph에 release 산출 작업이 있으면 서명 검증한다", () => {
  const gradle = read("android/app/build.gradle");
  const releaseTaskPolicy = gradle.slice(
    gradle.indexOf("def isHyeniReleaseArtifactTask"),
    gradle.indexOf("def hyeniSigningVariableNames"),
  );

  assert.match(releaseTaskPolicy, /task\.project\.path != project\.path/);
  assert.match(releaseTaskPolicy, /taskName\.contains\("release"\)/);
  assert.match(releaseTaskPolicy, /taskName\.startsWith\("assemble"\)/);
  assert.match(releaseTaskPolicy, /taskName\.startsWith\("bundle"\)/);
  assert.match(releaseTaskPolicy, /taskName\.startsWith\("package"\)/);
  assert.match(releaseTaskPolicy, /taskName\.startsWith\("sign"\)/);
});

test("위치 서비스 재시작은 특별 권한 없이 inexact alarm으로 보존한다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const restart = service.slice(
    service.indexOf("private void scheduleAlarmRestart()"),
    service.indexOf("private void cancelAlarmRestart()"),
  );

  assert.match(restart, /am\.setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP, triggerAt, pi\)/);
  assert.doesNotMatch(restart, /canScheduleExactAlarms|setExact/);
});

test("heartbeat도 특별 권한 없이 inexact alarm chain을 유지한다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const heartbeat = service.slice(
    service.indexOf("private void scheduleNextHeartbeat()"),
    service.indexOf("private void cancelHeartbeat()"),
  );

  assert.match(heartbeat, /am\.setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP, triggerAt, pi\)/);
  assert.doesNotMatch(heartbeat, /canScheduleExactAlarms|setExact/);
});

test("예약 알림과 전달 상태도 정확 알람 권한·설정 화면에 의존하지 않는다", () => {
  const scheduler = read("android/app/src/main/java/com/hyeni/calendar/NotificationScheduleManager.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const reporter = read("android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java");

  assert.match(scheduler, /setAndAllowWhileIdle/);
  assert.doesNotMatch(scheduler, /canScheduleExactAlarms|setExact/);
  assert.doesNotMatch(plugin, /exactAlarmAllowed|openExactAlarmSettings/);
  assert.doesNotMatch(reporter, /exactAlarmAllowed/);
});
