// 전화 OTP 발송/검증 핵심 — oauth-bridge(P3 본인확인)와 회원가입(signup)이 공유.
// phone_otp 테이블 + lib/otp HMAC + lib/ncpSens(NCP SENS) 를 재사용한다(중복 구현 금지).
//
// 보안 모델(phone-otp-schema.sql 와 동일): code 평문 저장 금지(HMAC) · 만료 5분 ·
// 시도 제한 5 · 재발송 cooldown 60초 · phone 당 단일 활성 OTP(발송 시 기존 행 DELETE 후 INSERT).
//
// 각 라우트는 "계정 존재/부재" 게이트가 반대(브리지=존재 필수, 가입=부재 필수)이므로
// 그 분기만 라우트가 직접 처리하고, 발송·검증 자체는 이 모듈을 호출한다.
import type { Env } from "../types";
import { pgTs, pgToIso } from "./time";
import { readNcpSensConfig, hasValidNcpSensConfig, sendNcpSensOtp } from "./ncpSens";
import { generateOtpCode, hashOtp, timingSafeEqualHex } from "./otp";

export const OTP_TTL_MS = 5 * 60 * 1000; // 만료 5분
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 재발송 cooldown 60초
export const OTP_MAX_ATTEMPTS = 5; // 검증 시도 제한

// 발송/검증 결과 — 라우트가 status/error/retryAfter 를 그대로 응답에 매핑한다.
export interface OtpResult {
  ok: boolean;
  error?: string;
  status?: number;
  retryAfter?: string;
}

// 6자리 OTP 생성 → HMAC 저장(평문 금지) → NCP SENS 발송. phone 당 단일 활성 OTP.
// NCP SENS 키 미설정이면 503 graceful(send-sms 와 동일). 발송 실패 시 방금 저장한 OTP 제거.
export async function sendPhoneOtp(db: D1Database, env: Env, phone: string): Promise<OtpResult> {
  // NCP SENS 키 graceful 503.
  const config = readNcpSensConfig(env);
  if (!hasValidNcpSensConfig(config)) return { ok: false, error: "sms_not_configured", status: 503 };

  // rate limit — 직전 발송이 cooldown 이내면 거부.
  const last = await db
    .prepare("SELECT created_at FROM phone_otp WHERE phone=? ORDER BY created_at DESC LIMIT 1")
    .bind(phone)
    .first<{ created_at: string }>();
  if (last?.created_at) {
    const lastMs = Date.parse(pgToIso(last.created_at));
    if (Number.isFinite(lastMs) && Date.now() - lastMs < OTP_RESEND_COOLDOWN_MS) {
      return { ok: false, error: "rate_limited", status: 429, retryAfter: "60" };
    }
  }

  const code = generateOtpCode();
  const codeHash = await hashOtp(phone, code, env.PUSH_INTERNAL_SECRET);
  const nowDate = new Date();
  const createdAt = pgTs(nowDate);
  const expiresAt = pgTs(new Date(nowDate.getTime() + OTP_TTL_MS));

  // phone 당 단일 활성 OTP — 기존 행 제거 후 새로 발급(트랜잭션).
  await db.batch([
    db.prepare("DELETE FROM phone_otp WHERE phone=?").bind(phone),
    db.prepare("INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,0,?)").bind(phone, codeHash, expiresAt, createdAt),
  ]);

  // SMS 발송 — lib/ncpSens 재사용(send-sms 라우트와 동일 sender). +82 → 010 변환은 sender 내부 처리.
  try {
    await sendNcpSensOtp({
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      serviceId: config.serviceId,
      from: config.from,
      to: phone,
      otp: code,
    });
  } catch (err) {
    console.error("[phoneOtp] sms send failed");
    // 발송 실패 시 방금 저장한 OTP 제거(유령 OTP/cooldown 잠금 방지).
    await db.prepare("DELETE FROM phone_otp WHERE phone=?").bind(phone).run();
    return { ok: false, error: "sms_provider_failed", status: 503, retryAfter: "5" };
  }

  return { ok: true };
}

// 최신 phone_otp 행 대조(만료/시도제한/상수시간) → 성공 시 소비(1회용 DELETE).
// 토큰은 이미 6자리 숫자로 정규화된 값을 받는다(호출 라우트가 형식 검사).
export async function verifyPhoneOtp(db: D1Database, env: Env, phone: string, token: string): Promise<OtpResult> {
  const row = await db
    .prepare("SELECT code_hash, expires_at, attempts FROM phone_otp WHERE phone=? ORDER BY created_at DESC LIMIT 1")
    .bind(phone)
    .first<{ code_hash: string; expires_at: string; attempts: number }>();
  if (!row) return { ok: false, error: "otp_not_found", status: 401 };

  // 만료 — 제거 후 거부.
  const expMs = Date.parse(pgToIso(row.expires_at));
  if (!Number.isFinite(expMs) || Date.now() > expMs) {
    await db.prepare("DELETE FROM phone_otp WHERE phone=?").bind(phone).run();
    return { ok: false, error: "otp_expired", status: 401 };
  }
  // 시도 제한 — 초과 시 제거 후 거부(무차별 대입 차단).
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    await db.prepare("DELETE FROM phone_otp WHERE phone=?").bind(phone).run();
    return { ok: false, error: "too_many_attempts", status: 429 };
  }

  // 대조(상수시간).
  const candidateHash = await hashOtp(phone, token, env.PUSH_INTERNAL_SECRET);
  if (!timingSafeEqualHex(candidateHash, row.code_hash)) {
    await db.prepare("UPDATE phone_otp SET attempts=attempts+1 WHERE phone=?").bind(phone).run();
    return { ok: false, error: "otp_mismatch", status: 401 };
  }

  // 성공 — OTP 소비(1회용).
  await db.prepare("DELETE FROM phone_otp WHERE phone=?").bind(phone).run();
  return { ok: true };
}
