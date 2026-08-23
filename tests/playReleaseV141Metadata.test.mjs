import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appName = "혜니캘린더 - 우리아이 일정&안전 한번에";

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("1.4.1 출시 빌드는 Android와 iOS 빌드 번호를 13으로 맞춘다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const androidGradle = read("android/app/build.gradle");
  const iosProject = read("ios/App/App.xcodeproj/project.pbxproj");

  assert.equal(packageJson.version, "1.4.1");
  assert.match(androidGradle, /^\s*versionCode 13$/m);
  assert.equal((iosProject.match(/CURRENT_PROJECT_VERSION = 13;/g) ?? []).length, 2);
  assert.equal((iosProject.match(/MARKETING_VERSION = 1\.4\.1;/g) ?? []).length, 2);
});

test("설치 앱과 PWA는 정식 이름을 계속 사용한다", () => {
  const androidStrings = read("android/app/src/main/res/values/strings.xml");
  const capacitor = JSON.parse(read("capacitor.config.json"));
  const viteConfig = read("vite.config.ts");
  const html = read("index.html");

  const xmlAppName = appName.replace("&", "&amp;");
  assert.match(androidStrings, new RegExp(`<string name="app_name">${xmlAppName}</string>`));
  assert.match(androidStrings, new RegExp(`<string name="title_activity_main">${xmlAppName}</string>`));
  assert.equal(capacitor.appName, appName);
  assert.match(viteConfig, new RegExp(`name: "${appName}"`));
  assert.match(html, new RegExp(`<title>${appName.replace("&", "&amp;")}</title>`));
});

test("1.4.1 Play 문서는 실제 안정화 변경과 미제출 상태를 정확히 기록한다", () => {
  const listing = read("docs/store/play-listing.md");
  const releaseNotes = read("docs/store/play-release-notes-v1.4.1.md");
  const submission = read("docs/store/play-console-submission-v1.4.1.md");

  assert.match(listing, /v1\.4\.1 \/ versionCode 13/);
  assert.match(listing, new RegExp(`앱 이름[^\n]*${appName}`));
  assert.match(releaseNotes, /길찾기/);
  assert.match(releaseNotes, /아이 연결/);
  assert.match(releaseNotes, /결제 상품/);
  assert.match(submission, /versionName 1\.4\.1/);
  assert.match(submission, /versionCode 13/);
  assert.match(submission, /업데이트 산출물 준비 중/);
  assert.doesNotMatch(submission, /프로덕션 제출·API readback 완료/);
});

test("Android 적응형 아이콘은 캐릭터 여백을 줄여 전경을 크게 표시한다", async () => {
  const iconPath = resolve(
    rootDir,
    "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
  );
  const { data, info } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  assert.ok(maxX >= 0, "아이콘 전경이 비어 있습니다.");
  assert.ok((maxX - minX + 1) / info.width >= 0.62, "아이콘 전경의 좌우 여백이 아직 큽니다.");
});
