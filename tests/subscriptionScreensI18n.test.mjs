import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const subscription = read("src/screens/feature/Subscription.tsx");
const trialLock = read("src/screens/feature/TrialLock.tsx");
const koBilling = JSON.parse(read("locales/ko/billing.json"));

const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

function variables(message) {
  return [...message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .sort();
}

test("구독·체험 화면은 billing Intl 문구를 사용하고 부모 존댓말 정본을 유지한다", () => {
  assert.match(subscription, /useIntl\(\)/);
  assert.match(trialLock, /useIntl\(\)/);
  assert.match(subscription, /billing\.subscription\.title/);
  assert.match(subscription, /billing\.subscription\.safetyFree/);
  assert.match(trialLock, /billing\.trialLock\.title/);
  assert.match(trialLock, /billing\.trialLock\.safetyFree/);
  assert.equal(koBilling["billing.subscription.safetyFree"], "SOS와 긴급 안전 알림은 무료로 계속 제공돼요.");
  assert.equal(koBilling["billing.trialLock.safetyFree"], "SOS와 긴급 안전 알림은 무료로 계속 제공돼요.");
});

test("표시 가격은 공급자 formattedPrice에서만 오고 고정 금액·통화·basePlan 숫자를 UI 정본으로 쓰지 않는다", () => {
  assert.match(subscription, /webCatalog\?\.plans\.year\.displayPrice/);
  assert.match(subscription, /webCatalog\?\.plans\.month\.displayPrice/);
  assert.match(subscription, /annualOffer\?\.displayPrice/);
  assert.match(subscription, /monthlyOffer\?\.displayPrice/);
  assert.match(subscription, /formatProviderPrice/);
  assert.doesNotMatch(subscription, /(?:₩|\bKRW\b|\d[\d,]*원|월 환산)/);
  assert.doesNotMatch(subscription, /billing\.subscription\.[^"\n]*(?:2900|27840|4900|39000)/);
});

test("7일 체험은 현재 가족 자격과 정확한 공급자 7일 offer가 함께 확인될 때만 노출한다", () => {
  assert.match(subscription, /fetchGooglePlayTrialEligibility\(familyId\)/);
  assert.match(subscription, /allowTrial: playTrialEligible === true/);
  assert.match(
    subscription,
    /playTrialEligible === true && selectedOffer\?\.hasSevenDayTrial === true/,
  );
  assert.match(
    subscription,
    /webCatalog\?\.trialEligible === true && webCatalog\.trialDays === 7/,
  );
  assert.match(subscription, /selectedHasTrial[\s\S]*billing\.subscription\.cta\.trial/);
  assert.match(subscription, /!premiumActive && selectedHasTrial/);
});

test("PWA 웹 결제는 Google Play 결제·복원이 아니라는 한계를 숨기지 않는다", () => {
  assert.match(subscription, /isWebBillingChannel[\s\S]*billing\.subscription\.web\.noGooglePlay/);
  // 2026-08-17: 카드 발급국 제한은 바로 아래 domesticCardOnly 가 말하므로 중복 문장을 뺐다.
  assert.match(koBilling["billing.subscription.web.noGooglePlay"], /웹에서는 Google Play 결제·복원을 쓸 수 없어요/);
  assert.match(koBilling["billing.subscription.web.noGooglePlay"], /해외 카드는 Android 앱에서 결제/);
  // 카드 발급국 제한은 같은 영역의 domesticCardOnly 가 그대로 말한다(중복 제거 후에도 화면에서는 함께 보인다).
  assert.match(koBilling["billing.subscription.web.domesticCardOnly"], /대한민국에서 발급된 카드/);
  assert.match(subscription, /startTossBillingAuthorization/);
  assert.match(subscription, /billing\.subscription\.web\.domesticCardOnly/);
});

test("trial·active·grace·cancelled 정본과 해지 뒤 기간 종료일까지 유지 의미를 보존한다", () => {
  assert.match(subscription, /const premiumActive = ready && isPremium/);
  assert.match(subscription, /view\?\.status === "cancelled"/);
  assert.match(subscription, /view\.periodEnd[\s\S]*billing\.subscription\.cancelledUntil/);
  assert.match(subscription, /billing\.subscription\.activeUntil/);
  assert.match(trialLock, /ready && view\?\.isTrial/);
  assert.match(trialLock, /ready && isPremium && !view\?\.isTrial/);
  assert.match(trialLock, /ready && !isPremium/);
  assert.match(trialLock, /view\?\.status === "expired"/);
});

test("billing 문구는 10개 locale에 완전하고 영어 원문 폴백이 없다", () => {
  const catalogs = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(read(`locales/${locale}/billing.json`))]),
  );
  const english = catalogs.en;
  const ids = Object.keys(english).sort();

  assert.ok(ids.length >= 100, "구독·체험 화면 전체 문구를 담는 billing catalog가 필요합니다");
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), ids, `${locale} billing ID가 다릅니다`);
    for (const id of ids) {
      const value = catalogs[locale][id];
      assert.equal(typeof value, "string", `${locale}:${id}`);
      assert.ok(value.trim(), `${locale}:${id}가 비었습니다`);
      assert.deepEqual(variables(value), variables(english[id]), `${locale}:${id} ICU 변수가 다릅니다`);
      const languageBearingEnglish = english[id].replace(/\{[^{}]+\}/g, "");
      if (locale !== "en" && /[A-Za-z]{3}/.test(languageBearingEnglish) && !/Google Play|Android|PWA|AI|SOS|Free|Premium/i.test(english[id])) {
        assert.notEqual(value, english[id], `${locale}:${id}가 영어 fallback입니다`);
      }
    }
  }
});
