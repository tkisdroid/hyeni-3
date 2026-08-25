import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIntl, createIntlCache, type IntlShape } from "react-intl";
import { resolveParentHomeSubscriptionCard } from "../src/transform/parentHomeSubscriptionCard.ts";

// 카드 문구는 locale catalog 가 정본이므로 한국어 카탈로그로 intl 을 만들어 검증한다.
const koParent = JSON.parse(
  readFileSync(new URL("../locales/ko/parent.json", import.meta.url), "utf8"),
) as Record<string, string>;
const koIntl = createIntl({ locale: "ko", messages: koParent }, createIntlCache()) as IntlShape;

test("무료 가족은 프리미엄 혜택을 확인하는 카드로 안내한다", () => {
  assert.deepEqual(resolveParentHomeSubscriptionCard({
    ready: true,
    isError: false,
    isPremium: false,
    planLabel: "무료 플랜",
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: null,
  }, koIntl, "ko"), {
    title: "구독 시 혜택",
    description: "실시간 위치와 더 넉넉한 가족 기능을 확인해 보세요",
    meta: "현재 무료 플랜",
    tone: "benefits",
    actionLabel: "혜택 보기",
  });
});

test("프리미엄 가족은 구독 상품과 이용 종료일을 관리 카드에 표시한다", () => {
  assert.deepEqual(resolveParentHomeSubscriptionCard({
    ready: true,
    isError: false,
    isPremium: true,
    planLabel: "프리미엄 월간 구독",
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: new Date("2026-09-30T15:00:00.000Z"),
  }, koIntl, "ko"), {
    title: "구독 관리",
    description: "프리미엄 월간 구독",
    meta: "2026년 10월 1일까지 이용",
    tone: "manage",
    actionLabel: "관리하기",
  });
});

test("무료 체험 중인 가족은 남은 일수를 우선 표시한다", () => {
  assert.deepEqual(resolveParentHomeSubscriptionCard({
    ready: true,
    isError: false,
    isPremium: true,
    planLabel: "프리미엄 무료 체험",
    isTrial: true,
    trialDaysLeft: 3,
    periodEnd: new Date("2026-09-30T15:00:00.000Z"),
  }, koIntl, "ko"), {
    title: "구독 관리",
    description: "프리미엄 무료 체험",
    meta: "무료 체험 3일 남음",
    tone: "manage",
    actionLabel: "관리하기",
  });
});

test("엔타이틀먼트 미확정과 오류는 무료 플랜으로 강등하지 않는다", () => {
  const loading = resolveParentHomeSubscriptionCard({
    ready: false,
    isError: false,
    isPremium: false,
    planLabel: null,
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: null,
  }, koIntl, "ko");
  const failed = resolveParentHomeSubscriptionCard({
    ready: false,
    isError: true,
    isPremium: false,
    planLabel: null,
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: null,
  }, koIntl, "ko");

  assert.deepEqual(loading, {
    title: "구독 정보",
    description: "이용 상태를 확인하고 있어요",
    meta: "확인 후 정확한 정보를 보여드릴게요",
    tone: "neutral",
    actionLabel: "확인하기",
  });
  assert.deepEqual(failed, {
    title: "구독 정보",
    description: "이용 상태를 확인하지 못했어요",
    meta: "구독 화면에서 다시 확인할 수 있어요",
    tone: "neutral",
    actionLabel: "확인하기",
  });
  assert.notEqual(loading.title, "구독 시 혜택");
  assert.notEqual(failed.meta, "현재 무료 플랜");
});

test("캐시된 프리미엄 정본이 있으면 재조회 오류에도 관리 상태를 유지한다", () => {
  const view = resolveParentHomeSubscriptionCard({
    ready: true,
    isError: true,
    isPremium: true,
    planLabel: "프리미엄 구독",
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: null,
  }, koIntl, "ko");

  assert.equal(view.title, "구독 관리");
  assert.equal(view.meta, "프리미엄 이용 중");
});
