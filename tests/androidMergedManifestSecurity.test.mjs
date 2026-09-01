import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  expectedReleasePermissionNames,
  inspectAndroidManifestPolicy,
} from "../scripts/android-manifest-policy.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = resolve(rootDir, "android");
const mergedManifestPath = resolve(
  androidDir,
  "app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml",
);

function receiverBlock(manifest, className) {
  const receivers = manifest.match(/<receiver\b[\s\S]*?<\/receiver>/g) ?? [];
  return receivers.find((receiver) => receiver.includes(`android:name="${className}"`)) ?? "";
}

test("출시 manifest 병합 뒤 receiver·민감 권한·자녀 모니터링 선언을 고정 검증한다", { timeout: 300_000 }, () => {
  const isWindows = process.platform === "win32";
  const gradleCommand = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "./gradlew";
  // NoDefaultCurrentDirectoryInExePath=1 환경에서는 경로 접두어 없는 현재 디렉터리
  // 실행 파일을 cmd가 찾지 못하므로 .\ 를 명시한다.
  const gradleArgs = isWindows
    ? ["/d", "/s", "/c", ".\\gradlew.bat :app:processReleaseMainManifest --no-daemon"]
    : [":app:processReleaseMainManifest", "--no-daemon"];
  const result = spawnSync(
    gradleCommand,
    gradleArgs,
    {
      cwd: androidDir,
      env: {
        ...process.env,
        "ORG_GRADLE_PROJECT_android.overridePathCheck": "true",
      },
      encoding: "utf8",
      timeout: 280_000,
    },
  );

  assert.equal(
    result.status,
    0,
    `병합 manifest 생성 실패\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );

  const mergedManifest = readFileSync(mergedManifestPath, "utf8");
  const bootReceiver = receiverBlock(mergedManifest, "com.hyeni.calendar.BootReceiver");
  const shutdownReceiver = receiverBlock(mergedManifest, "com.hyeni.calendar.ShutdownReceiver");

  assert.notEqual(bootReceiver, "", "병합 manifest에 BootReceiver가 있어야 합니다");
  assert.notEqual(shutdownReceiver, "", "병합 manifest에 ShutdownReceiver가 있어야 합니다");
  assert.match(bootReceiver, /android:exported="false"/);
  assert.match(shutdownReceiver, /android:exported="false"/);

  const manifestPolicy = inspectAndroidManifestPolicy(mergedManifest, "com.hyeni.calendar");
  // 기존 24 + 시스템 알람 화면 + Play Install Referrer 바인딩 권한.
  assert.equal(manifestPolicy.permissionCount, 26);
  assert.deepEqual(
    manifestPolicy.permissionNames,
    expectedReleasePermissionNames("com.hyeni.calendar"),
  );
  assert.equal(manifestPolicy.monitoringTool, "child_monitoring");
  assert.equal(manifestPolicy.legacyStorageMaxSdkVersion, 28);
  assert.doesNotMatch(
    mergedManifest,
    /android\.permission\.(?:QUERY_ALL_PACKAGES|READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|SYSTEM_ALERT_WINDOW|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)/,
  );
});
