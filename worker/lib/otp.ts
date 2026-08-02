// 전화 OTP 생성·해시·상수시간 비교. phone_otp 에는 해시만 저장(평문 금지).
// 6자리 코드 공간(10^6)은 작아 단순 SHA-256 은 DB 유출 시 오프라인 무차별 대입이 가능하므로,
// 서버 pepper 키로 HMAC 을 건다(만료·시도제한과 합쳐 SMS OTP 강도 확보).

const PEPPER_FALLBACK = "hyeni-phone-otp-pepper";

// 6자리 OTP — crypto 난수(편향 최소화 위해 32bit % 10^6).
export function generateOtpCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// HMAC-SHA256(key=pepper, msg=`${phone}:${code}`) → hex.
// pepper(서버 시크릿, 기본 PUSH_INTERNAL_SECRET)로 DB 유출 시 오프라인 대입을 막는다.
// pepper 미설정이면 상수 fallback(여전히 만료·시도제한 방어가 작동).
export async function hashOtp(phone: string, code: string, pepper?: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper && pepper.trim() ? pepper : PEPPER_FALLBACK),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${phone}:${code}`));
  return toHex(sig);
}

// hex 문자열 상수시간 비교(타이밍 누수 방지).
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
