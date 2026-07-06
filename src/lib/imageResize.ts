/**
 * 사진 업로드 전 캔버스로 축소·압축한다(hyeni-1 imageResize.js 직역 + TS).
 *
 * 비유: 큰 종이 사진을 우편으로 부치기 전에 명함 크기로 줄여 복사하는 것 — 보는 데
 * 필요한 정보는 남기고 부피만 던다. 폰 카메라 원본(2~8MB)을 그대로 올리면 회당 수 MB
 * 모바일 데이터를 쓰므로, 긴 변을 maxEdge 로 줄이고 JPEG 품질을 낮춰 대폭 절감한다.
 *
 * 원칙: 리사이즈 실패(HEIC·메모리 등)가 등록 자체를 막지 않게, resizeImageFileSafe 는
 *       실패 시 원본 dataURL 로 폴백한다(둘 다 실패면 null).
 */

export interface ResizeOptions {
  maxEdge?: number;
  quality?: number;
}

/** 파일을 그대로 base64 dataURL 로(압축 없음). 리사이즈 실패 시 폴백 경로용. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * 긴 변 maxEdge / 품질 quality 로 축소한 JPEG dataURL 을 반환한다.
 * 원본이 maxEdge 보다 작으면 확대하지 않는다(scale 상한 1).
 */
export function fileToResizedDataUrl(file: File, opts: ResizeOptions = {}): Promise<string> {
  const maxEdge = opts.maxEdge ?? 1280;
  const quality = opts.quality ?? 0.8;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("사진을 읽지 못했어요"));
      img.onload = () => {
        try {
          const longest = Math.max(img.width, img.height);
          const scale = longest > 0 ? Math.min(1, maxEdge / longest) : 1;
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("이미지를 처리하지 못했어요"));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(e instanceof Error ? e : new Error("이미지를 처리하지 못했어요"));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 리사이즈를 시도하고, 디코드/캔버스 실패(HEIC·메모리 등) 시 원본 dataURL 로 폴백한다.
 * 항상 dataURL 문자열을 resolve(둘 다 실패하면 null) — 호출부가 한 줄로 쓰게 한다.
 */
export async function resizeImageFileSafe(
  file: File | null | undefined,
  opts: ResizeOptions = {},
): Promise<string | null> {
  if (!file) return null;
  try {
    return await fileToResizedDataUrl(file, opts);
  } catch (e) {
    console.warn("[imageResize] resize failed, falling back to original", e);
    try {
      return await fileToDataUrl(file);
    } catch (e2) {
      console.error("[imageResize] original read failed", e2);
      return null;
    }
  }
}

/**
 * dataURL(base64/URL 인코딩) → Blob. 업로드 바이너리 본문용.
 * mime 은 dataURL 헤더에서 파싱(없으면 image/jpeg).
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("사진 형식이 올바르지 않아요");
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const isBase64 = /;base64/i.test(header);
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
