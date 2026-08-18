export const ANDROID_MANIFEST_POLICY_VERSION = 1;
export const ANDROID_MONITORING_TOOL_VALUE = "child_monitoring";

const BASE_RELEASE_PERMISSIONS = Object.freeze([
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.CALL_PHONE",
  "android.permission.CAMERA",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
  "android.permission.INTERNET",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.PACKAGE_USAGE_STATS",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.RECORD_AUDIO",
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "com.android.vending.BILLING",
  "com.google.android.c2dm.permission.RECEIVE",
  // 친구 초대 설치 추천(Play Install Referrer 2.2)이 병합하는 서비스 바인딩 권한.
  // 런타임 사용자 권한이 아니라 Play 스토어 서비스 연결용이다(2026-08-18 확인).
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
]);

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_.]{2,199}$/;

function androidAttribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)android:${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function manifestTags(manifestXml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return manifestXml.match(new RegExp(`<${escaped}(?:\\s|>)[^>]*>`, "g")) ?? [];
}

export function expectedReleasePermissionNames(packageName) {
  if (typeof packageName !== "string" || !PACKAGE_NAME.test(packageName)) {
    throw new Error("Android package name이 올바르지 않습니다.");
  }
  return [
    ...BASE_RELEASE_PERMISSIONS,
    `${packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
  ].sort();
}

/** Gradle merged manifest와 bundletool dump에 같은 출시 정책을 적용한다. */
export function inspectAndroidManifestPolicy(manifestXml, packageName) {
  if (typeof manifestXml !== "string" || !manifestXml.trim()) {
    throw new Error("검증할 Android manifest가 없습니다.");
  }
  if (/<uses-permission-sdk(?:-|\s|>)/.test(manifestXml)) {
    throw new Error("승인되지 않은 uses-permission-sdk 선언이 있습니다.");
  }

  const permissionTags = manifestTags(manifestXml, "uses-permission");
  const permissionNames = permissionTags.map((tag) => androidAttribute(tag, "name"));
  if (permissionNames.some((name) => !name)) {
    throw new Error("이름을 해석할 수 없는 Android 권한 선언이 있습니다.");
  }
  const normalizedPermissionNames = permissionNames.map(String).sort();
  if (new Set(normalizedPermissionNames).size !== normalizedPermissionNames.length) {
    throw new Error("Android manifest에 중복 권한 선언이 있습니다.");
  }
  const expectedPermissionNames = expectedReleasePermissionNames(packageName);
  if (JSON.stringify(normalizedPermissionNames) !== JSON.stringify(expectedPermissionNames)) {
    throw new Error("Android manifest 권한 목록이 승인된 출시 allowlist와 다릅니다.");
  }

  const monitoringTags = manifestTags(manifestXml, "meta-data")
    .filter((tag) => androidAttribute(tag, "name") === "isMonitoringTool");
  if (
    monitoringTags.length !== 1
    || androidAttribute(monitoringTags[0], "value") !== ANDROID_MONITORING_TOOL_VALUE
  ) {
    throw new Error("Android manifest의 isMonitoringTool 선언이 올바르지 않습니다.");
  }

  const legacyStorageTag = permissionTags.find(
    (tag) => androidAttribute(tag, "name") === "android.permission.WRITE_EXTERNAL_STORAGE",
  );
  if (!legacyStorageTag || androidAttribute(legacyStorageTag, "maxSdkVersion") !== "28") {
    throw new Error("WRITE_EXTERNAL_STORAGE는 maxSdkVersion=28로만 허용됩니다.");
  }

  return {
    policyVersion: ANDROID_MANIFEST_POLICY_VERSION,
    exactApprovedPermissions: true,
    permissionCount: normalizedPermissionNames.length,
    permissionNames: normalizedPermissionNames,
    monitoringTool: ANDROID_MONITORING_TOOL_VALUE,
    legacyStorageMaxSdkVersion: 28,
  };
}
