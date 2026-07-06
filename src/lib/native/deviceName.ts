/**
 * 기기명(device label) 추출 — User-Agent 파싱(플러그인 무설치, WebView·PWA 공통 동작).
 *
 * 아이 기기가 자기 기기명을 부모의 '아이 관리/현황' 화면에 표시하기 위해 리포트한다.
 * Android WebView UA 예: "...; Android 16; SM-A175N Build/BP4A...; wv)" → 모델 "SM-A175N".
 * 삼성 모델("SM-*")은 제조사 힌트만 얹어 가독성을 소폭 올린다(모델번호는 유지 = 정직).
 * 미상이면 null → 부모 화면이 "기기 미확인"으로 정직 처리(가짜 이름 금지).
 */

// 흔한 삼성 모델 접두("SM-")에 제조사만 얹는다. 그 외(모토로라 등 제조사가 모델에 포함)는 그대로.
function prettifyModel(model: string): string {
  const m = model.trim().replace(/\s+/g, " ");
  if (/^SM-/i.test(m)) return `삼성 ${m}`;
  return m;
}

/** 현재 기기의 표시용 이름. 추출 불가 시 null. */
export function detectDeviceLabel(): string | null {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (!ua) return null;

  // Android(WebView): "Android <ver>; <MODEL> Build/" — 가장 일반적.
  const andBuild = ua.match(/Android[\s\d.]+;\s*([^;)]+?)\s+Build\//i);
  if (andBuild?.[1]) return prettifyModel(andBuild[1]);
  // Android(Build 토큰 없음): "Android <ver>; <MODEL>)"
  const andNoBuild = ua.match(/Android[\s\d.]+;\s*([^;)]+?)\)/i);
  if (andNoBuild?.[1]) return prettifyModel(andNoBuild[1]);

  // 부모 아이폰 PWA 등(모델 미노출 → 기기 종류만).
  if (/\biPhone\b/i.test(ua)) return "iPhone";
  if (/\biPad\b/i.test(ua)) return "iPad";
  if (/\bMacintosh\b/i.test(ua)) return "Mac";
  if (/\bWindows\b/i.test(ua)) return "Windows PC";
  return "웹 브라우저";
}
