/**
 * 시스템 공유 시트(카카오톡·라인·Gmail 등).
 * 사용자 탭에서만 호출한다. 웹은 Web Share API, 네이티브는 ACTION_SEND 선택기.
 */
import { getNativePlugin, isNativePlatform } from "./plugins";

export type SharePlainResult = "shared" | "cancelled" | "copied" | "unavailable";

interface ShareSheetPlugin {
  share(input: { title: string; text: string; url: string }): Promise<{ shared?: boolean }>;
}

function canUseWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function copyFallback(text: string): Promise<SharePlainResult> {
  if (!navigator.clipboard?.writeText) return "unavailable";
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "unavailable";
  }
}

function composeShareBody(text: string, url: string): string {
  if (!url) return text;
  if (!text) return url;
  return text.includes(url) ? text : `${text}\n${url}`;
}

export async function sharePlainContent(input: {
  title: string;
  text: string;
  url: string;
}): Promise<SharePlainResult> {
  const title = input.title.trim();
  const text = input.text.trim();
  const url = input.url.trim();
  const body = composeShareBody(text, url);
  if (!body) return "unavailable";

  if (canUseWebShare()) {
    try {
      const payload: ShareData = { title, text: body };
      if (url && typeof navigator.canShare === "function") {
        const withUrl = { ...payload, url };
        if (navigator.canShare(withUrl)) {
          await navigator.share(withUrl);
          return "shared";
        }
      }
      await navigator.share(url ? { ...payload, url } : payload);
      return "shared";
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
    }
  }

  if (isNativePlatform()) {
    const plugin = getNativePlugin<ShareSheetPlugin>("ShareSheet");
    if (plugin) {
      try {
        await plugin.share({ title, text: body, url });
        return "shared";
      } catch {
        // 네이티브 시트가 없으면 복사로 강등한다.
      }
    }
  }

  return copyFallback(body);
}
