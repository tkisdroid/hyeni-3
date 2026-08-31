import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

test("iPhone·웹 구독은 10개 locale에서 Android 전용 구매와 무료 이용을 안내한다", () => {
  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/billing.json`), "utf8"));
    assert.match(catalog["billing.subscription.web.androidOnlyFree"], /Android/i, locale);
    assert.match(catalog["billing.subscription.web.androidOnlyPremium"], /Android/i, locale);
    assert.match(catalog["billing.subscription.web.androidOnlyPremium"], /Google Play/i, locale);
  }
});

test("구독 화면은 iPhone·웹의 신규 결제 경로를 닫고 계정 상태별 안내를 렌더한다", () => {
  const source = readFileSync(resolve(rootDir, "src/screens/feature/Subscription.tsx"), "utf8");
  assert.match(source, /billing\.subscription\.web\.androidOnlyFree/);
  assert.match(source, /billing\.subscription\.web\.androidOnlyPremium/);
  assert.doesNotMatch(source, /startTossBillingAuthorization|createWebBillingCheckoutSession/);
});
