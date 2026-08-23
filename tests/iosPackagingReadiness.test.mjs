import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("iOS 부모 앱은 시스템 브라우저 OAuth와 고정 복귀 URL을 패키징한다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const browser = read("src/lib/native/browser.ts");
  const auth = read("src/lib/api/endpoints/auth.ts");
  const oauthState = read("worker/lib/oauthState.ts");
  const parser = read("src/transform/oauthDeepLinkParse.ts");
  const info = read("ios/App/App/Info.plist");

  assert.equal(packageJson.dependencies["@capacitor/browser"], "^8.0.4");
  assert.match(browser, /getPlatform\(\) === "ios"[\s\S]{0,180}import\("@capacitor\/browser"\)[\s\S]{0,120}Browser\.open/);
  assert.match(auth, /getPlatform\(\) === "ios" \? "ios" : native \? "native" : "web"/);
  assert.match(oauthState, /IOS_REDIRECT_TARGET = "com\.hyeni\.calendar\.oauth:\/\/oauth\/callback"/);
  assert.match(parser, /IOS_OAUTH_CALLBACK_URL = "com\.hyeni\.calendar\.oauth:\/\/oauth\/callback"/);
  assert.match(info, /<key>CFBundleURLSchemes<\/key>[\s\S]{0,120}<string>com\.hyeni\.calendar\.oauth<\/string>/);
});

test("iOS 설치는 Android 위치 플러그인 없이도 고정 기기 ID로 로그인·갱신한다", () => {
  const identity = read("src/lib/native/deviceIdentity.ts");

  assert.match(identity, /isNativePlatform\(\) && getPlatform\(\) === "android"/);
  assert.match(identity, /else \{\s*resolved = getOrCreateDeviceInstallId\(\);\s*\}/);
});

test("iOS는 Android 전용 플러그인을 지원으로 오인하지 않고 가능한 웹 기능으로 폴백한다", () => {
  const plugins = read("src/lib/native/plugins.ts");
  const permissions = read("src/lib/native/permissions.ts");
  const push = read("src/lib/native/push.ts");
  const billing = read("src/lib/native/billing.ts");
  const mediaSave = read("src/lib/native/mediaSave.ts");

  assert.match(plugins, /Capacitor\.isPluginAvailable\(name\)/);
  assert.match(permissions, /isNativePlatform\(\) && getPlatform\(\) === "android"/);
  assert.match(push, /if \(!isNativePlatform\(\) \|\| platform !== "android"\) return noop/);
  assert.match(billing, /getPlatform\(\) === "android"/);
  assert.match(mediaSave, /if \(!plugin\?\.saveImage\) return saveViaBrowserDownload\(blob, fileName\)/);
});

test("iOS 권한 문구는 부모 공용 웹 기능이 접근하는 보호 자원을 빠짐없이 설명한다", () => {
  const info = read("ios/App/App/Info.plist");
  for (const key of [
    "NSPhotoLibraryUsageDescription",
    "NSCameraUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    assert.match(info, new RegExp(`<key>${key}<\\/key>\\s*<string>[^<]+<\\/string>`), key);
  }
  assert.match(info, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test("iOS 동기화 명령은 버전·자산·Swift Package 경로를 패키징 전에 검증한다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const normalizer = read("scripts/normalize-capacitor-ios-spm.mjs");
  const verifier = read("scripts/verify-ios-packaging.mjs");
  const project = read("ios/App/App.xcodeproj/project.pbxproj");

  assert.match(packageJson.scripts["ios:sync"], /cap sync ios[\s\S]*normalize-capacitor-ios-spm[\s\S]*verify:ios/);
  assert.match(normalizer, /replaceAll\("\\\\", "\/"\)/);
  assert.match(verifier, /MARKETING_VERSION/);
  assert.match(verifier, /CURRENT_PROJECT_VERSION/);
  assert.equal((project.match(/MARKETING_VERSION = 1\.4\.1;/g) ?? []).length, 2);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 13;/g) ?? []).length, 2);
});
