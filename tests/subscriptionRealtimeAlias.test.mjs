import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/queries/useFamilyRealtime.ts", import.meta.url),
  "utf8",
);

test("구독 realtime 단수·복수 이벤트를 모두 같은 엔타이틀먼트 갱신으로 처리한다", () => {
  assert.match(
    source,
    /case "family_subscription":\s*case "family_subscriptions":\s*return \[qk\.entitlement\(familyId\)\]/,
  );
});
