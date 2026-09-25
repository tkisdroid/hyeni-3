export const MAX_MEMBER_DISPLAY_NAME_LENGTH = 40;

const DISALLOWED_NAME_CONTROLS = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;

/**
 * 가족 구성원 표시 이름의 저장 경계 검증.
 * HTML처럼 보이는 일반 문자는 이름 데이터로 보존하고, DOM에서는 textContent/속성으로만 렌더링한다.
 */
export function normalizeMemberDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || DISALLOWED_NAME_CONTROLS.test(normalized)) return null;
  if (Array.from(normalized).length > MAX_MEMBER_DISPLAY_NAME_LENGTH) return null;
  return normalized;
}

/**
 * 가족 멤버 전화번호 입력. 빈 값은 지우기이고, 그 밖에는 한국 휴대폰 번호만 받아 표시형(010-0000-0000)으로
 * 저장한다. 형식 검사 없이 저장하면 "010-1234" 같은 값이 아이의 "부모님 전화" 버튼으로 그대로 걸렸다.
 */
/**
 * 제출한 번호가 저장된 번호와 같은가(숫자만 비교). 이름만 고쳐도 화면이 기존 번호를 함께 보내므로,
 * 검증 도입 전에 저장된 옛 형식 번호가 이름 저장까지 막지 않게 바뀌지 않은 번호는 건드리지 않는다.
 */
export function isUnchangedMemberPhone(submitted: unknown, stored: unknown): boolean {
  if (typeof submitted !== "string" || typeof stored !== "string") return false;
  const submittedDigits = submitted.replace(/\D/g, "");
  return submittedDigits.length > 0 && submittedDigits === stored.replace(/\D/g, "");
}

export function normalizeMemberPhoneInput(value: unknown): { ok: true; phone: string } | { ok: false } {
  if (value == null) return { ok: true, phone: "" };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, phone: "" };
  if (/[^0-9+\-\s()]/.test(trimmed)) return { ok: false };
  const digits = trimmed.replace(/\D/g, "");
  const local = digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  if (!/^01[016789]\d{7,8}$/.test(local)) return { ok: false };
  return {
    ok: true,
    phone: local.length === 11
      ? `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`
      : `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`,
  };
}
