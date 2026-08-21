// 전화 OTP 발송/검증 핵심 — oauth-bridge(P3 본인확인)와 회원가입(signup)이 공유.
// phone_otp 테이블 + lib/otp HMAC + lib/ncpSens(NCP SENS) 를 재사용한다(중복 구현 금지).
//
// 보안 모델(phone-otp-schema.sql 와 동일): code 평문 저장 금지(HMAC) · 만료 5분 ·
// 시도 제한 5 · 재발송 cooldown 60초 · phone 당 단일 활성 OTP(UNIQUE + 원자 upsert).
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

export interface ValidatedOtpResult extends OtpResult {
  /** 성공한 OTP 행을 가입 batch에서 정확히 한 번 소비하기 위한 HMAC 값. 원문 OTP가 아니다. */
  verificationHash?: string;
}

// 6자리 OTP 생성 → HMAC 저장(평문 금지) → NCP SENS 발송. phone 당 단일 활성 OTP.
// NCP SENS 키 미설정이면 503 graceful(send-sms 와 동일). 발송 실패 시 방금 저장한 OTP 제거.
export async function sendPhoneOtp(db: D1Database, env: Env, phone: string): Promise<OtpResult> {
  // NCP SENS 키 graceful 503.
  const config = readNcpSensConfig(env);
  if (!hasValidNcpSensConfig(config)) return { ok: false, error: "sms_not_configured", status: 503 };

  const code = generateOtpCode();
  const codeHash = await hashOtp(phone, code, env.PUSH_INTERNAL_SECRET);
  const nowDate = new Date();
  const createdAt = pgTs(nowDate);
  const expiresAt = pgTs(new Date(nowDate.getTime() + OTP_TTL_MS));
  const resendCutoff = pgTs(new Date(nowDate.getTime() - OTP_RESEND_COOLDOWN_MS));

  // phone UNIQUE를 이용해 발송 cooldown 확인과 교체를 한 문장으로 선형화한다.
  // 동시에 두 요청이 들어와도 한 요청만 행을 만들거나 갱신하므로 서로 다른 OTP 두 개를 보내지 않는다.
  const stored = await db.prepare(
    `INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at)
     VALUES(?,?,?,0,?)
     ON CONFLICT(phone) DO UPDATE SET
       code_hash=excluded.code_hash,
       expires_at=excluded.expires_at,
       attempts=0,
       created_at=excluded.created_at
     WHERE phone_otp.created_at<=?`,
  ).bind(phone, codeHash, expiresAt, createdAt, resendCutoff).run();
  if (Number(stored.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: "rate_limited", status: 429, retryAfter: "60" };
  }

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
    await db.prepare("DELETE FROM phone_otp WHERE phone=? AND code_hash=?").bind(phone, codeHash).run();
    return { ok: false, error: "sms_provider_failed", status: 503, retryAfter: "5" };
  }

  return { ok: true };
}

// 최신 phone_otp 행 대조(만료/시도제한/상수시간). 가입은 이 결과의 HMAC을 user 생성 batch
// 안에서 함께 소비하고, OAuth 브리지는 verifyPhoneOtp가 즉시 소비한다.
// 토큰은 이미 6자리 숫자로 정규화된 값을 받는다(호출 라우트가 형식 검사).
export async function validatePhoneOtp(
  db: D1Database,
  env: Env,
  phone: string,
  token: string,
): Promise<ValidatedOtpResult> {
  const row = await db
    .prepare("SELECT code_hash, expires_at, attempts FROM phone_otp WHERE phone=? ORDER BY created_at DESC LIMIT 1")
    .bind(phone)
    .first<{ code_hash: string; expires_at: string; attempts: number }>();
  if (!row) return { ok: false, error: "otp_not_found", status: 401 };

  // 만료 — 제거 후 거부.
  const expMs = Date.parse(pgToIso(row.expires_at));
  if (!Number.isFinite(expMs) || Date.now() > expMs) {
    await db.prepare("DELETE FROM phone_otp WHERE phone=? AND code_hash=?").bind(phone, row.code_hash).run();
    return { ok: false, error: "otp_expired", status: 401 };
  }
  // 시도 제한 — 초과 시 제거 후 거부(무차별 대입 차단).
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    await db.prepare("DELETE FROM phone_otp WHERE phone=? AND code_hash=?").bind(phone, row.code_hash).run();
    return { ok: false, error: "too_many_attempts", status: 429 };
  }

  // 대조(상수시간).
  const candidateHash = await hashOtp(phone, token, env.PUSH_INTERNAL_SECRET);
  if (!timingSafeEqualHex(candidateHash, row.code_hash)) {
    await db.prepare("UPDATE phone_otp SET attempts=attempts+1 WHERE phone=? AND code_hash=?")
      .bind(phone, row.code_hash)
      .run();
    return { ok: false, error: "otp_mismatch", status: 401 };
  }

  return { ok: true, verificationHash: row.code_hash };
}

export async function verifyPhoneOtp(db: D1Database, env: Env, phone: string, token: string): Promise<OtpResult> {
  const validated = await validatePhoneOtp(db, env, phone, token);
  if (!validated.ok || !validated.verificationHash) return validated;
  // 성공 — 읽은 것과 정확히 같은 OTP만 소비한다. 사이에 재발급된 새 OTP는 지우지 않는다.
  const consumed = await db.prepare("DELETE FROM phone_otp WHERE phone=? AND code_hash=?")
    .bind(phone, validated.verificationHash)
    .run();
  if (Number(consumed.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: "otp_not_found", status: 401 };
  }
  return { ok: true };
}
