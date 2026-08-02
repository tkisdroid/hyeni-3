// POST /api/sms/send  ← supabase/functions/send-sms (직역, NCP SENS OTP 발송).
//
// 인증(원본 대비 변경): 원본은 GoTrue "Send SMS hook" 으로 standardwebhooks 서명 검증.
//   Worker 엔 GoTrue 가 없고 이 함수는 내부 전용(Worker 자체 phone OTP 발송 경로가 호출)
//   이므로, 서명 검증을 internal-secret(x-internal-secret == PUSH_INTERNAL_SECRET, 상수시간)
//   으로 대체한다. (외부 노출 금지 — push-notify 내부호출 패턴 재사용.)
//
// 입력: 내부 호출 { phone, otp } 또는 원본 hook 형태 { user:{phone}, sms:{otp} } 둘 다 수용.
// 외부키 graceful: NCP SENS 키 미설정이면 500 ncp_sens_not_configured(원본 보존).
//
// 주의: 현재 Worker 측에 이 경로를 호출하는 phone-OTP 발송 코드는 아직 미이관 — 인프라만 준비.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { normalizePhoneForNcpSens, sendNcpSensOtp, readNcpSensConfig, hasValidNcpSensConfig } from "../lib/ncpSens";

const sms = new Hono<{ Bindings: Env; Variables: Vars }>();

function getPayloadText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

sms.post("/send", async (c) => {
  // internal-secret 인증.
  const internalSecret = c.env.PUSH_INTERNAL_SECRET || "";
  const provided = c.req.header("x-internal-secret") || "";
  if (!internalSecret || !timingSafeEqualStr(provided, internalSecret)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const config = readNcpSensConfig(c.env);

  let event: { phone?: unknown; otp?: unknown; user?: { phone?: unknown }; sms?: { otp?: unknown } };
  try {
    event = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }

  if (!hasValidNcpSensConfig(config)) {
    return c.json({ error: "ncp_sens_not_configured" }, 500);
  }

  const phone = getPayloadText(event?.phone ?? event?.user?.phone);
  const otp = getPayloadText(event?.otp ?? event?.sms?.otp);
  if (!phone || !otp) {
    return c.json({ error: "missing_phone_or_otp" }, 400);
  }

  try {
    normalizePhoneForNcpSens(phone);
    await sendNcpSensOtp({
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      serviceId: config.serviceId,
      from: config.from,
      to: phone,
      otp,
    });
    return c.json({});
  } catch (error) {
    if (error instanceof Error && (
      error.message === "invalid_phone"
      || error.message === "invalid_otp"
      || error.message === "invalid_from_number"
    )) {
      return c.json({ error: "invalid_payload" }, 400);
    }
    console.error("send-sms provider failure");
    c.header("Retry-After", "5");
    return c.json({ error: "sms_provider_failed" }, 503);
  }
});

export default sms;
