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

test("1.4.2 Play 문서는 혜니 도약과 code 14 심사 제출 증거를 정확히 기록한다", () => {
  const listing = read("docs/store/play-listing.md");
  const releaseNotes = read("docs/store/play-release-notes-v1.4.2.md");
  const submission = read("docs/store/play-console-submission-v1.4.2.md");

  assert.match(listing, /v1\.4\.9 \/ versionCode 21/);
  assert.match(listing, new RegExp(`앱 이름[^\n]*${appName}`));
  assert.match(releaseNotes, /혜니/);
  assert.match(releaseNotes, /가볍게 뛰고 부드럽게 착지/);
  assert.match(releaseNotes, /발밑 그림자/);
  assert.match(releaseNotes, /SOS 동선은 그대로 유지/);
  assert.match(submission, /versionName 1\.4\.2/);
  assert.match(submission, /versionCode 14/);
  assert.match(submission, /현재 판정: \*\*Play production code 14 심사 제출 완료\*\*/);
  assert.match(submission, /hyeni-calendar-v1\.4\.2-vc14-01a29f6\.aab/);
  assert.match(submission, /13,013,338 bytes/);
  assert.match(submission, /8d2388eb38e29640a6f05dec1db6a6db86fc32c71b756a1edcb1301ca08b2607/);
  assert.match(submission, /code 14[^\n]*RELEASE_LIFECYCLE_STATE_IN_REVIEW/);
  assert.match(submission, /code 13[^\n]*제거/);
  assert.match(submission, /code 6[^\n]*RELEASE_LIFECYCLE_STATE_PUBLISHED/);
  assert.match(submission, /d0c0824da0c55530dbd681af08765e69d8b34aa6f04d24aec074558f3c4b9dc9/);
  assert.match(submission, /651ef7874b929ad9062517a7a5c1605a98da8b9d04107b02f3aab4f85bdfede1/);
  assert.match(submission, /D1[^\n]*migration[^\n]*실행하지 않는다/);
  assert.match(submission, /public\/app-version\.json[^\n]*1\.4\.0/);
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
