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

export function resolveMemoChatCopy(role: MemoChatRole, providedIntl?: IntlShape): MemoChatCopy {
  const intl = withDefaultIntl(providedIntl);
  const tone = role === "child" ? "child" : "formal";
  const message = (field: keyof MemoChatCopy) => intl.formatMessage({ id: `shared.memo.copy.${field}.${tone}` });
  return {
    noConversation: message("noConversation"), loading: message("loading"),
    loadError: message("loadError"), empty: message("empty"),
    inputPlaceholder: message("inputPlaceholder"), emptyDraft: message("emptyDraft"),
    sendFailed: message("sendFailed"), imageFailed: message("imageFailed"),
    imageLoadFailed: message("imageLoadFailed"), locationFailed: message("locationFailed"),
    locationUnavailable: message("locationUnavailable"),
  };
}
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";
