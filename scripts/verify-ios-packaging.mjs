import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const readBinary = (path) => readFileSync(fileURLToPath(new URL(path, rootUrl)));

function pngSize(path) {
  const bytes = readBinary(path);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${path}: PNG 파일이 아닙니다.`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function pngColorType(path) {
  return readBinary(path).readUInt8(25);
}

const packageJson = JSON.parse(read("package.json"));
const androidGradle = read("android/app/build.gradle");
const xcodeProject = read("ios/App/App.xcodeproj/project.pbxproj");
const packageSwift = read("ios/App/CapApp-SPM/Package.swift");
const infoPlist = read("ios/App/App/Info.plist");
const versionCode = androidGradle.match(/versionCode\s+(\d+)/)?.[1];

assert.ok(versionCode, "Android versionCode를 읽지 못했습니다.");
assert.equal(
  (xcodeProject.match(new RegExp(`MARKETING_VERSION = ${packageJson.version.replaceAll(".", "\\.")};`, "g")) ?? []).length,
  2,
  "iOS Debug/Release 마케팅 버전이 package.json과 다릅니다.",
);
assert.equal(
  (xcodeProject.match(new RegExp(`CURRENT_PROJECT_VERSION = ${versionCode};`, "g")) ?? []).length,
  2,
  "iOS Debug/Release 빌드 번호가 Android versionCode와 다릅니다.",
);
assert.doesNotMatch(packageSwift, /path:\s*"[^"]*\\/);
assert.match(packageSwift, /\.package\(name: "CapacitorBrowser", path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/browser"\)/);
assert.match(infoPlist, /<key>CFBundleURLSchemes<\/key>[\s\S]{0,120}<string>com\.hyeni\.calendar\.oauth<\/string>/);
for (const key of [
  "NSPhotoLibraryUsageDescription",
  "NSCameraUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSMicrophoneUsageDescription",
]) {
  assert.match(infoPlist, new RegExp(`<key>${key}<\\/key>\\s*<string>[^<]+<\\/string>`), key);
}
assert.deepEqual(
  pngSize("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
  { width: 1024, height: 1024 },
);
assert.ok(
  ![4, 6].includes(pngColorType("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")),
  "App Store 아이콘 PNG에 alpha 채널이 포함되어 있습니다.",
);
for (const file of [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
]) {
  assert.deepEqual(
    pngSize(`ios/App/App/Assets.xcassets/Splash.imageset/${file}`),
    { width: 2732, height: 2732 },
  );
}

console.log(`iOS 패키징 소스 검증 완료: ${packageJson.version} (${versionCode})`);
