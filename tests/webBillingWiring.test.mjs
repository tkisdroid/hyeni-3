import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("iPhone·웹 구독 화면은 새 결제를 열지 않고 Android 전용 안내만 표시한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  assert.match(screen, /resolveSubscriptionPurchasePolicy/);
  assert.match(screen, /billing\.subscription\.web\.androidOnlyFree/);
  assert.match(screen, /billing\.subscription\.web\.androidOnlyPremium/);
  assert.doesNotMatch(screen, /createWebBillingCheckoutSession/);
  assert.doesNotMatch(screen, /startTossBillingAuthorization/);
  assert.doesNotMatch(screen, /fetchWebBillingCatalog/);
});

test("iPhone·웹 안내는 무료 이용과 Android 구독의 교차 기기 이용을 정확히 설명한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  const koBilling = JSON.parse(read("locales/ko/billing.json"));
  assert.equal(
    koBilling["billing.subscription.web.androidOnlyFree"],
    "현재 구독은 Android 앱에서만 가능해요. iPhone·웹에서는 무료 기능을 이용할 수 있어요.",
  );
  assert.equal(
    koBilling["billing.subscription.web.androidOnlyPremium"],
    "Android에서 구독한 프리미엄을 이 계정에서도 이용 중이에요. 구독 관리는 Android 앱의 Google Play에서 해 주세요.",
  );
});

test("Android 구독 화면은 Google Play 구매 CTA를 유지한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  assert.match(screen, /launchSubscriptionPurchase/);
  assert.match(screen, /purchasePolicy\.canPurchase/);
});

test("웹 결제 복귀는 authKey를 주소에서 지운 뒤 pending 또는 서버 세션을 대조해 완료한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  const endpoint = read("src/lib/api/endpoints/webBilling.ts");
  assert.match(screen, /clearWebBillingRedirectQuery\(window\.location\.href\)/);
  assert.match(screen, /window\.history\.replaceState/);
  assert.match(screen, /pending\?\.customerKey === billingRedirect\.customerKey/);
  assert.match(screen, /resolveWebBillingCheckoutSession/);
  assert.match(screen, /validateRecoveredWebBillingCheckoutSession/);
  assert.match(endpoint, /\/api\/billing\/web\/checkout-session\/resolve/);
  assert.match(screen, /completeWebBillingCheckout/);
  assert.match(screen, /clearPendingWebBilling/);
  assert.doesNotMatch(screen, /console\.(?:log|warn|error)\([^\n]*(?:authKey|customerKey)/);
});

test("결제 응답 유실은 pending을 보존하고 authKey 없이 같은 주문을 제한적으로 재대사한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  assert.match(screen, /web_billing_reconciliation_pending/);
  assert.match(screen, /billing_provider_reconciliation_pending/);
  assert.match(screen, /webReconcileAttemptRef\.current\s*>=\s*6/);
  assert.match(screen, /authKey:\s*""/);
  assert.match(screen, /24 \* 60 \* 60_000/);
  assert.match(screen, /billing\.subscription\.cta\.reconcile/);
});

test("Android 채널은 Google Play 가격을 재조회·검증하고 웹 결제 CTA로 우회하지 않는다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  assert.match(screen, /if \(!purchasePolicy\.canPurchase\)[\s\S]*?return;[\s\S]*?if \(!isBillingAvailable\(\)\)/);
  assert.match(screen, /freshProductDetails = await fetchSubscriptionProductDetails\(\)/);
  assert.match(screen, /hasExpectedLaunchSubscriptionPrice\(freshSelectedOffer\)/);
  assert.match(screen, /launchSubscriptionPurchase/);
  assert.match(
    screen,
    /if \(!freshSelectedOffer\) \{\s*throw new BillingError\("product_unavailable"\);\s*\}/,
  );
  assert.match(
    screen,
    /if \(!hasExpectedLaunchSubscriptionPrice\(freshSelectedOffer\)\) \{\s*throw new BillingError\("product_unavailable"\);\s*\}/,
  );
});

test("Toss 웹 구독은 기간말 해지 예약을 앱 안에서 처리하고 Play 구독과 관리 경로를 분리한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  assert.match(screen, /view\?\.provider === "toss_web"/);
  assert.match(screen, /cancelWebBillingSubscription/);
  assert.match(screen, /billing\.subscription\.cancel\.confirm/);
  assert.match(screen, /play\.google\.com\/store\/account\/subscriptions/);
});
