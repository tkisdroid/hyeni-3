import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

test("구독과 체험 화면은 부모 role 가드 안에 있어 아이가 결제창을 열 수 없다", () => {
  const app = read("src/app/App.tsx");
  const pushStart = app.indexOf("element: <PushShell />");
  const parentGuard = app.indexOf('element: <RequireRole role="parent" />', pushStart);
  const subscriptionRoute = app.indexOf('path: "subscription"', pushStart);
  const trialRoute = app.indexOf('path: "trial-lock"', pushStart);
  assert.ok(pushStart >= 0 && parentGuard > pushStart, "PushShell 안에 부모 role 가드가 없습니다");
  assert.ok(parentGuard < subscriptionRoute && parentGuard < trialRoute, "구독 라우트가 부모 role 가드 밖에 있습니다");
});

test("Android 결제 UI는 Google Play 공급자 가격만 쓰고 확인되지 않은 가격과 할인율을 약속하지 않는다", () => {
  const subscription = read("src/screens/feature/Subscription.tsx");
  const pairing = read("src/screens/feature/PairingWizard.tsx");
  const credits = read("src/screens/feature/AiCredit.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  const koBilling = JSON.parse(read("locales/ko/billing.json"));
  assert.doesNotMatch(subscription, /40% 할인|29,000|2,417원|월 2,900원으로 시작하기/);
  assert.doesNotMatch(pairing, /2,900원|아이별 월|₩[0-9,]+/);
  assert.match(pairing, /parent\.pairingWizard\.firstFree/);
  assert.equal(koParent["parent.pairingWizard.firstFree"], "첫째 아이는 무료, 둘째부터는 프리미엄이에요.");
  assert.doesNotMatch(credits, /₩[0-9,]+/);
  assert.match(credits, /billing\.aiCredit\.native\.providerNotice/);
  assert.match(credits, /billing\.aiCredit\.packs\.pricePending/);
  assert.doesNotMatch(credits, /billing\.aiCredit\.serverCatalogPrice/);
  assert.equal(
    koBilling["billing.aiCredit.native.providerNotice"],
    "Android 앱에서는 Google Play가 실제 가격과 결제 가능 여부를 확인해요.",
  );
  assert.match(subscription, /fetchSubscriptionProductDetails/);
  assert.doesNotMatch(subscription, /fetchWebBillingCatalog/);
  assert.doesNotMatch(subscription, /validateWebBillingCatalog/);
  assert.match(subscription, /selectedDisplayPrice/);
  assert.match(subscription, /selectedHasTrial/);
  assert.match(subscription, /hasExpectedLaunchSubscriptionPrice/);
  assert.match(subscription, /billing\.subscription\.trial\.googleFree/);
  assert.match(subscription, /billing\.subscription\.trial\.googleCancel/);
  assert.match(koBilling["billing.subscription.trial.googleFree"], /결제 정보 등록 후 7일 동안 무료/);
  assert.match(koBilling["billing.subscription.trial.googleCancel"], /Google Play에서 체험 종료 전에 취소/);
  assert.doesNotMatch(subscription, /(?:₩|\bKRW\b|\d[\d,]*원|월 환산)/);
});

test("네이티브 결제는 조회한 offerToken과 offerId를 그대로 구매·서버 검증에 전달한다", () => {
  const billing = read("src/lib/native/billing.ts");
  const subscription = read("src/screens/feature/Subscription.tsx");
  const java = read("android/app/src/main/java/com/hyeni/calendar/GooglePlayBillingPlugin.java");
  assert.match(billing, /queryProducts\(opts:/);
  assert.match(subscription, /await fetchSubscriptionProductDetails\(\)/);
  assert.match(subscription, /selectSubscriptionOffer\(freshProductDetails, basePlanId,[\s\S]*allowTrial:/);
  assert.match(subscription, /if \(!freshSelectedOffer\)/);
  assert.match(billing, /offerToken:\s*purchaseOffer\.offerToken/);
  assert.match(billing, /offerId:\s*purchaseOffer\.offerId/);
  assert.match(
    billing,
    /offerToken:\s*purchaseOffer\.offerToken,\s*offerId:\s*purchaseOffer\.offerId,[^}]*purchaseToken:/s,
  );
  assert.match(billing, /if \(!selectedOffer\)/);
  assert.match(java, /call\.getString\("offerToken"/);
  assert.match(java, /call\.getString\("offerId"/);
  assert.match(java, /pickOfferToken\(productDetails, productType, basePlanId, offerToken, offerId\)/);
  assert.doesNotMatch(java, /for \(ProductDetails\.SubscriptionOfferDetails offer : offers\) \{\s*if \(!TextUtils\.isEmpty\(basePlanId\).*return offer\.getOfferToken\(\);/s);
  assert.match(java, /put\("billingCycleCount", phase\.getBillingCycleCount\(\)\)/);
  assert.match(billing, /accountId:\s*familyId/);
  assert.match(billing, /profileId:\s*parentId/);
  assert.match(java, /setObfuscatedAccountId/);
  assert.match(java, /setObfuscatedProfileId/);
});

test("체험 종료 화면은 무료 안전 기능을 프리미엄 혜택으로 판매하지 않는다", () => {
  const trial = read("src/screens/feature/TrialLock.tsx");
  const koBilling = JSON.parse(read("locales/ko/billing.json"));
  assert.doesNotMatch(trial, /도착 · 위험구역 · 안전 알림 전체/);
  assert.doesNotMatch(trial, /위치·안전·AI 기능을 모두 다시/);
  assert.match(trial, /billing\.trialLock\.safetyFree/);
  assert.match(koBilling["billing.trialLock.safetyFree"], /SOS와 긴급 안전 알림은 무료로 계속 제공/);
});

test("부모 설정은 리뷰 혜택을 무료로 오표기하지 않고 합성 tier 라벨을 쓴다", () => {
  const settings = read("src/screens/parent/ParentSettings.tsx");
  assert.match(settings, /const entitlementQuery = useEntitlement\(\)/);
  assert.match(settings, /const \{ ready, tier \} = entitlementQuery/);
  assert.match(settings, /getTierLabel\(tier, intl\)/);
  assert.doesNotMatch(settings, /\{view\.tierLabel\}/);
});

test("부모 앱 foreground는 기존 Play 구독을 서버 재검증해 자동갱신 종료일을 동기화한다", () => {
  const billing = read("src/lib/native/billing.ts");
  const bootstrap = read("src/app/NativeBootstrap.tsx");
  assert.match(billing, /export async function restoreGooglePlaySubscriptions/);
  assert.match(billing, /queryGooglePlayPurchases\(\)/);
  assert.match(billing, /restore:\s*true/);
  assert.match(billing, /purchaseState === "PURCHASED"/);
  assert.match(bootstrap, /restoreGooglePlaySubscriptions\(familyId\)/);
  assert.match(bootstrap, /appStateChange/);
});

test("해지 예약된 Play 구독도 관리 화면을 다시 열 수 있고 웹 해지 예약만 중복 동작을 막는다", () => {
  const subscription = read("src/screens/feature/Subscription.tsx");
  assert.match(
    subscription,
    /const webCancellationScheduled = view\?\.provider === "toss_web" && view\?\.status === "cancelled"/,
  );
  assert.match(subscription, /disabled=\{busy \|\| webCancellationScheduled\}/);
  assert.doesNotMatch(subscription, /disabled=\{busy \|\| view\?\.status === "cancelled"\}/);
});

test("Google Play checkout은 결제창 전에 provider preflight하고 취소·Billing 실패만 정확한 lease를 해제한다", () => {
  const billing = read("src/lib/native/billing.ts");
  const preflight = billing.indexOf("await reserveGooglePlaySubscription");
  const authoritativeOffer = billing.indexOf("allowTrial: preflight.trialEligible", preflight);
  const purchase = billing.indexOf("await plugin.purchaseSubscription", authoritativeOffer);
  const verify = billing.indexOf("const verification = await verifyPurchase", purchase);
  assert.ok(
    preflight >= 0 && authoritativeOffer > preflight && purchase > authoritativeOffer && verify > purchase,
    "서버 preflight 판정으로 최종 offer를 다시 고른 뒤에만 Billing을 열어야 합니다",
  );
  assert.match(billing, /providerReservationRef: preflight\.reservationRef/);
  assert.match(billing, /await releaseGooglePlaySubscriptionReservation\(familyId, preflight\.reservationRef\)/);
  assert.match(billing, /trialEligible/);
  assert.match(billing, /selectSubscriptionOffer\(productDetails, basePlanId, \{\s*allowTrial: preflight\.trialEligible/s);
  assert.doesNotMatch(
    billing.slice(verify),
    /releaseGooglePlaySubscriptionReservation\(familyId, preflight\.reservationRef\)/,
    "구매 성공 후 verify 네트워크 유실은 lease를 풀지 않고 restore·RTDN 복구에 맡겨야 합니다",
  );
});

test("구독 화면은 가족 trial eligibility가 false면 7일 체험 문구와 offer 선택을 함께 닫는다", () => {
  const subscription = read("src/screens/feature/Subscription.tsx");
  assert.match(subscription, /fetchGooglePlayTrialEligibility\(familyId\)/);
  assert.match(subscription, /allowTrial: playTrialEligible === true/);
  assert.match(subscription, /playTrialEligible === true && selectedOffer\?\.hasSevenDayTrial === true/);
  assert.match(subscription, /productDetails: freshProductDetails/);
});
