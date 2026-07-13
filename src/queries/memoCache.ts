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
