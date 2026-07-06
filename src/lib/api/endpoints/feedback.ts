/**
 * 피드백(기능 제안) 엔드포인트.
 * POST /api/feedback — Resend 이메일 발송(서버 미설정 시 mock 접수). 서버 JWT 게이트 없음.
 * 서버 계약(worker/routes/feedback.ts): body 는 camelCase, content 는 필수(빈 값이면 400).
 * 응답 { ok, mock?, emailId? } → mock 여부만 화면에 전달.
 */
import { apiPost } from "../client";

/** 피드백 전송 payload(서버 계약 그대로 camelCase). */
export interface FeedbackInput {
  /** 필수 — 비어 있으면 서버가 400. */
  content: string;
  familyId: string | null;
  senderUserId: string | null;
  senderRole: string | null;
  senderName: string;
  senderEmail: string;
  appOrigin: string;
}

/** 전송 결과 — mock=서버 이메일 미설정 접수, edge=실제 발송. */
export interface FeedbackResult {
  mode: "mock" | "edge";
}

interface FeedbackResponse {
  ok?: boolean;
  mock?: boolean;
  emailId?: string | null;
}

/** 피드백 전송. 실패(4xx/5xx)는 apiPost 가 ApiError 로 throw 한다. */
export async function sendFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const body = await apiPost<FeedbackResponse>("/api/feedback", {
    familyId: input.familyId,
    senderUserId: input.senderUserId,
    senderRole: input.senderRole,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    content: input.content,
    appOrigin: input.appOrigin,
  });
  return { mode: body?.mock ? "mock" : "edge" };
}
