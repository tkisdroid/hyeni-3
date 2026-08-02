// 전화번호 정규화 — 전화 OTP(oauth-bridge)·회원가입(auth signup)이 공유.
// user_profiles.phone 은 E.164 KR('+8210########'), GoTrue/users.phone 은 '+' 제거형
// ('8210########', login-password JOIN 의 REPLACE(up.phone,'+','') 대상), raw_user_meta_data.phone
// 은 로컬형('010########', 클라 normalizePhoneForStorage 미러)이다. 한 곳에서 변환을 정의해
// 두 라우트가 동일 형식을 쓰도록 보장한다(형식 불일치 시 로그인 JOIN 이 깨짐).

// 전화번호 → E.164 KR('+8210########'). user_profiles.phone(=클라 normalizePhoneForAuth)과 동일.
// 잘못된 형식이면 throw → 호출 라우트가 400 invalid_phone.
export function toE164Kr(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (/^8210\d{8}$/.test(digits)) return `+${digits}`;
  if (/^010\d{8}$/.test(digits)) return `+82${digits.slice(1)}`;
  throw new Error("invalid_phone");
}

// throw 대신 null 을 돌려주는 안전 래퍼(라우트에서 400 분기용).
export function parsePhone(raw: unknown): string | null {
  try {
    return toE164Kr(String(raw ?? ""));
  } catch {
    return null;
  }
}

// E.164('+8210########') → GoTrue 저장형('8210########', '+' 제거). users.phone 컬럼용.
export function e164ToGoTruePhone(e164: string): string {
  return e164.replace(/^\+/, "");
}

// E.164('+8210########') → 로컬 저장형('010########'). raw_user_meta_data.phone 용(클라 미러).
export function e164ToLocalKr(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return `0${digits.slice(2)}`;
}
