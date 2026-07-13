import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const variables = readFileSync(new URL("../android/variables.gradle", import.meta.url), "utf8");

test("사용하지 않는 오버레이 권한을 출시 manifest에 포함하지 않는다", () => {
  assert.doesNotMatch(manifest, /android\.permission\.SYSTEM_ALERT_WINDOW/);
});

test("자녀 모니터링 앱 분류와 백그라운드 위치 FGS 선언을 명시한다", () => {
  assert.match(manifest, /android:name="isMonitoringTool"[\s\S]{0,120}android:value="child_monitoring"/);
  assert.match(manifest, /android\.permission\.ACCESS_BACKGROUND_LOCATION/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_LOCATION/);
  assert.match(manifest, /android:foregroundServiceType="location"/);
});

test("현재 Play 신규 앱 기준보다 높은 target SDK를 사용한다", () => {
  const match = variables.match(/targetSdkVersion\s*=\s*(\d+)/);
  assert.ok(match, "targetSdkVersion 선언이 필요합니다");
  assert.ok(Number(match[1]) >= 35);
});

test("광범위 사진·패키지 조회 권한을 요청하지 않는다", () => {
  assert.doesNotMatch(manifest, /android\.permission\.READ_MEDIA_(?:IMAGES|VIDEO)/);
  assert.doesNotMatch(manifest, /android\.permission\.QUERY_ALL_PACKAGES/);
});

test("배터리 최적화 직접 예외 권한을 요청하지 않는다", () => {
  assert.doesNotMatch(manifest, /android\.permission\.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
});

test("서버 cron 일정과 inexact 복구만 사용하므로 정확한 알람 특별 권한을 요청하지 않는다", () => {
  assert.doesNotMatch(manifest, /android\.permission\.(?:SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM)/);
});

test("전화 기능이 없는 태블릿·ChromeOS 설치를 막지 않는다", () => {
  assert.match(
    manifest,
    /<uses-feature\s+android:name="android\.hardware\.telephony"\s+android:required="false"\s*\/>/,
  );
});

test("세션과 아동 위치 데이터는 모든 Android 백업·기기 전송에서 제외한다", () => {
  const modernUrl = new URL("../android/app/src/main/res/xml/data_extraction_rules.xml", import.meta.url);
  const legacyUrl = new URL("../android/app/src/main/res/xml/backup_rules.xml", import.meta.url);
  assert.equal(existsSync(modernUrl), true, "Android 12+ dataExtractionRules 파일이 필요합니다");
  assert.equal(existsSync(legacyUrl), true, "Android 11 이하 fullBackupContent 파일이 필요합니다");

  const modern = readFileSync(modernUrl, "utf8");
  const legacy = readFileSync(legacyUrl, "utf8");
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(modern, /<cloud-backup>[\s\S]*<exclude domain="sharedpref" path="\."\s*\/>/);
  assert.match(modern, /<device-transfer>[\s\S]*<exclude domain="database" path="\."\s*\/>/);
  assert.match(legacy, /<exclude domain="root" path="\."\s*\/>/);
  assert.match(legacy, /<exclude domain="external" path="\."\s*\/>/);
});

test("부팅·종료 receiver는 시스템과 앱 내부 명시 호출만 받도록 export하지 않는다", () => {
  const bootReceiver = manifest.match(
    /<receiver\s+[\s\S]*?android:name="\.BootReceiver"[\s\S]*?<\/receiver>/,
  )?.[0] ?? "";
  const shutdownReceiver = manifest.match(
    /<receiver\s+[\s\S]*?android:name="\.ShutdownReceiver"[\s\S]*?<\/receiver>/,
  )?.[0] ?? "";

  assert.notEqual(bootReceiver, "");
  assert.notEqual(shutdownReceiver, "");
  assert.match(bootReceiver, /android:exported="false"/);
  assert.match(shutdownReceiver, /android:exported="false"/);
});
