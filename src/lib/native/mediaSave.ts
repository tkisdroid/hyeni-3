/**
 * 대화 사진을 기기에 저장한다.
 *
 * 네이티브(Android): WebView 가 인증된 상태로 받은 이미지를 base64 로 넘겨 MediaSavePlugin 이
 * 갤러리(Pictures/혜니캘린더)에 저장한다. R2 토큰·URL 은 네이티브 경계를 넘지 않는다.
 * 웹(PWA): a[download] 로 브라우저 다운로드에 맡긴다.
 */
import { getNativePlugin, isNativePlatform } from "./plugins";

export type MediaSaveFailure =
  | "permission_denied"
  | "unsupported"
  | "failed";

export type MediaSaveResult =
  | { ok: true; target: "gallery" | "download" }
  | { ok: false; reason: MediaSaveFailure };

interface MediaSavePlugin {
  saveImage(options: { base64: string; fileName: string; mimeType: string }): Promise<{ saved: boolean }>;
}

/** Blob → base64 본문(data URL 접두 제거). */
async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/** 저장 파일명 — 사용자가 갤러리에서 알아볼 수 있도록 날짜를 넣는다. */
export function buildSavedPhotoFileName(mimeType: string, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `hyeni-${stamp}.${extensionFor(mimeType)}`;
}

function saveViaBrowserDownload(blob: Blob, fileName: string): MediaSaveResult {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 클릭 직후 해제하면 다운로드가 취소될 수 있어 다음 틱으로 미룬다.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, target: "download" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * 이미지 URL을 받아 기기에 저장한다. 호출자는 결과에 맞는 문구를 보여준다
 * (실패를 성공처럼 안내하지 않는다).
 */
export async function saveImageToDevice(imageUrl: string): Promise<MediaSaveResult> {
  if (!imageUrl) return { ok: false, reason: "failed" };

  let blob: Blob;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return { ok: false, reason: "failed" };
    blob = await res.blob();
  } catch {
    return { ok: false, reason: "failed" };
  }

  const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const fileName = buildSavedPhotoFileName(mimeType);

  if (!isNativePlatform()) return saveViaBrowserDownload(blob, fileName);

  const plugin = getNativePlugin<MediaSavePlugin>("MediaSave");
  if (!plugin?.saveImage) return { ok: false, reason: "unsupported" };

  try {
    const base64 = await blobToBase64(blob);
    if (!base64) return { ok: false, reason: "failed" };
    const result = await plugin.saveImage({ base64, fileName, mimeType });
    return result?.saved ? { ok: true, target: "gallery" } : { ok: false, reason: "failed" };
  } catch (error) {
    const code = String((error as { message?: string })?.message ?? "");
    if (code.includes("storage_permission_denied")) return { ok: false, reason: "permission_denied" };
    return { ok: false, reason: "failed" };
  }
}
