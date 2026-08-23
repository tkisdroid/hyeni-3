import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { ApiError } = await import("../src/lib/api/errors.ts");
const {
  describeRemoteListenAuditFailure,
  resolveRemoteListenAuditFailureState,
} = await import("../src/transform/remoteListenAuditFailure.ts");

test("공동 보호자의 청취 감사 세션 거부는 주 보호자 전용 안내로 분류한다", () => {
  const failure = describeRemoteListenAuditFailure(new ApiError("primary_parent_required", 403));
  assert.deepEqual(failure, { errorCode: "primary_parent_required", status: 403 });
  assert.equal(resolveRemoteListenAuditFailureState(failure), "primaryOnly");
});

test("청취 감사 세션의 구독·설정 거부와 일시 실패를 구분한다", () => {
  assert.equal(
    resolveRemoteListenAuditFailureState({ errorCode: "remote_listen_requires_premium", status: 402 }),
    "premiumOnly",
  );
  assert.equal(
    resolveRemoteListenAuditFailureState({ errorCode: "remote_listen_disabled_by_family", status: 403 }),
    "disabled",
  );
  assert.equal(
    resolveRemoteListenAuditFailureState({ errorCode: "remote_listen_entitlement_unavailable", status: 503 }),
    "auditUnavailable",
  );
  assert.deepEqual(describeRemoteListenAuditFailure(new Error("network")), {
    errorCode: null,
    status: null,
  });
});
