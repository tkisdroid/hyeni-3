import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [packageJson, versionPolicy, vite, gradle, androidManifest, parentSettings, teacherSettings, teacherGate, koParent, koShared] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../public/app-version.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
  readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/parent/ParentSettings.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/teacher/TeacherSettings.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/teacher/TeacherReleaseGate.tsx", import.meta.url), "utf8"),
  readFile(new URL("../locales/ko/parent.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../locales/ko/shared.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("표시 버전은 package.json을 쓰고 원격 업데이트 정책은 Play 제공 버전을 넘지 않는다", () => {
  assert.equal(packageJson.version, "1.4.6");
  assert.equal(versionPolicy.minimumSupportedVersion, "1.4.0");
  assert.equal(versionPolicy.latestVersion, "1.4.0");
  assert.equal(versionPolicy.blockingUpdate, false);
  assert.match(gradle, /^\s*versionCode 18$/m);
  assert.match(vite, /__APP_VERSION__:\s*JSON\.stringify\(packageMetadata\.version\)/);
  assert.match(gradle, /hyeniPackageVersion = new JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/package\.json'\)\)\.version/);
  assert.match(gradle, /versionName hyeniPackageVersion/);
  assert.match(gradle, /manifestPlaceholders = \[hyeniReleaseSourceSha: hyeniReleaseSourceSha, MAPS_API_KEY: hyeniMapsApiKey\]/);
  assert.match(gradle, /릴리즈 산출물은 clean 앱 worktree에서만 만들 수 있습니다/);
  assert.match(androidManifest, /com\.hyeni\.calendar\.RELEASE_SOURCE_SHA/);
  assert.match(androidManifest, /android:value="\$\{hyeniReleaseSourceSha\}"/);
  assert.match(parentSettings, /parent\.settings\.version/);
  assert.match(koParent["parent.settings.version"], /v\{version\}/);
  assert.match(teacherSettings, /shared\.teacherSettings\.version[\s\S]*APP_VERSION/);
  assert.match(koShared["shared.teacherSettings.version"], /v\{version\}/);
  assert.match(teacherGate, /shared\.teacherReleaseGate\.eyebrow[\s\S]*APP_VERSION/);
  assert.match(koShared["shared.teacherReleaseGate.eyebrow"], /v\{version\}/);
  assert.doesNotMatch(`${parentSettings}\n${teacherSettings}`, /v2\.0\.0/);
});

test("직전 개발 후보 versionCode 10을 새 출시 산출물이 재사용하지 않는다", () => {
  // Play 전체 트랙 최대값은 6이지만 현재 개발 후보가 이미 10이다(2026-08-19 Console readback).
  // 다음 출시 후보는 두 기준을 모두 넘어야 한다.
  const declared = gradle.match(/versionCode (\d+)/);
  assert.ok(declared, "android/app/build.gradle 에 versionCode 선언이 필요합니다");
  assert.ok(Number(declared[1]) > 10, `기존 후보 versionCode 10 이하를 재사용했습니다: ${declared[1]}`);
});
