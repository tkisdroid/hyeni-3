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
