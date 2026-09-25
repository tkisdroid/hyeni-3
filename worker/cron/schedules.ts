// cron 표현식 정본. Worker 진입 파일(index.ts)에서 문자열을 export 하면 workerd 가 named export 를
// 진입점(함수·핸들러)으로 해석하다 거부해 `wrangler dev` 가 시작하지 못한다(2026-09-25 확인).
// 그래서 상수는 이 모듈에 두고 진입 파일은 import 만 한다.
export const HOURLY_MAINTENANCE_CRON = "0,5,10,15,20,25,30,35,40,45,50,55 * * * *";
