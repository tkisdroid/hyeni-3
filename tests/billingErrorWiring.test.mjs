import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BillingError } from "../src/lib/native/billingError.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Subscription과 AiCredit의 native catch는 같은 formal billing resolver를 사용한다", async () => {
  const module = await import("../src/transform/billingFailureMessage.ts").catch(() => null);
  assert.ok(module, "공용 native billing resolver가 필요합니다");
  assert.equal(typeof module.resolveNativeBillingFailureMessage, "function");
  const intl = {
    formatMessage({ id }) {
      return id === "core.error.billing.pending.formal" ? "결제 승인 대기 안내" : `unexpected:${id}`;
    },
  };
  assert.equal(
    module.resolveNativeBillingFailureMessage(new BillingError("purchase_pending"), intl),
    "결제 승인 대기 안내",
  );

  for (const path of [
    "src/screens/feature/Subscription.tsx",
    "src/screens/feature/AiCredit.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /resolveNativeBillingFailureMessage\(error, intl\)/, path);
    assert.doesNotMatch(source, /:\s*localizeApiError\(error, intl, "formal"\)/, path);
  }
});
