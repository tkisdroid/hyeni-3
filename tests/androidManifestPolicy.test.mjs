import test from "node:test";
import assert from "node:assert/strict";

import {
  expectedReleasePermissionNames,
  inspectAndroidManifestPolicy,
} from "../scripts/android-manifest-policy.mjs";

const PACKAGE_NAME = "com.hyeni.calendar";

function manifestFixture({
  permissionNames = expectedReleasePermissionNames(PACKAGE_NAME),
  monitoringTool = "child_monitoring",
  legacyStorageMaxSdkVersion = "28",
} = {}) {
  const permissions = permissionNames.map((name) => {
    const maxSdk = name === "android.permission.WRITE_EXTERNAL_STORAGE"
      ? ` android:maxSdkVersion="${legacyStorageMaxSdkVersion}"`
      : "";
    return `<uses-permission android:name="${name}"${maxSdk}/>`;
  }).join("\n");
  return `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${PACKAGE_NAME}">
${permissions}
<application>
  <meta-data android:value="${monitoringTool}" android:name="isMonitoringTool"/>
</application>
</manifest>`;
}

test("Android 출시 manifest 정책은 승인 권한 목록과 자녀 모니터링 선언을 확정한다", () => {
  const result = inspectAndroidManifestPolicy(manifestFixture(), PACKAGE_NAME);
  assert.equal(result.policyVersion, 1);
  assert.equal(result.exactApprovedPermissions, true);
  // 개수를 박아 두면 승인된 권한이 하나 늘 때마다 두 곳을 고쳐야 한다 — 목록이 정본이다.
  assert.equal(result.permissionCount, expectedReleasePermissionNames(PACKAGE_NAME).length);
  assert.deepEqual(result.permissionNames, expectedReleasePermissionNames(PACKAGE_NAME));
  assert.equal(result.monitoringTool, "child_monitoring");
  assert.equal(result.legacyStorageMaxSdkVersion, 28);
});

test("권한 추가·삭제·중복과 uses-permission-sdk 우회는 모두 거부한다", () => {
  const expected = expectedReleasePermissionNames(PACKAGE_NAME);
  assert.throws(
    () => inspectAndroidManifestPolicy(manifestFixture({
      permissionNames: [...expected, "android.permission.QUERY_ALL_PACKAGES"],
    }), PACKAGE_NAME),
    /allowlist/,
  );
  assert.throws(
    () => inspectAndroidManifestPolicy(manifestFixture({ permissionNames: expected.slice(1) }), PACKAGE_NAME),
    /allowlist/,
  );
  assert.throws(
    () => inspectAndroidManifestPolicy(manifestFixture({ permissionNames: [...expected, expected[0]] }), PACKAGE_NAME),
    /중복 권한/,
  );
  assert.throws(
    () => inspectAndroidManifestPolicy(
      manifestFixture().replace("</manifest>", "<uses-permission-sdk-23 android:name=\"android.permission.CAMERA\"/></manifest>"),
      PACKAGE_NAME,
    ),
    /uses-permission-sdk/,
  );
});

test("모니터링 값과 legacy 저장소 SDK 상한은 정확한 값만 허용한다", () => {
  assert.throws(
    () => inspectAndroidManifestPolicy(manifestFixture({ monitoringTool: "none" }), PACKAGE_NAME),
    /isMonitoringTool/,
  );
  assert.throws(
    () => inspectAndroidManifestPolicy(manifestFixture({ legacyStorageMaxSdkVersion: "29" }), PACKAGE_NAME),
    /maxSdkVersion=28/,
  );
});
