import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { MemoReply } from "../lib/api/endpoints/memo";

const MEMO_KEY = "memoReplies";
const ALL_CHILDREN = "all";

function matchesMemoThread(queryKey: QueryKey, familyId: string, saved: MemoReply): boolean {
  if (queryKey[0] !== MEMO_KEY || queryKey[1] !== familyId) return false;
  if (saved.family_id && saved.family_id !== familyId) return false;

  const dateKeys = typeof queryKey[2] === "string" ? queryKey[2].split(",") : [];
  if (!dateKeys.includes(saved.date_key)) return false;

  const childScope = typeof queryKey[3] === "string" ? queryKey[3] : ALL_CHILDREN;
  return childScope === ALL_CHILDREN || childScope === saved.child_id;
}

/** 낙관적 임시 행 id 접두 — 서버 행과 절대 겹치지 않는다. */
export const PENDING_MEMO_ID_PREFIX = "pending:";

export function isPendingMemoReply(reply: Pick<MemoReply, "id">): boolean {
  return reply.id.startsWith(PENDING_MEMO_ID_PREFIX);
}

/**
 * 보낸 즉시 말풍선을 세운다. 서버 왕복(모바일 네트워크에서 수백 ms~수 초)을 기다리는 동안
 * 화면이 멈춘 것처럼 보이던 문제를 없앤다(준비물 토글과 같은 낙관적 갱신 패턴).
 * 실패하면 removeMemoReply 로 되돌리므로 '보낸 척'은 남지 않는다.
 */
export function insertPendingMemoReply(
  client: QueryClient,
  familyId: string,
  pending: MemoReply,
): void {
  if (!familyId || !pending.date_key) return;
  const prefix = [MEMO_KEY, familyId] as const;
  for (const [queryKey, cached] of client.getQueriesData<MemoReply[]>({ queryKey: prefix })) {
    if (!Array.isArray(cached) || !matchesMemoThread(queryKey, familyId, pending)) continue;
    client.setQueryData(queryKey, [...cached, pending]);
  }
}

/**
 * 읽음 처리 결과를 캐시에 직접 반영한다.
 * ⚠️ 여기서 invalidateQueries 를 쓰면 안 된다 — 대화를 열 때 안 읽은 메시지 N개가
 * 한꺼번에 읽음 처리되면서 7일치 스레드를 N번 다시 받아 화면이 눈에 띄게 느려진다
 * (상대 기기의 "읽음" 갱신은 WS 브릿지가 따로 무효화하므로 손해가 없다).
 */
export function markMemoReplyRead(
  client: QueryClient,
  familyId: string,
  replyId: string,
  userId: string,
): void {
  if (!familyId || !replyId || !userId) return;
  const prefix = [MEMO_KEY, familyId] as const;
  for (const [queryKey, cached] of client.getQueriesData<MemoReply[]>({ queryKey: prefix })) {
    if (!Array.isArray(cached)) continue;
    let changed = false;
    const next = cached.map((row) => {
      if (row.id !== replyId) return row;
      const readBy = row.read_by ?? [];
      if (readBy.includes(userId)) return row;
      changed = true;
      return { ...row, read_by: [...readBy, userId] };
    });
    if (changed) client.setQueryData(queryKey, next);
  }
}

/** 서버가 돌려준 값이 실제 저장 행인지 확인한다(배열·빈 객체·오류 본문 방어). */
function isStoredMemoReply(value: unknown): value is MemoReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<MemoReply>;
  return typeof row.id === "string" && row.id.length > 0
    && typeof row.date_key === "string" && row.date_key.length > 0;
}

/**
 * 임시 행을 서버 저장 행으로 '제자리 교체'한다.
 * ⚠️ 임시 행을 먼저 지우고 저장 행을 따로 넣으면, 응답이 예상과 다를 때(배열·빈 본문 등)
 * 방금 보낸 말풍선이 화면에서 사라진다. 그래서 저장 행이 확실할 때만 교체하고,
 * 아니면 임시 행을 그대로 두어 백그라운드 재조회가 정본으로 맞추게 한다.
 */
export function reconcilePendingMemoReply(
  client: QueryClient,
  familyId: string,
  pendingId: string,
  saved: unknown,
): void {
  if (!familyId || !pendingId) return;
  const stored = isStoredMemoReply(saved) ? saved : null;
  const prefix = [MEMO_KEY, familyId] as const;
  for (const [queryKey, cached] of client.getQueriesData<MemoReply[]>({ queryKey: prefix })) {
    if (!Array.isArray(cached)) continue;
    const index = cached.findIndex((row) => row.id === pendingId);
    if (index < 0) continue;
    if (!stored) continue; // 저장 행이 불확실하면 말풍선을 지우지 않는다
    const next = cached.slice();
    next[index] = stored;
    client.setQueryData(queryKey, next.filter(
      (row, i) => i === index || row.id !== stored.id,
    ));
  }
}

/** 임시 행 회수 — 전송 실패 롤백과 서버 행 교체에 함께 쓴다. */
export function removeMemoReply(
  client: QueryClient,
  familyId: string,
  replyId: string,
): void {
  if (!familyId || !replyId) return;
  const prefix = [MEMO_KEY, familyId] as const;
  for (const [queryKey, cached] of client.getQueriesData<MemoReply[]>({ queryKey: prefix })) {
    if (!Array.isArray(cached)) continue;
    const next = cached.filter((row) => row.id !== replyId);
    if (next.length !== cached.length) client.setQueryData(queryKey, next);
  }
}

/**
 * POST 성공 행을 현재 대화 캐시에 즉시 합친 뒤, 서버 정본 재조회는 백그라운드로 실행한다.
 * 저장은 성공했지만 후속 GET/WS가 늦어 발신 화면에 과거 대화만 남는 상태를 막는다.
 */
export function commitSentMemoReply(
  client: QueryClient,
  familyId: string,
  saved: MemoReply,
): void {
  if (!familyId || !saved.date_key) return;
  const prefix = [MEMO_KEY, familyId] as const;

  for (const [queryKey, cached] of client.getQueriesData<MemoReply[]>({ queryKey: prefix })) {
    if (!Array.isArray(cached) || !matchesMemoThread(queryKey, familyId, saved)) continue;
    const existingIndex = cached.findIndex((row) => row.id === saved.id);
    const next = existingIndex < 0
      ? [...cached, saved]
      : cached.map((row, index) => (index === existingIndex ? saved : row));
    client.setQueryData(queryKey, next);
  }

  void client.invalidateQueries({ queryKey: prefix });
}
