/**
 * 대화 화면 문구 — 부모/아이 모드 분리.
 * MemoChat 은 부모·아이가 공유하는 컴포넌트라 문구가 한쪽 톤으로 고정되면
 * 반대쪽에서 어색해진다(아이 화면에 존댓말 안내가 뜨던 문제).
 *
 * 말투 규칙(CLAUDE.md §7): 부모 = 존댓말, 아이 모드 = 반말.
 */
export type MemoChatRole = "parent" | "child" | "teacher" | null | undefined;

export interface MemoChatCopy {
  /** 헤더 상태(대화 없음). */
  noConversation: string;
  /** 스레드 로딩/에러/빈 상태. */
  loading: string;
  loadError: string;
  empty: string;
  /** 입력창 placeholder. */
  inputPlaceholder: string;
  /** 토스트. */
  emptyDraft: string;
  sendFailed: string;
  imageFailed: string;
  imageLoadFailed: string;
  locationFailed: string;
  locationUnavailable: string;
}

const PARENT_COPY: MemoChatCopy = {
  noConversation: "새 대화를 시작해요",
  loading: "대화를 불러오는 중…",
  loadError: "대화를 불러오지 못했어요",
  empty: "아직 나눈 대화가 없어요. 먼저 인사를 건네보세요 💌",
  inputPlaceholder: "메시지를 입력하세요...",
  emptyDraft: "메시지를 입력해 주세요",
  sendFailed: "메시지 전송에 실패했어요",
  imageFailed: "사진 전송에 실패했어요",
  imageLoadFailed: "사진을 불러오지 못했어요",
  locationFailed: "위치 전송에 실패했어요",
  locationUnavailable: "현재 위치를 확인하지 못했어요",
};

const CHILD_COPY: MemoChatCopy = {
  noConversation: "새 대화를 시작해",
  loading: "대화를 불러오는 중…",
  loadError: "대화를 불러오지 못했어",
  empty: "아직 나눈 대화가 없어. 먼저 인사해볼까? 💌",
  inputPlaceholder: "메시지를 입력해줘...",
  emptyDraft: "메시지를 써줘",
  sendFailed: "보내지 못했어. 잠시 후 다시 해줘",
  imageFailed: "사진을 보내지 못했어. 다시 해볼래?",
  imageLoadFailed: "사진을 불러오지 못했어",
  locationFailed: "위치를 보내지 못했어. 다시 해볼래?",
  locationUnavailable: "지금 위치를 못 찾았어. 잠시 후 다시 해줘",
};

export function resolveMemoChatCopy(role: MemoChatRole): MemoChatCopy {
  return role === "child" ? CHILD_COPY : PARENT_COPY;
}
