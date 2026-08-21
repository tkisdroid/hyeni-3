import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultApkPath = resolve(scriptDir, "..", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");

export function buildOwnerInstallArgs(serial, apkPath = defaultApkPath) {
  return ["-s", serial, "install", "--user", "0", "-r", apkPath];
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

export function main(argv = process.argv.slice(2)) {
  const [serial, ...extra] = argv;
  if (!serial || extra.length > 0 || !/^[A-Za-z0-9._:-]+$/.test(serial)) {
    fail("사용법: npm run android:install:debug -- <기기-serial>");
    return;
  }
  if (!existsSync(defaultApkPath)) {
    fail(`debug APK가 없습니다: ${defaultApkPath}`);
    return;
  }

  const state = spawnSync("adb", ["-s", serial, "get-state"], { encoding: "utf8" });
  if (state.status !== 0 || state.stdout.trim() !== "device") {
    fail(`연결된 기기를 확인하지 못했습니다: ${serial}`);
    return;
  }

  // --user 0이 없으면 Samsung DUAL_APP 같은 보조 사용자에도 debug APK가 설치돼
  // 앱 서랍에 같은 아이콘이 두 개 생길 수 있다. -r은 기본 사용자 데이터와 세션을 보존한다.
  const install = spawnSync("adb", buildOwnerInstallArgs(serial), { stdio: "inherit" });
  if (install.error) {
    fail(`adb 실행 실패: ${install.error.message}`);
    return;
  }
  process.exitCode = install.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) main();
