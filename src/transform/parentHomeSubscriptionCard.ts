import type { IntlShape } from "react-intl";
import type { MessageId } from "../i18n/generated/messageIds.ts";
import { formatDateTime, LEGACY_FAMILY_TIME_ZONE } from "../i18n/format.ts";
import type { SupportedLocale } from "../i18n/locale.ts";

export type ParentHomeSubscriptionCardTone = "benefits" | "manage" | "neutral";

export interface ParentHomeSubscriptionCardInput {
  ready: boolean;
  isError: boolean;
  isPremium: boolean;
  planLabel: string | null;
  isTrial: boolean;
  trialDaysLeft: number | null;
  periodEnd: Date | null;
}

export interface ParentHomeSubscriptionCardView {
  title: string;
  description: string;
  meta: string;
  tone: ParentHomeSubscriptionCardTone;
  /** 화면에 그대로 렌더하는 행동 라벨. 톤은 tone 이, 문구는 catalog 가 정한다. */
  actionLabel: string;
}

const ID = "parent.home.subscriptionCard.";

function message(intl: IntlShape, key: string, values?: Record<string, string | number>): string {
  return intl.formatMessage({ id: `${ID}${key}` as MessageId }, values);
}

/**
 * 종료일은 언어에 맞춰 표시한다. 시간대는 가족 time zone 이관 전이라
 * 기존 `Asia/Seoul` 표시 계약을 그대로 유지한다(이 계획에서 시간 의미를 바꾸지 않는다).
 */
function formatPeriodEnd(periodEnd: Date | null, locale: SupportedLocale): string | null {
  if (!periodEnd || !Number.isFinite(periodEnd.getTime())) return null;
  return formatDateTime(periodEnd, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    dateStyle: "long",
  });
}

function premiumMeta(
  input: ParentHomeSubscriptionCardInput,
  intl: IntlShape,
  locale: SupportedLocale,
): string {
  if (
    input.isTrial
    && input.trialDaysLeft !== null
    && Number.isFinite(input.trialDaysLeft)
    && input.trialDaysLeft >= 0
  ) {
    return input.trialDaysLeft === 0
      ? message(intl, "meta.trialEndsToday")
      : message(intl, "meta.trialDaysLeft", { days: Math.ceil(input.trialDaysLeft) });
  }
  const periodEnd = formatPeriodEnd(input.periodEnd, locale);
  return periodEnd ? message(intl, "meta.until", { date: periodEnd }) : message(intl, "meta.active");
}

/** 부모 홈의 구독 진입 카피. 미확정 상태를 Free로 추정하지 않는다. */
export function resolveParentHomeSubscriptionCard(
  input: ParentHomeSubscriptionCardInput,
  intl: IntlShape,
  locale: SupportedLocale,
): ParentHomeSubscriptionCardView {
  if (!input.ready) {
    return {
      title: message(intl, "pending.title"),
      description: message(intl, input.isError ? "pending.descriptionError" : "pending.descriptionLoading"),
      meta: message(intl, input.isError ? "pending.metaError" : "pending.metaLoading"),
      tone: "neutral",
      actionLabel: message(intl, "pending.action"),
    };
  }

  if (!input.isPremium) {
    return {
      title: message(intl, "benefits.title"),
      description: message(intl, "benefits.description"),
      meta: message(intl, "benefits.meta"),
      tone: "benefits",
      actionLabel: message(intl, "benefits.action"),
    };
  }

  return {
    title: message(intl, "manage.title"),
    description: input.planLabel?.trim() || message(intl, "manage.description"),
    meta: premiumMeta(input, intl, locale),
    tone: "manage",
    actionLabel: message(intl, "manage.action"),
  };
}
