import { apiDelete, apiGet, apiPost } from "../client";

export type AiContentReportReason =
  | "scary_or_uncomfortable"
  | "abusive_language"
  | "asks_personal_info"
  | "inaccurate"
  | "other";

export type MemoContentReportReason =
  | "harassment"
  | "sexual_or_violent"
  | "personal_info"
  | "illegal_or_dangerous"
  | "other";

export interface ContentReportResult {
  ok: boolean;
  duplicate?: boolean;
}

export interface MemoBlockList {
  blockedUserIds: string[];
}

export function reportAiMessage(
  messageId: string,
  reason: AiContentReportReason,
  detail: string,
): Promise<ContentReportResult> {
  return apiPost<ContentReportResult>(
    `/api/ai/messages/${encodeURIComponent(messageId)}/report`,
    { reason, detail: detail.trim() || undefined },
  );
}

export function reportMemoReply(
  replyId: string,
  reason: MemoContentReportReason,
  detail: string,
): Promise<ContentReportResult> {
  return apiPost<ContentReportResult>(
    `/api/memos/replies/${encodeURIComponent(replyId)}/report`,
    { reason, detail: detail.trim() || undefined },
  );
}

export async function fetchMemoBlocks(familyId: string): Promise<MemoBlockList> {
  const result = await apiGet<MemoBlockList>(
    `/api/memos/blocks?family_id=${encodeURIComponent(familyId)}`,
  );
  return {
    blockedUserIds: Array.isArray(result?.blockedUserIds)
      ? result.blockedUserIds.filter((id): id is string => typeof id === "string" && !!id)
      : [],
  };
}

export function blockMemoUser(familyId: string, targetUserId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/api/memos/blocks", {
    family_id: familyId,
    target_user_id: targetUserId,
  });
}

export function unblockMemoUser(familyId: string, targetUserId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(
    `/api/memos/blocks/${encodeURIComponent(targetUserId)}?family_id=${encodeURIComponent(familyId)}`,
  );
}
