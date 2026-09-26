/**
 * Service Worker 캐시에 저장하거나 꺼내 쓸 정적 자산 응답이 경로 형식과 맞는지 판정한다
 * (2026-09-26 Safari 홈 화면 앱 제보: 수학·영단어가 새로고침해도 계속 크래시).
 *
 * Pages는 없는 경로에도 index.html(200 text/html)을 준다. 배포 전환 중 받은 이 응답이 JS 이름으로
 * 캐시에 들어가면, Workbox precache는 같은 이름을 다시 받지 않으므로 그 화면이 계속 열리지 않는다.
 * JS·CSS 경로는 해당 MIME일 때만 저장·사용하고, 나머지 자산은 상태 코드만 본다.
 */
export function isUsableAssetResponse(pathname: string, status: number, contentType: string | null): boolean {
  if (status !== 200) return false;
  const type = (contentType ?? "").toLowerCase();
  if (/\.m?js$/u.test(pathname)) return type.includes("javascript");
  if (/\.css$/u.test(pathname)) return type.includes("text/css");
  return true;
}
