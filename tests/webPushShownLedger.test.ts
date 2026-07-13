import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeShownPushIds,
  shownPushLedgerKey,
  SHOWN_PUSH_ID_LIMIT,
} from "../src/transform/webPushShownLedger.ts";

test("표시 pushId 장부는 중복을 최신으로 이동하고 최근 100개만 보존한다", () => {
  const initial = Array.from({ length: SHOWN_PUSH_ID_LIMIT }, (_, index) => `push-${index}`);
  const appended = mergeShownPushIds(initial, "push-new");

  assert.equal(appended.length, SHOWN_PUSH_ID_LIMIT);
  assert.equal(appended[0], "push-1");
  assert.equal(appended.at(-1), "push-new");

  const refreshed = mergeShownPushIds(appended, "push-50");
  assert.equal(refreshed.length, SHOWN_PUSH_ID_LIMIT);
  assert.equal(refreshed.filter((id) => id === "push-50").length, 1);
  assert.equal(refreshed.at(-1), "push-50");
});

test("손상된 장부 값과 빈 pushId는 안전하게 정규화한다", () => {
  assert.deepEqual(
    mergeShownPushIds([" push-a ", null, "", "push-a", 7, "push-b"], " push-c "),
    ["push-a", "push-b", "push-c"],
  );
  assert.deepEqual(mergeShownPushIds("invalid", ""), []);
});

test("같은 pushId도 가족·사용자별로 분리해 공유 브라우저의 오인 ACK를 막는다", () => {
  assert.notEqual(
    shownPushLedgerKey("family-a", "user-a", "push-1"),
    shownPushLedgerKey("family-b", "user-b", "push-1"),
  );
  assert.equal(shownPushLedgerKey(" family-a ", " user-a ", " push-1 "), "family-a:user-a:push-1");
  assert.equal(shownPushLedgerKey("", "user-a", "push-1"), "");
});
