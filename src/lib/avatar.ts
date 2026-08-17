export const DEFAULT_CHILD_AVATAR = "mascot/wave.webp";

export function childAvatarPath(photoUrl: string | null | undefined): string {
  const value = photoUrl?.trim();
  return value && (value.startsWith("http") || value.startsWith("blob:"))
    ? value
    : DEFAULT_CHILD_AVATAR;
}

/**
 * 부모 아바타 — 등록한 프로필 사진(표시용 URL)이 있으면 그 사진, 없으면 성별 기본 캐릭터.
 * 사진 등록은 2026-08-17부터 지원하며, 성별 미상은 mom 캐릭터를 기본으로 쓴다.
 */
export function parentAvatarPath(
  photoUrl: string | null | undefined,
  gender: string | null | undefined,
): string {
  const value = photoUrl?.trim();
  if (value && (value.startsWith("http") || value.startsWith("blob:"))) return value;
  return gender === "dad" ? "family/dad.webp" : "family/mom.webp";
}
