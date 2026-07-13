/**
 * 메모/대화(memo_replies) 도메인 엔드포인트.
 * hyeni-1 sync.js 의 fetchMemoRepliesForDateKeys / insertMemoReply / markMemoReplyRead 를 TS 로 이관.
 *
 * memo_replies 는 부모↔아이 대화 스레드(텍스트)이며 date_key(0-index 월) 단위로 조회한다.
 * 실시간 INSERT 는 useFamilyRealtime 이 memo_replies table 을 감지해 캐시를 무효화한다.
 *
 * 원칙: 컴포넌트는 이 모듈을 직접 쓰지 않는다. queries/useMemo 훅이 감싼다.
 */
import { apiGet, apiPost } from "../client";

/** memo_replies row 형태(hyeni-1 App.jsx 소비 shape 기준). */
export interface MemoReply {
  id: string;
  family_id?: string;
  date_key: string; // 0-indexed 월 date_key. 전송 성공 캐시를 정확한 조회 윈도우에만 반영한다.
  child_id: string | null; // family_members.id (멀티차일드 분리). legacy row 는 null.
  user_id: string;
  user_role: "parent" | "child";
  content: string;
  origin?: string | null; // "reply" | "original" | "legacy_memo"
  read_by?: string[] | null;
  created_at: string; // UTC ISO
}

export interface SendMemoReplyInput {
  familyId: string;
  dateKey: string;
  userId: string;
  userRole: "parent" | "child";
  content: string;
  childId?: string | null;
  origin?: string;
}

/**
 * 여러 date_key 의 대화 목록. keys 는 콤마로 합쳐 전송(0-index 월 date_key).
 * childId 지정 시 해당 자녀 스레드만, 미지정 시 가족 전체 반환.
 * 빈 입력(가족/키 없음)은 네트워크 왕복 없이 [] 단락.
 */
export async function fetchMemoReplies(
  familyId: string,
  dateKeys: string[],
  childId?: string | null,
): Promise<MemoReply[]> {
  const keys = [...new Set(dateKeys.filter(Boolean))];
  if (!familyId || keys.length === 0) return [];
  let path = `/api/memos/replies?family_id=${encodeURIComponent(familyId)}&date_keys=${encodeURIComponent(keys.join(","))}`;
  if (childId) path += `&child_id=${encodeURIComponent(childId)}`;
  const data = await apiGet<MemoReply[] | null>(path);
  return data ?? [];
}

/** 대화 전송. 서버가 생성된 row 를 반환. origin 기본값은 서버 기본과 동일한 "reply". */
export async function sendMemoReply(input: SendMemoReplyInput): Promise<MemoReply> {
  const trimmed = input.content.trim();
  if (!trimmed) throw new Error("메시지를 입력해 주세요");
  const body: Record<string, unknown> = {
    family_id: input.familyId,
    date_key: input.dateKey,
    user_id: input.userId,
    user_role: input.userRole,
    content: trimmed,
    origin: input.origin ?? "reply",
  };
  if (input.childId) body.child_id = input.childId;
  return apiPost<MemoReply>("/api/memos/replies", body);
}

/** 읽음 처리(뷰포트 read-receipt). 서버가 read_by 에 userId 를 멱등 append(204). */
export async function markReplyRead(replyId: string, userId: string): Promise<void> {
  if (!replyId || !userId) return;
  await apiPost(`/api/memos/replies/${encodeURIComponent(replyId)}/read`, { user_id: userId });
}
