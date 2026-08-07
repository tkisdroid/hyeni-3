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
  actionLabel: "혜택 보기" | "관리하기" | "확인하기";
}

function formatPeriodEnd(periodEnd: Date | null): string | null {
  if (!periodEnd || !Number.isFinite(periodEnd.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(periodEnd);
}

function premiumMeta(input: ParentHomeSubscriptionCardInput): string {
  if (
    input.isTrial
    && input.trialDaysLeft !== null
    && Number.isFinite(input.trialDaysLeft)
    && input.trialDaysLeft >= 0
  ) {
    return input.trialDaysLeft === 0
      ? "무료 체험이 오늘 종료돼요"
      : `무료 체험 ${Math.ceil(input.trialDaysLeft)}일 남음`;
  }
  const periodEnd = formatPeriodEnd(input.periodEnd);
  return periodEnd ? `${periodEnd}까지 이용` : "프리미엄 이용 중";
}

/** 부모 홈의 구독 진입 카피. 미확정 상태를 Free로 추정하지 않는다. */
export function resolveParentHomeSubscriptionCard(
  input: ParentHomeSubscriptionCardInput,
): ParentHomeSubscriptionCardView {
  if (!input.ready) {
    return {
      title: "구독 정보",
      description: input.isError
        ? "이용 상태를 확인하지 못했어요"
        : "이용 상태를 확인하고 있어요",
      meta: input.isError
        ? "구독 화면에서 다시 확인할 수 있어요"
        : "확인 후 정확한 정보를 보여드릴게요",
      tone: "neutral",
      actionLabel: "확인하기",
    };
  }

  if (!input.isPremium) {
    return {
      title: "구독 시 혜택",
      description: "실시간 위치와 더 넉넉한 가족 기능을 확인해 보세요",
      meta: "현재 무료 플랜",
      tone: "benefits",
      actionLabel: "혜택 보기",
    };
  }

  return {
    title: "구독 관리",
    description: input.planLabel?.trim() || "프리미엄 구독",
    meta: premiumMeta(input),
    tone: "manage",
    actionLabel: "관리하기",
  };
}
