import type { AccentKey } from "@/theme/theme";
import { isAccentKey } from "@/transform/childAccent";

export type ChildAiConfirmToolName = "sendMessageToParent" | "updateSchedule";

export interface ChildAiConfirmedTool {
  toolName: ChildAiConfirmToolName;
  confirmationToken: string;
  parentRole?: string;
  message?: string;
  scheduleId?: string;
  title?: string;
  changes?: Record<string, string>;
}

export interface ChildAiPendingConfirm {
  kind: "confirm";
  label: string;
  tool: ChildAiConfirmedTool;
}

export interface ChildAiPendingCall {
  kind: "call";
  label: string;
  phone: string;
}

export interface ChildAiPendingAccent {
  kind: "accent";
  label: string;
  accent: AccentKey;
}

export type ChildAiPendingAction = ChildAiPendingConfirm | ChildAiPendingCall | ChildAiPendingAccent;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function childAiToolName(toolResult: unknown): string {
  return text(asRecord(toolResult)?.toolName);
}

export function isSuccessfulChildAiHelpTool(toolResult: unknown): boolean {
  const row = asRecord(toolResult);
  if (!row || row.ok !== true) return false;
  const name = text(row.toolName);
  return name === "createSchedule" || name === "createDailyItem" || name === "setChildAccent";
}

export function parseChildAiPendingAction(toolResult: unknown): ChildAiPendingAction | null {
  const row = asRecord(toolResult);
  if (!row) return null;
  const toolName = text(row.toolName);

  if (toolName === "setChildAccent" && row.ok === true && isAccentKey(row.accent)) {
    return {
      kind: "accent",
      label: `${String(row.label || row.accent)} 색으로 바꿀게`,
      accent: row.accent,
    };
  }

  if (toolName === "callParent" && row.ok === true) {
    const phone = text(row.phone || row.number);
    if (!phone) return null;
    return {
      kind: "call",
      label: `${text(row.displayName) || "부모님"}에게 전화하기`,
      phone,
    };
  }

  const token = text(row.confirmationToken);
  if (!token || row.confirmationRequired !== true || row.ok !== true) return null;

  if (toolName === "createMessageToParent") {
    return {
      kind: "confirm",
      label: `${text(row.displayName) || "부모님"}에게 보내기`,
      tool: {
        toolName: "sendMessageToParent",
        confirmationToken: token,
        parentRole: text(row.parentRole) || "guardian",
        message: text(row.message),
      },
    };
  }

  if (toolName === "updateSchedule") {
    const event = asRecord(row.event);
    const changes = asRecord(row.changes);
    const safeChanges: Record<string, string> = {};
    if (changes) {
      for (const [key, value] of Object.entries(changes)) {
        const next = text(value);
        if (next) safeChanges[key] = next;
      }
    }
    return {
      kind: "confirm",
      label: `${text(event?.title) || "일정"} 바꾸기`,
      tool: {
        toolName: "updateSchedule",
        confirmationToken: token,
        scheduleId: text(event?.id),
        title: text(event?.title),
        changes: safeChanges,
      },
    };
  }

  return null;
}
