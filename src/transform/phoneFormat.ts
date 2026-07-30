/**
 * 전화번호 표시 포맷(단일 출처).
 *
 * 저장값은 하이픈이 있거나 없거나 섞여 있다("01083018128" / "010-8301-8128").
 * 화면마다 각자 포맷터를 두다 보니 계정 화면만 하이픈 없이 보이는 불일치가 있었다(2026-07-30 실기기 확인).
 * 숫자만 추출해 한국 휴대폰 표기로 통일하고, 입력 중(부분 입력)에도 자연스럽게 끊는다.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** 표시용 전화번호 또는 "미등록" 라벨. 목록·상세에서 빈 값을 빈칸으로 남기지 않는다. */
export function formatPhoneOrMissing(
  value: string | null | undefined,
  missingLabel = "미등록",
): string {
  const formatted = formatPhoneDisplay(value);
  return formatted || missingLabel;
}
