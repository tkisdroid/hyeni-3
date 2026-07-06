/**
 * 페어링 코드 입력 정규화(hyeni-1 pairCode.js 이관).
 * raw 8자 / "KID-..." / ?pairCode=·?code= 쿼리 URL → 표준 "KID-XXXXXXXX".
 */
export function normalizePairCodeInput(rawValue: string): string {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  const directMatch = raw.match(/KID-[A-Z0-9]{8}/i);
  if (directMatch) return directMatch[0].toUpperCase();

  try {
    const parsed = new URL(raw);
    const paramCode = parsed.searchParams.get("pairCode") || parsed.searchParams.get("code");
    if (paramCode) return normalizePairCodeInput(paramCode);
  } catch {
    // URL 파싱 실패 시 무시(그냥 코드 문자열)
  }

  const shortMatch = raw.match(/\b[A-Z0-9]{8}\b/i);
  if (shortMatch) return `KID-${shortMatch[0].toUpperCase()}`;
  return "";
}
