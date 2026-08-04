const SAFE_FAMILY_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** private R2 proxy에 전달해도 URL 경로 정규화가 일어나지 않는 상대 객체 키만 허용한다. */
export function validatePrivateObjectPath(path: string | null | undefined): string | null {
  const value = path?.trim() ?? "";
  if (!value || value.length > 512 || value.startsWith("/") || value.includes("\\") || /[\u0000-\u001F\u007F]/.test(value)) {
    return null;
  }
  const segments = value.split("/");
  if (
    !SAFE_FAMILY_SEGMENT.test(segments[0] ?? "")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return value;
}

/** 서버 photo_url에서 Authorization fetch가 필요한 child-photos 객체 키만 추출한다. */
export function extractPrivateChildPhotoPath(urlOrPath: string | null | undefined): string | null {
  const value = urlOrPath?.trim() ?? "";
  if (!value) return null;

  const match = value.match(
    /\/(?:storage\/v1\/object\/(?:public|sign)|api\/storage)\/child-photos\/([^?#]+)/,
  );
  if (match) {
    try {
      return validatePrivateObjectPath(decodeURIComponent(match[1]));
    } catch {
      return null;
    }
  }

  if (/^(?:https?:|blob:|data:)/i.test(value)) return null;
  return validatePrivateObjectPath(value.split(/[?#]/, 1)[0] ?? "");
}
