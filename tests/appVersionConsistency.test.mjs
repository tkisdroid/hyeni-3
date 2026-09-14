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
  assert.equal(packageJson.version, "1.4.9");
  assert.equal(versionPolicy.minimumSupportedVersion, "1.4.0");
  assert.equal(versionPolicy.latestVersion, "1.4.0");
  assert.equal(versionPolicy.blockingUpdate, false);
  assert.match(gradle, /^\s*versionCode 21$/m);
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

test("Play에 이미 업로드된 code 20을 새 출시 산출물이 재사용하지 않는다", () => {
  // 2026-09-14 Play Console 모든 App Bundle에서 최대 code 20, 공개 code 19를 확인했다.
  const declared = gradle.match(/versionCode (\d+)/);
  assert.ok(declared, "android/app/build.gradle 에 versionCode 선언이 필요합니다");
  assert.ok(Number(declared[1]) > 20, `이미 업로드된 code 20 이하를 재사용했습니다: ${declared[1]}`);
});
