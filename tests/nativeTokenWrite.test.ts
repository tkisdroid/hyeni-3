import test from "node:test";
import assert from "node:assert/strict";

import { shouldWriteNativeSessionToken } from "../src/transform/nativeTokenWrite.ts";

test("가족이 확정된 비익명 세션만 네이티브 토큰 저장소에 쓴다", () => {
  assert.equal(
    shouldWriteNativeSessionToken({ isAnonymous: false, familyId: "fam-1", role: "child" }),
    true,
  );
  assert.equal(
    shouldWriteNativeSessionToken({ isAnonymous: false, familyId: "fam-1", role: "parent" }),
    true,
  );
});

test("★익명 세션 토큰은 네이티브에 쓰지 않는다(복구 경로 파괴 방지)", () => {
  // 2026-07-10 실사고: 익명 토큰이 네이티브 prefs 를 덮어 restoreNativeRefreshOnlySession
  // 이 영영 불일치 → 재페어링 없이는 복구 불가.
  assert.equal(
    shouldWriteNativeSessionToken({ isAnonymous: true, familyId: null, role: "anonymous" }),
    false,
  );
  assert.equal(
    shouldWriteNativeSessionToken({ isAnonymous: true, familyId: "fam-1", role: "child" }),
    false,
  );
});

test("가족 미확정·알 수 없는 역할은 쓰지 않는다", () => {
  assert.equal(shouldWriteNativeSessionToken({ isAnonymous: false, familyId: null, role: "child" }), false);
  assert.equal(shouldWriteNativeSessionToken({ isAnonymous: false, familyId: "  ", role: "child" }), false);
  assert.equal(shouldWriteNativeSessionToken({ isAnonymous: false, familyId: "fam-1", role: "anonymous" }), false);
  assert.equal(shouldWriteNativeSessionToken({}), false);
});
