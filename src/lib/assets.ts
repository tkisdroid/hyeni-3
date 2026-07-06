/**
 * public/assets 자원 경로 헬퍼.
 * base('./')와 HashRouter 조합에서도 안전하게 해석되도록 BASE_URL을 접두합니다.
 *   asset("ui/battery.webp") → "./assets/ui/battery.webp"
 */
export const asset = (path: string): string =>
  import.meta.env.BASE_URL + "assets/" + path.replace(/^\/+/, "");
