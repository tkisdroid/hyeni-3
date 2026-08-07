export const DEFAULT_CHILD_AVATAR = "mascot/wave.webp";

export function childAvatarPath(photoUrl: string | null | undefined): string {
  const value = photoUrl?.trim();
  return value && (value.startsWith("http") || value.startsWith("blob:"))
    ? value
    : DEFAULT_CHILD_AVATAR;
}
