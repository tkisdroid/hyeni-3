import "./helpers/appModuleResolve.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const {
  cameraPermissionFailure,
  normalizeNativeCameraPermission,
  normalizeBrowserCameraPermission,
} = await import("../src/transform/cameraPermissionState.ts");

test("Android 카메라 권한은 재요청 가능 거부와 설정이 필요한 차단을 구분한다", () => {
  assert.deepEqual(
    normalizeNativeCameraPermission({ granted: false, requested: true, shouldShowRationale: true }),
    { granted: false, source: "native", recovery: "retry" },
  );
  assert.deepEqual(
    normalizeNativeCameraPermission({ granted: false, requested: true, shouldShowRationale: false }),
    { granted: false, source: "native", recovery: "settings" },
  );
  assert.deepEqual(
    normalizeNativeCameraPermission({ granted: true, requested: false, shouldShowRationale: false }),
    { granted: true, source: "native", recovery: "none" },
  );
});

test("브라우저 거부에는 동작하지 않는 Android 앱 설정 버튼을 제안하지 않는다", () => {
  assert.deepEqual(
    normalizeBrowserCameraPermission("denied"),
    { granted: false, source: "browser", recovery: "retry" },
  );
  assert.deepEqual(
    normalizeBrowserCameraPermission("prompt"),
    { granted: true, source: "browser", recovery: "none" },
  );
});

test("네이티브 권한 브리지 오류는 영구 차단으로 단정하지 않고 재시도시킨다", () => {
  assert.deepEqual(cameraPermissionFailure("native"), {
    granted: false,
    source: "native",
    recovery: "retry",
  });
});
