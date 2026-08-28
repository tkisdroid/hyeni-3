const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "text/html; charset=UTF-8",
};

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return character;
    }
  });
}

const ANDROID_CALLBACK_ORIGIN = "https://hyeni-calendar.pages.dev";
const ANDROID_CALLBACK_PATH = "/oauth/callback";
const ANDROID_OAUTH_SCHEME = "com.hyeni.calendar.oauth";
const ANDROID_PACKAGE = "com.hyeni.calendar";

/**
 * verified App Link가 아직 준비되지 않은 새 설치에서도 정확한 Android 패키지로 복귀한다.
 * 임의 URL을 intent로 바꾸지 않고 Worker가 발급한 고정 native callback만 허용한다.
 */
export function createAndroidOAuthIntentUrl(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    if (
      parsed.origin !== ANDROID_CALLBACK_ORIGIN
      || parsed.pathname !== ANDROID_CALLBACK_PATH
      || parsed.hash
      || parsed.username
      || parsed.password
    ) return null;
    return `intent://oauth/callback${parsed.search}#Intent;scheme=${ANDROID_OAUTH_SCHEME};package=${ANDROID_PACKAGE};end`;
  } catch {
    return null;
  }
}

export function oauthCallbackResponse(label: string, targetUrl: string): Response {
  const androidIntentUrl = createAndroidOAuthIntentUrl(targetUrl);
  const launchTarget = androidIntentUrl ?? targetUrl;
  const escapedTarget = escapeHtmlAttribute(launchTarget);
  const linkLabel = androidIntentUrl ? "앱 열기" : "여기를 눌러주세요";
  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escapeHtmlAttribute(label)} 로그인 진행 중...</title>
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:white;text-align:center;padding:24px;}</style>
</head><body>
<div>
  <div style="font-size:18px;font-weight:700;margin-bottom:12px;">로그인 마무리 중...</div>
  <div style="font-size:13px;opacity:0.85;">앱이 자동으로 열리지 않으면 <a href="${escapedTarget}" style="color:white;text-decoration:underline;">${linkLabel}</a></div>
</div>
<script>(() => {
  const retryUntil = Date.now() + 15000;
  const launch = () => {
    // Google passkey/FIDO 뒤에는 Chrome 주소창이 focus를 가져 문서 focus가 false여도
    // 콜백 문서는 화면에 보인다. visibility만 확인해 package-bound intent를 제한적으로 재시도한다.
    if (Date.now() > retryUntil || document.visibilityState !== "visible") return;
    location.replace(${JSON.stringify(launchTarget)});
  };
  addEventListener("focus", launch);
  addEventListener("pageshow", launch);
  document.addEventListener("visibilitychange", launch);
  launch();
  setTimeout(launch, 250);
  setTimeout(launch, 1000);
})();</script>
</body></html>`;
  return new Response(html, { status: 200, headers: SECURITY_HEADERS });
}

export function invalidOAuthCallbackResponse(): Response {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 다시 시도</title></head><body><main><h1>로그인을 마치지 못했어요</h1><p>앱으로 돌아가 처음부터 다시 시도해 주세요.</p></main></body></html>`;
  return new Response(html, { status: 400, headers: SECURITY_HEADERS });
}
