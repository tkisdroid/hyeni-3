import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const androidOnlyPolicySql = readFileSync(
  new URL("../db/android-only-payment-policy.sql", import.meta.url),
  "utf8",
);

test("신규 결제 운영 제어 문서는 fail-closed와 기존 주문 처리 불변식을 명시한다", () => {
  assert.match(readme, /신규 결제 운영 제어/);
  assert.match(readme, /`app_global_settings`의 단일 행 `commerce_runtime_controls_v1`/);
  assert.doesNotMatch(readme, /`global_settings`/);
  assert.match(readme, /commerce_runtime_controls_v1/);
  assert.match(readme, /행 누락·형식 오류·D1 조회 오류[^\r\n]*OFF/);
  assert.match(readme, /기존 주문의 완료·대사·해지·환불[^\r\n]*영향/);
  assert.match(readme, /두 값은 운영에서 항상 OFF/);
  assert.match(readme, /정책 변경 승인 없이 ON으로 바꾸지 않는다/);
  assert.match(readme, /사고[^\r\n]*즉시[^\r\n]*OFF/);
  assert.doesNotMatch(readme, /Bearer\s+[A-Za-z0-9._-]+/);
});

test("Android 전용 결제 운영 SQL은 두 웹 신규 결제 스위치를 멱등하게 OFF로 고정한다", () => {
  assert.match(androidOnlyPolicySql, /commerce_runtime_controls_v1/);
  assert.match(androidOnlyPolicySql, /"webSubscriptionNewCheckoutsEnabled":false/);
  assert.match(androidOnlyPolicySql, /"webAiCreditNewCheckoutsEnabled":false/);
  assert.match(androidOnlyPolicySql, /ON CONFLICT\(key\) DO UPDATE/);
});
