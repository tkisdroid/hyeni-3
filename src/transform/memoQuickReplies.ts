import type { IntlShape } from "react-intl";
import { withDefaultIntl, defaultKoreanIntl } from "../i18n/defaultIntl.ts";

/**
 * 대화 화면의 빠른 답장 문구 — 보내는 사람(role)에 따라 갈린다.
 *
 * 이전에는 부모용 문구("지금 어디야?", "숙제는 했어?")가 아이 화면에도 그대로 떴다.
 * 아이가 부모에게 물을 말이 아니라 부모가 아이에게 묻는 말이라 문맥이 어긋난다.
 *
 * 말투: 가족 간 대화라 양쪽 모두 반말. 아이 문구는 ChildHome 의 원탭 상태 공유
 * (도착했어·출발했어·데리러 와 줘 …)와 겹치지 않는 "대화" 성격으로 고른다.
 */
export type MemoQuickReplyRole = "parent" | "child" | "teacher" | null | undefined;

/** 부모 → 아이. */
export const PARENT_QUICK_REPLY_IDS = [1, 2, 3, 4, 5] as const;

/** 아이 → 부모. */
export const CHILD_QUICK_REPLY_IDS = [1, 2, 3, 4, 5] as const;

/** 기존 순수 transform 소비자를 위한 한국어 기본값. 화면에서는 현재 locale의 Intl을 사용한다. */
export const PARENT_QUICK_REPLIES = PARENT_QUICK_REPLY_IDS.map((index) =>
  defaultKoreanIntl.formatMessage({ id: `shared.memo.quick.parent.${index}` }),
);
export const CHILD_QUICK_REPLIES = CHILD_QUICK_REPLY_IDS.map((index) =>
  defaultKoreanIntl.formatMessage({ id: `shared.memo.quick.child.${index}` }),
);

export function resolveMemoQuickReplies(role: MemoQuickReplyRole, providedIntl?: IntlShape): readonly string[] {
  const intl = withDefaultIntl(providedIntl);
  const sender = role === "child" ? "child" : "parent";
  const ids = role === "child" ? CHILD_QUICK_REPLY_IDS : PARENT_QUICK_REPLY_IDS;
  return ids.map((index) => intl.formatMessage({ id: `shared.memo.quick.${sender}.${index}` }));
}
