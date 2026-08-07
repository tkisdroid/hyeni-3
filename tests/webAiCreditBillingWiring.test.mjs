import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("PWA AI 크레딧은 서버 카탈로그에 있는 팩만 Toss 일회성 결제로 연다", () => {
  const screen = read("src/screens/feature/AiCredit.tsx");
  const sdk = read("src/lib/webBilling.ts");
  assert.match(screen, /useWebAiCreditCatalog/);
  assert.match(screen, /createWebAiCreditCheckout/);
  assert.match(screen, /validateWebAiCreditCheckout/);
  assert.match(screen, /startTossOneTimePayment/);
  assert.match(screen, /webCatalog\.packs/);
  assert.match(sdk, /requestPayment/);
  assert.match(sdk, /amount:\s*\{\s*currency:\s*"KRW",\s*value:/s);
  assert.match(sdk, /windowTarget:\s*"self"/);
});

test("PWA 복귀는 paymentKey를 지우고 pending 유실 시 서버 주문 정본을 복구한 뒤에만 완료한다", () => {
  const screen = read("src/screens/feature/AiCredit.tsx");
  const endpoint = read("src/lib/api/endpoints/webBilling.ts");
  const transform = read("src/transform/webAiCreditBilling.ts");
  assert.match(screen, /clearWebAiCreditRedirectQuery\(window\.location\.href\)/);
  assert.match(screen, /window\.history\.replaceState/);
  assert.match(screen, /resolveWebAiCreditCheckout/);
  assert.match(screen, /validateRecoveredWebAiCreditCheckout/);
  assert.match(endpoint, /\/api\/billing\/web\/ai-credits\/checkout-session\/resolve/);
  assert.match(transform, /invalid_web_ai_credit_recovery/);
  assert.match(screen, /completeWebAiCreditCheckout/);
  assert.match(screen, /reconcileWebAiCreditCheckout/);
  assert.match(screen, /savePendingWebAiCreditCheckout/);
  assert.match(screen, /usePwaUpdateCriticalSection/);
  assert.match(screen, /qk\.aiCredits/);
  assert.doesNotMatch(screen, /localStorage[^\n]*(?:paymentKey|orderId)/);
  assert.doesNotMatch(screen, /console\.(?:log|warn|error)\([^\n]*(?:paymentKey|orderId|customerKey)/);
});

test("PWA 결제 미확정·조회 냉각 응답은 pending을 보존하고 같은 동작에서 즉시 재조회하지 않는다", () => {
  const screen = read("src/screens/feature/AiCredit.tsx");
  assert.match(screen, /web_ai_credit_lookup_retry_later/);
  assert.match(screen, /web_ai_credit_lookup_rate_limited/);
  const paymentBranchStart = screen.indexOf("if (input.payment) {");
  const reconcileBranchStart = screen.indexOf("} else {", paymentBranchStart);
  assert.ok(paymentBranchStart >= 0 && reconcileBranchStart > paymentBranchStart);
  assert.doesNotMatch(
    screen.slice(paymentBranchStart, reconcileBranchStart),
    /reconcileWebAiCreditCheckout/,
  );
});

test("PWA 환불 사용분은 구매 전 팩별 상계량과 완료 뒤 실제 사용 가능 증가분을 숨김없이 표시한다", () => {
  const screen = read("src/screens/feature/AiCredit.tsx");
  const api = read("src/lib/api/endpoints/webBilling.ts");
  const balanceApi = read("src/lib/api/endpoints/ai.ts");
  assert.match(screen, /purchasedCreditDebt/);
  assert.match(screen, /resolveWebAiCreditDebtImpact/);
  assert.match(screen, /환불된 크레딧을 이미 사용한/);
  assert.match(screen, /result\.debtApplied/);
  assert.match(screen, /result\.availableCreditsAdded/);
  assert.match(api, /debtApplied:\s*number/);
  assert.match(api, /availableCreditsAdded:\s*number/);
  assert.match(balanceApi, /purchased_credit_debt/);
});

test("Android AI 크레딧은 기존 Google Play 상품 검증 경로를 유지한다", () => {
  const screen = read("src/screens/feature/AiCredit.tsx");
  const billing = read("src/lib/native/billing.ts");
  assert.match(screen, /launchCreditPurchase/);
  assert.match(billing, /AI_CREDIT_PRODUCTS/);
  assert.match(billing, /productType:\s*"inapp"/);
  assert.match(billing, /needsClientConsume/);
  assert.match(billing, /validateAiCreditGrantImpact/);
  assert.match(screen, /purchase\.debtApplied/);
  assert.match(screen, /purchase\.availableCreditsAdded/);
});
