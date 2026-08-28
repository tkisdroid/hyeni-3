/**
 * 페어링 코드 입력 정규화(hyeni-1 pairCode.js 이관).
 * raw 8자 / "KID-..." / "KID..."(하이픈 생략) / ?pairCode=·?code= 쿼리 URL → 표준 "KID-XXXXXXXX".
 * iOS 자동완성·붙여넣기에서 하이픈이 빠진 12자 형태("KIDXXXXXXXX")가 실제로 들어와
 * 직접매치에 걸리지 않아 코드가 사라진 것처럼 보였다(2026-08-22 TK iPhone 제보) —
 * KID 접두어가 붙은 8자리 코드는 하이픈 유무와 무관하게 모두 받아들인다.
 */
export function normalizePairCodeInput(rawValue: string): string {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  const directMatch = raw.match(/KID-?[A-Z0-9]{8}/i);
  if (directMatch) {
    const digits = directMatch[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
    return `KID-${digits.slice(3)}`;
  }

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

export type PairingQrDetectionDecision =
  | { accepted: true; code: string }
  | { accepted: false; code: null };

/** 다른 QR을 아이 연결 코드로 오인해 스캔창을 닫지 않도록 제출 여부를 먼저 확정한다. */
export function decidePairingQrDetection(rawValue: string): PairingQrDetectionDecision {
  const code = normalizePairCodeInput(rawValue);
  return code
    ? { accepted: true, code }
    : { accepted: false, code: null };
}
