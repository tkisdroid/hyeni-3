import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
/**
 * 플로팅 AI 친구가 먼저 건넬 말의 재료(부모 메시지·다음 일정·못 챙긴 준비물).
 *
 * 이미 아이 홈·대화 화면이 쓰는 것과 **같은 query key** 로 조회하므로 캐시를 함께 쓴다
 * (버튼이 떠 있다는 이유로 같은 데이터를 두 번 받지 않는다).
 * AI 친구가 꺼져 있는 가족에서는 아예 조회하지 않는다 — 열 수 없는 대화를 위한 통신은 낭비다.
 */
import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { qk } from "./keys";
import { fetchEvents, fetchDailySupplies } from "@/lib/api/endpoints/schedule";
import { fetchMemoReplies } from "@/lib/api/endpoints/memo";
import { useMyFamily } from "./useFamily";
import { useRecentDateKeys } from "@/app/useRecentDateKeys";

import { dateToDateKeyInTimeZone } from "@/transform/dateKey";
import { useLocale } from "@/i18n/useLocale";
import { filterEventsForChild } from "@/transform/eventScope";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import {
  EMPTY_AI_BUDDY_NUDGE_INPUT,
  type AiBuddyNudgeInput,
} from "@/transform/aiBuddyNudge";
import {
  latestParentMemoText,
  unreadParentMemoCount,
} from "@/transform/childHomeData";

/** 부모 메시지는 어제 것까지 본다 — 밤에 온 메시지를 아침에 놓치지 않게. */
const MEMO_DAYS = 2;

export function useAiBuddyNudgeInput(enabled: boolean): AiBuddyNudgeInput {
  const familyTimeZone = useFamilyTimeZone();
  const { familyId, userId, status } = useAuth();
  const { locale } = useLocale();
  const intl = useIntl();
  const { data: family } = useMyFamily();
  const myMemberId = userId
    ? family?.members.find((m) => m.role === "child" && m.user_id === userId)?.id ?? null
    : null;

  const authed = enabled && status === "authenticated" && !!familyId;
  const memoDateKeys = useRecentDateKeys(MEMO_DAYS, familyTimeZone);
  const todayKey = memoDateKeys[0] ?? dateToDateKeyInTimeZone(new Date(), familyTimeZone);

  const memoQuery = useQuery({
    queryKey: qk.memoReplies(familyId ?? "", memoDateKeys.join(","), myMemberId),
    queryFn: () => fetchMemoReplies(familyId as string, memoDateKeys, myMemberId as string),
    enabled: authed && !!myMemberId && memoDateKeys.length > 0,
  });
  const eventsQuery = useQuery({
    queryKey: qk.events(familyId ?? ""),
    queryFn: () => fetchEvents(familyId as string),
    enabled: authed,
  });
  const suppliesQuery = useQuery({
    queryKey: qk.dailySupplies(familyId ?? "", todayKey),
    queryFn: () => fetchDailySupplies(familyId as string, todayKey),
    enabled: authed,
  });

  const events = eventsQuery.data;
  const supplies = suppliesQuery.data;
  const memos = memoQuery.data;

  return useMemo<AiBuddyNudgeInput>(() => {
    if (!enabled) return EMPTY_AI_BUDDY_NUDGE_INPUT;
    // 다음 일정 판정은 대화 화면과 같은 계산을 쓴다 — 홈과 대화가 다른 일정을 말하면 안 된다.
    const todays = groupEventsByDateKey(
      filterEventsForChild(events ?? [], myMemberId),
      new Date(),
      locale,
      familyTimeZone,
      undefined,
      undefined,
      intl,
    )[todayKey] ?? [];
    const nextEvent = todays.find((e) => !PAST_TAGS.has(e.tag)) ?? null;
    const pendingSupplies = (supplies ?? [])
      .filter((s) => (myMemberId ? s.child_user_id === myMemberId : false) && !s.done)
      .map((s) => s.label);
    return {
      unreadParentMessages: unreadParentMemoCount(memos, userId),
      parentMessagePreview: latestParentMemoText(memos, undefined, intl),
      nextEventTitle: nextEvent?.title ?? null,
      nextEventTime: nextEvent?.time ?? null,
      pendingSupplies,
    };
  }, [familyTimeZone, enabled, events, intl, locale, memos, myMemberId, supplies, todayKey, userId]);
}
