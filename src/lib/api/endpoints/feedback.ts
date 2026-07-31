/** 인증 세션으로 문제 신고·문의·기능 제안을 내구 접수하고 전달 상태를 확인한다. */
import { apiPost } from "../client";
import type { FeedbackDiagnostics } from "@/lib/feedbackDiagnostics";

export type FeedbackKind = "problem" | "question" | "suggestion";
export type FeedbackCategory =
  | "account"
  | "calendar"
  | "chat_ai"
  | "design"
  | "location_safety"
  | "notification"
  | "other";

export interface FeedbackInput {
  requestId: string;
  feedbackKind: FeedbackKind;
  category: FeedbackCategory | null;
  content: string;
  familyId: string | null;
  appOrigin: string;
  diagnostics: FeedbackDiagnostics | null;
}

export interface FeedbackResult {
  status: "queued" | "sent";
}

interface FeedbackResponse {
  ok?: boolean;
  status?: "queued" | "sent";
  // 구버전 Worker가 반환하던 필드. 배포 전환 중 mock은 queued로만 해석한다.
  mock?: boolean;
  emailId?: string | null;
}

export function createFeedbackRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export async function sendFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const body = await apiPost<FeedbackResponse>("/api/feedback", {
    requestId: input.requestId,
    familyId: input.familyId,
    feedbackKind: input.feedbackKind,
    category: input.category,
    content: input.content,
    appOrigin: input.appOrigin,
    ...(input.diagnostics
      ? {
          diagnosticSchemaVersion: input.diagnostics.schemaVersion,
          currentScreen: input.diagnostics.currentScreen,
          deviceInfo: input.diagnostics.deviceInfo,
          errorLogs: input.diagnostics.errorLogs,
        }
      : {}),
  });
  if (body.status === "sent" || body.status === "queued") {
    return { status: body.status };
  }
  if (body.ok === true) {
    return { status: body.mock ? "queued" : "sent" };
  }
  throw new Error("invalid_feedback_response");
}
