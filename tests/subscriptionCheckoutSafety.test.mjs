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

test("구독 UI는 실제 Google Play offer 가격만 쓰고 확인되지 않은 가격과 할인율을 약속하지 않는다", () => {
  const subscription = read("src/screens/feature/Subscription.tsx");
  const pairing = read("src/screens/feature/PairingWizard.tsx");
  const credits = read("src/screens/feature/AiCredit.tsx");
  assert.doesNotMatch(subscription, /40% 할인|29,000|2,417원|월 2,900원으로 시작하기/);
  assert.doesNotMatch(pairing, /2,900원|아이별 월|₩[0-9,]+/);
  assert.match(pairing, /두 번째 아이는 프리미엄에서 연결할 수 있어요/);
  assert.doesNotMatch(credits, /₩[0-9,]+/);
  assert.match(credits, /Google Play에서 확인/);
  assert.match(subscription, /fetchSubscriptionProductDetails/);
  assert.match(subscription, /selectedOffer\?\.displayPrice/);
  assert.match(subscription, /selectedOffer\?\.hasSevenDayTrial/);
  assert.match(subscription, /결제 정보 등록 후 7일 동안 무료/);
  assert.match(subscription, /Google Play에서 체험 종료 전에 취소/);
});

test("네이티브 결제는 조회한 offerToken과 offerId를 그대로 구매·서버 검증에 전달한다", () => {
  const billing = read("src/lib/native/billing.ts");
  const subscription = read("src/screens/feature/Subscription.tsx");
  const java = read("android/app/src/main/java/com/hyeni/calendar/GooglePlayBillingPlugin.java");
  assert.match(billing, /queryProducts\(opts:/);
  assert.match(subscription, /await fetchSubscriptionProductDetails\(\)/);
  assert.match(subscription, /selectSubscriptionOffer\(freshProductDetails, basePlanId\)/);
  assert.match(subscription, /if \(!freshSelectedOffer\)/);
  assert.match(billing, /offerToken:\s*selectedOffer\?\.offerToken/);
  assert.match(billing, /offerId:\s*selectedOffer\?\.offerId/);
  assert.match(
    billing,
    /offerToken:\s*selectedOffer\?\.offerToken\s*\?\?\s*null,\s*offerId:\s*selectedOffer\?\.offerId[^}]*purchaseToken:/s,
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
  assert.doesNotMatch(trial, /도착 · 위험구역 · 안전 알림 전체/);
  assert.doesNotMatch(trial, /위치·안전·AI 기능을 모두 다시/);
  assert.match(trial, /SOS와 긴급 안전 알림은 무료로 계속 제공/);
});

test("부모 설정은 리뷰 혜택을 무료로 오표기하지 않고 합성 tier 라벨을 쓴다", () => {
  const settings = read("src/screens/parent/ParentSettings.tsx");
  assert.match(settings, /const entitlementQuery = useEntitlement\(\)/);
  assert.match(settings, /const \{ ready, tier \} = entitlementQuery/);
  assert.match(settings, /getTierLabel\(tier\)/);
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
