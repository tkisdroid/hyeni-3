import type { SendMemoVars } from "@/queries/useMemo";

export type QuickStatusActionId =
  | "arrived"
  | "departed"
  | "late"
  | "pickup"
  | "call"
  | "battery";

export interface QuickStatusAction {
  id: QuickStatusActionId;
  label: string;
  message: string;
}

export const QUICK_STATUS_ACTIONS: readonly QuickStatusAction[] = [
  { id: "arrived", label: "도착했어", message: "나 도착했어!" },
  { id: "departed", label: "출발했어", message: "나 출발했어!" },
  { id: "late", label: "늦을 것 같아", message: "조금 늦을 것 같아" },
  { id: "pickup", label: "데리러 와 줘", message: "데리러 와 줄 수 있어?" },
  { id: "call", label: "전화해 줘", message: "전화해 줘" },
  { id: "battery", label: "배터리 없어", message: "배터리가 얼마 없어" },
] as const;

export function findQuickStatusAction(id: QuickStatusActionId): QuickStatusAction {
  const action = QUICK_STATUS_ACTIONS.find((item) => item.id === id);
  if (!action) throw new Error("알 수 없는 상태 공유예요");
  return action;
}

export function buildQuickStatusMemo(
  id: QuickStatusActionId,
  childId: string,
  dateKey: string,
): SendMemoVars {
  const action = findQuickStatusAction(id);
  return {
    content: action.message,
    childId,
    dateKey,
    origin: "quick_status",
  };
}
