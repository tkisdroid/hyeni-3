export const DEFAULT_AI_FRIEND_NAME = "통통이";

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
  if (savedName && savedName !== childName && savedName !== "AI 친구") return savedName;
  return cleanName(input.fallbackName) || DEFAULT_AI_FRIEND_NAME;
}
