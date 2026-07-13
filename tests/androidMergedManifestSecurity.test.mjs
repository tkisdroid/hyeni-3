import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

test("출시 manifest 병합 뒤에도 부팅·종료 receiver는 외부 앱에 노출되지 않는다", { timeout: 300_000 }, () => {
  const isWindows = process.platform === "win32";
  const gradleCommand = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "./gradlew";
  const gradleArgs = isWindows
    ? ["/d", "/s", "/c", "gradlew.bat :app:processReleaseMainManifest --no-daemon"]
    : [":app:processReleaseMainManifest", "--no-daemon"];
  const result = spawnSync(
    gradleCommand,
    gradleArgs,
    {
      cwd: androidDir,
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
});
