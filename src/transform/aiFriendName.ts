export const DEFAULT_AI_FRIEND_NAME = "혜니";

/** 단일 캐릭터 이름 변경 전 자동 저장됐던 기본값. 직접 지은 다른 이름은 건드리지 않는다. */
const LEGACY_DEFAULT_AI_FRIEND_NAMES = new Set(["통통이", "꼬미"]);

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 과거 설정값에 아이 이름이 AI 친구 이름으로 들어간 경우가 있어, 아이 이름과 같은 값은
 * "아직 친구 이름을 정하지 않음"으로 본다.
 */
export function resolveAiFriendDisplayName(input: {
  savedName?: string | null;
  childName?: string | null;
  fallbackName?: string | null;
}): string {
  const savedName = cleanName(input.savedName);
  const childName = cleanName(input.childName);
  if (
    savedName
    && savedName !== childName
    && savedName !== "AI 친구"
    && !LEGACY_DEFAULT_AI_FRIEND_NAMES.has(savedName)
  ) return savedName;
  return cleanName(input.fallbackName) || DEFAULT_AI_FRIEND_NAME;
}
