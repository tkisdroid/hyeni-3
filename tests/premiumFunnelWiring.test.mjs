import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("퍼널 코어는 메모리 전용 bounded queue와 무회전 best-effort 전송만 사용한다", () => {
  const funnel = read("src/lib/premiumFunnel.ts");
  const endpoint = read("src/lib/api/endpoints/premiumFunnel.ts");
  assert.doesNotMatch(funnel, /localStorage|sessionStorage|console\./);
  assert.doesNotMatch(funnel, /user_?id|family_?id|latitude|longitude|purchase_?token|order_?id|price|amount/i);
  assert.match(funnel, /MAX_BUFFERED_EVENTS\s*=\s*100/);
  assert.match(funnel, /MAX_TRANSPORT_BATCH_SIZE\s*=\s*20/);
  assert.match(funnel, /crypto\.randomUUID/);
  assert.match(funnel, /APP_VERSION/);
  assert.match(endpoint, /\/api\/premium-funnel\/events/);
  assert.match(endpoint, /apiRequest[\s\S]*false/);
  assert.doesNotMatch(endpoint, /localStorage|sessionStorage|familyId|userId/);
});

test("상황형 업셀은 노출·무료 계속·CTA를 source와 상업 티어로 기록한다", () => {
  const upsell = read("src/components/PremiumUpsell.tsx");
  assert.match(upsell, /event:\s*"paywall_impression"/);
  assert.match(upsell, /event:\s*"paywall_continue_free"/);
  assert.match(upsell, /event:\s*"paywall_cta"/);
  assert.match(upsell, /recordPremiumFunnelEvent/);
});

test("구독 화면은 사용자 행동만 기록하고 활성화·갱신·환불 정본을 주장하지 않는다", () => {
  const subscription = read("src/screens/feature/Subscription.tsx");
  assert.match(subscription, /event:\s*"subscription_view"/);
  assert.match(subscription, /event:\s*"product_query_result"/);
  assert.match(subscription, /event:\s*"checkout_start"/);
  assert.match(subscription, /event:\s*"checkout_result"/);
  assert.match(subscription, /event:\s*"subscription_cancel_requested"/);
  assert.doesNotMatch(subscription, /event:\s*"(?:entitlement_activated|trial_start|renewal|refund)"/);
  assert.doesNotMatch(subscription, /event:\s*"product_query_result"[\s\S]{0,120}success:/);
  assert.match(subscription, /classifyPremiumCheckoutFailure/);
});
