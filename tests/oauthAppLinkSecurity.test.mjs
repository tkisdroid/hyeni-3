import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const assetLinks = JSON.parse(
  readFileSync(new URL("../public/.well-known/assetlinks.json", import.meta.url), "utf8"),
);

test("OAuth 인증코드 복귀는 verified HTTPS App Link만 받는다", () => {
  assert.match(manifest, /<intent-filter android:autoVerify="true">[\s\S]*android:scheme="https"[\s\S]*android:host="hyeni-calendar\.pages\.dev"[\s\S]*android:path="\/oauth\/callback"/);
  assert.doesNotMatch(manifest, /android:scheme="hyenicalendar"[\s\S]*android:host="auth-callback"/);
});

test("assetlinks는 실제 패키지와 현재 debug 서명 SHA-256을 정확히 연결한다", () => {
  assert.equal(Array.isArray(assetLinks), true);
  assert.equal(assetLinks.length, 1);
  assert.deepEqual(assetLinks[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(assetLinks[0].target?.namespace, "android_app");
  assert.equal(assetLinks[0].target?.package_name, "com.hyeni.calendar");
  assert.deepEqual(assetLinks[0].target?.sha256_cert_fingerprints, [
    "2A:79:00:94:9B:4E:41:8B:59:20:11:47:3E:C9:73:ED:7E:A6:23:AD:E5:88:68:39:5A:01:9E:4A:F9:0E:1D:F2",
  ]);
});
