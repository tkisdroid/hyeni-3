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

export function oauthCallbackResponse(label: string, targetUrl: string): Response {
  const escapedTarget = escapeHtmlAttribute(targetUrl);
  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escapeHtmlAttribute(label)} 로그인 진행 중...</title>
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:white;text-align:center;padding:24px;}</style>
</head><body>
<div>
  <div style="font-size:18px;font-weight:700;margin-bottom:12px;">로그인 마무리 중...</div>
  <div style="font-size:13px;opacity:0.85;">앱이 자동으로 열리지 않으면 <a href="${escapedTarget}" style="color:white;text-decoration:underline;">여기를 눌러주세요</a></div>
</div>
<script>setTimeout(function(){location.replace(${JSON.stringify(targetUrl)});}, 200);</script>
</body></html>`;
  return new Response(html, { status: 200, headers: SECURITY_HEADERS });
}

export function invalidOAuthCallbackResponse(): Response {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 다시 시도</title></head><body><main><h1>로그인을 마치지 못했어요</h1><p>앱으로 돌아가 처음부터 다시 시도해 주세요.</p></main></body></html>`;
  return new Response(html, { status: 400, headers: SECURITY_HEADERS });
}
