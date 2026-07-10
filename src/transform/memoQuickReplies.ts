/**
 * 대화 화면의 빠른 답장 문구 — 보내는 사람(role)에 따라 갈린다.
 *
 * 이전에는 부모용 문구("지금 어디야?", "숙제는 했어?")가 아이 화면에도 그대로 떴다.
 * 아이가 부모에게 물을 말이 아니라 부모가 아이에게 묻는 말이라 문맥이 어긋난다.
 *
 * 말투: 가족 간 대화라 양쪽 모두 반말. 아이 문구는 ChildHome 의 원탭 상태 공유
 * (도착했어·출발했어·데리러 와줘 …)와 겹치지 않는 "대화" 성격으로 고른다.
 */
export type MemoQuickReplyRole = "parent" | "child" | "teacher" | null | undefined;

/** 부모 → 아이. */
export const PARENT_QUICK_REPLIES: readonly string[] = [
  "지금 어디야?",
  "숙제는 했어?",
  "몇 시에 끝나?",
  "조심히 와 💛",
  "간식 챙겼어?",
];

/** 아이 → 부모. */
export const CHILD_QUICK_REPLIES: readonly string[] = [
  "언제 와?",
  "숙제 다 했어",
  "지금 가고 있어",
  "배고파 🍪",
  "사랑해 💛",
];

export function resolveMemoQuickReplies(role: MemoQuickReplyRole): readonly string[] {
  return role === "child" ? CHILD_QUICK_REPLIES : PARENT_QUICK_REPLIES;
}
