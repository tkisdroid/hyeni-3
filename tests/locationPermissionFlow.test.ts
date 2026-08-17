import test from "node:test";
import assert from "node:assert/strict";

const flowModule = await import("../src/transform/locationPermissionFlow.ts").catch(() => ({}));
const advanceLocationPermissionStage = (
  flowModule as {
    advanceLocationPermissionStage?: (
      stage: string,
      event: { type: string; granted?: boolean; supported?: boolean },
    ) => string;
  }
).advanceLocationPermissionStage;
const resolveChildLocationStatusKind = (
  flowModule as {
    resolveChildLocationStatusKind?: (input: {
      freshEnough: boolean;
      permission: "granted" | "denied" | "unknown";
    }) => string;
  }
).resolveChildLocationStatusKind;

test("위치 동의는 고지 다음 전경 권한, 교육 다음 백그라운드 권한 순서로 진행한다", () => {
  assert.equal(typeof advanceLocationPermissionStage, "function");
  if (!advanceLocationPermissionStage) return;

  assert.equal(advanceLocationPermissionStage("closed", { type: "open" }), "disclosure");
  assert.equal(
    advanceLocationPermissionStage("disclosure", {
      type: "foregroundResult",
      granted: true,
      supported: true,
    }),
    "backgroundEducation",
  );
  assert.equal(
    advanceLocationPermissionStage("backgroundEducation", {
      type: "backgroundResult",
      granted: true,
      supported: true,
    }),
    "closed",
  );
});

test("권한 거부 뒤 재시도는 OS 요청 전에 해당 안내 단계부터 다시 보여준다", () => {
  assert.equal(typeof advanceLocationPermissionStage, "function");
  if (!advanceLocationPermissionStage) return;

  assert.equal(
    advanceLocationPermissionStage("disclosure", {
      type: "foregroundResult",
      granted: false,
      supported: true,
    }),
    "foregroundDenied",
  );
  assert.equal(
    advanceLocationPermissionStage("foregroundDenied", { type: "retry" }),
    "disclosure",
  );
  assert.equal(
    advanceLocationPermissionStage("backgroundEducation", {
      type: "backgroundResult",
      granted: false,
      supported: true,
    }),
    "backgroundDenied",
  );
  assert.equal(
    advanceLocationPermissionStage("backgroundDenied", { type: "retry" }),
    "backgroundEducation",
  );
});

test("현재 기기 위치 권한이 없으면 다른 기기의 최근 위치가 있어도 전송 중으로 표시하지 않는다", () => {
  assert.equal(typeof resolveChildLocationStatusKind, "function");
  if (!resolveChildLocationStatusKind) return;

  assert.equal(
    resolveChildLocationStatusKind({ freshEnough: true, permission: "denied" }),
    "permission",
  );
  assert.equal(
    resolveChildLocationStatusKind({ freshEnough: true, permission: "granted" }),
    "sending",
  );
  assert.equal(
    resolveChildLocationStatusKind({ freshEnough: false, permission: "granted" }),
    "off",
  );
  assert.equal(
    resolveChildLocationStatusKind({ freshEnough: true, permission: "unknown" }),
    "off",
  );
});
