import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [packageJson, vite, gradle, parentSettings, teacherSettings] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/parent/ParentSettings.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/teacher/TeacherSettings.tsx", import.meta.url), "utf8"),
]);

test("웹과 Android 표시 버전은 package.json을 단일 정본으로 사용한다", () => {
  assert.equal(packageJson.version, "1.2.0");
  assert.match(vite, /__APP_VERSION__:\s*JSON\.stringify\(packageMetadata\.version\)/);
  assert.match(gradle, /hyeniPackageVersion = new JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/package\.json'\)\)\.version/);
  assert.match(gradle, /versionName hyeniPackageVersion/);
  assert.match(parentSettings, /v\{APP_VERSION\}/);
  assert.match(teacherSettings, /v\{APP_VERSION\}/);
  assert.doesNotMatch(`${parentSettings}\n${teacherSettings}`, /v2\.0\.0/);
});

test("새 출시 산출물은 오래된 versionCode 3을 재사용하지 않는다", () => {
  assert.match(gradle, /versionCode 4/);
});
