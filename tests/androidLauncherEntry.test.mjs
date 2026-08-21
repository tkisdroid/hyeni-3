import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildOwnerInstallArgs } from "../scripts/install-android-debug.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("Android application에는 실제 런처 진입점이 MainActivity 하나뿐이다", () => {
  const application = manifest.match(/<application\b[\s\S]*?<\/application>/)?.[0];
  assert.ok(application, "application 블록이 필요하다");

  const launcherFilters = [...application.matchAll(/<intent-filter\b[\s\S]*?<\/intent-filter>/g)]
    .filter(([filter]) => filter.includes("android.intent.action.MAIN") && filter.includes("android.intent.category.LAUNCHER"));
  assert.equal(launcherFilters.length, 1);

  const filterOffset = application.indexOf(launcherFilters[0][0]);
  const owningActivity = application.slice(application.lastIndexOf("<activity", filterOffset), filterOffset);
  assert.match(owningActivity, /android:name="\.MainActivity"/);
  assert.doesNotMatch(application, /<activity-alias\b/);
});

test("런처 앱 조회용 queries는 실제 application 런처와 구분해 유지한다", () => {
  const queries = manifest.match(/<queries>[\s\S]*?<\/queries>/)?.[0];
  assert.ok(queries);
  assert.match(queries, /android.intent.category.LAUNCHER/);
});

test("debug 설치는 기본 사용자 0에만 재설치해 세션을 보존한다", () => {
  assert.deepEqual(
    buildOwnerInstallArgs("SERIAL", "app-debug.apk"),
    ["-s", "SERIAL", "install", "--user", "0", "-r", "app-debug.apk"],
  );
  assert.equal(packageJson.scripts["android:install:debug"], "node scripts/install-android-debug.mjs");
});
