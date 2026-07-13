/** 인증 세션으로 기능 제안을 내구 접수하고 이메일 전달 상태를 확인한다. */
import { apiPost } from "../client";

export interface FeedbackInput {
  requestId: string;
  content: string;
  familyId: string | null;
  appOrigin: string;
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
    content: input.content,
    appOrigin: input.appOrigin,
  });
  if (body.status === "sent" || body.status === "queued") {
    return { status: body.status };
  }
  if (body.ok === true) {
    return { status: body.mock ? "queued" : "sent" };
  }
  throw new Error("invalid_feedback_response");
}
