import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("PWA 결제는 서버 checkout session과 Toss SDK 인증을 사용자 CTA에서만 시작한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  const sdk = read("src/lib/webBilling.ts");
  assert.match(screen, /getPlatform\(\) === "web"/);
  assert.match(screen, /await createWebBillingCheckoutSession\(\{ familyId, plan, trialExpected \}\)/);
  assert.match(screen, /validateWebBillingCheckoutSession\(rawSession, plan, trialExpected\)/);
  assert.match(screen, /savePendingWebBilling/);
  assert.match(screen, /await startTossBillingAuthorization/);
  assert.match(sdk, /https:\/\/js\.tosspayments\.com\/v2\/standard/);
  assert.match(sdk, /requestBillingAuth/);
  assert.match(sdk, /method:\s*"CARD"/);
  assert.match(sdk, /windowTarget:\s*"self"/);
  assert.doesNotMatch(sdk, /queueMicrotask\(finish\)/, "기존 SDK 태그가 로딩 중일 때 즉시 실패하면 안 됩니다");
});

test("PWA 7일 체험 문구는 서버 catalog이 true·7일을 동시에 확정한 경우에만 노출한다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  const transform = read("src/transform/webBilling.ts");
  const endpoint = read("src/lib/api/endpoints/webBilling.ts");
  assert.match(screen, /webCatalog\?\.trialEligible === true && webCatalog\.trialDays === 7/);
  assert.match(endpoint, /trialExpected:\s*boolean/);
  assert.match(transform, /record\.trialEligible \? record\.trialDays !== 7 : record\.trialDays !== 0/);
  assert.match(screen, /billing\.subscription\.web\.firstCharge/);
  const koBilling = JSON.parse(read("locales/ko/billing.json"));
  assert.match(koBilling["billing.subscription.web.firstCharge"], /지금은 청구하지 않고, 정확히 7일 후/);
});

test("PWA 결제 상품 조회 실패는 화면 안에서 다시 시도할 수 있다", () => {
  const screen = read("src/screens/feature/Subscription.tsx");
  const css = read("src/screens/feature/Subscription.css");
  assert.match(screen, /const retryWebCatalog = \(\) => setWebCatalogRetryNonce\(\(value\) => value \+ 1\)/);
  assert.match(screen, /webCatalogRetryNonce/);
  assert.match(
    screen,
    /webCatalogUnavailable[\s\S]*?onClick=\{retryWebCatalog\}[\s\S]*?core\.action\.retry/,
  );
  assert.match(screen, /sub-web-unavailable__retry hy-section-action hy-press/);
  assert.match(
    css,
    /\.sub-screen \.sub-web-unavailable \.sub-web-unavailable__retry\s*\{[^}]*min-width: var\(--control-min-size\)/s,
  );
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
  assert.match(screen, /if \(isWebBillingChannel\)[\s\S]*?return;[\s\S]*?if \(!isBillingAvailable\(\)\)/);
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
