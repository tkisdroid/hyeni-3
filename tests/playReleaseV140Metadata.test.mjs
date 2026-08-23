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

test("1.4.0 출시 빌드는 Android와 iOS 빌드 번호를 12로 맞춘다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const androidGradle = read("android/app/build.gradle");
  const iosProject = read("ios/App/App.xcodeproj/project.pbxproj");

  assert.equal(packageJson.version, "1.4.0");
  assert.match(androidGradle, /^\s*versionCode 12$/m);
  assert.equal((iosProject.match(/CURRENT_PROJECT_VERSION = 12;/g) ?? []).length, 2);
  assert.equal((iosProject.match(/MARKETING_VERSION = 1\.4\.0;/g) ?? []).length, 2);
});

test("설치 앱과 PWA는 새 정식 이름을 사용한다", () => {
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

test("Play 등록정보는 제작 배경·무료 범위·서버 비용 구독 이유를 함께 설명한다", () => {
  const listing = read("docs/store/play-listing.md");
  const releaseNotes = read("docs/store/play-release-notes-v1.4.0.md");

  assert.match(listing, /v1\.4\.0 \/ versionCode 12/);
  assert.match(listing, new RegExp(`앱 이름[^\n]*${appName}`));
  assert.match(listing, /아빠가 (?:자기 )?아이를 위해 만든/);
  assert.match(listing, /기본[^\n]{0,30}무료/);
  assert.match(listing, /서버[^\n]{0,40}비용[^\n]{0,50}구독/);
  assert.match(listing, /SOS와 긴급 알림은 구독 여부와 관계없이 사용할 수 있어요/);
  assert.match(releaseNotes, /1\.4\.0/);
  assert.match(releaseNotes, /일정 등록/);
  assert.match(releaseNotes, /iPhone Safari/);
});

test("Android 적응형 아이콘은 캐릭터 여백을 줄여 전경을 조금 더 크게 표시한다", async () => {
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
