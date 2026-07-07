# FINAL_QA_CHECKLIST

작성일: 2026-07-08 KST

| 항목 | 상태 | 증거 |
|---|---|---|
| Node 테스트 | PASS | `node --test tests/*.test.ts tests/*.test.mjs` 41 pass |
| TypeScript | PASS | `npm run typecheck` exit 0 |
| Production build | PASS | `npm run build` exit 0 |
| Capacitor sync | PASS | `npx cap sync android` exit 0 |
| Android assemble | PASS | `./gradlew assembleDebug` BUILD SUCCESSFUL |
| A17 설치 | PASS | `adb -s RFKL40DP73J install -r ...` Success |
| razr 설치 | PASS | `adb -s ZY22H9VTQD install -r ...` Success |
| A17 부모 세션 | PASS | role parent, `/mine` family id 일치 |
| razr 아이 세션 | PASS | role child, `/mine` family id 일치 |
| 라우트 smoke | PASS | A17 39개, razr 14개 failure 0 |
| Cloudflare Pages 배포 | PASS | 배포 URL/production URL 200 |
| Worker typecheck | PASS | hyeni-1 worker `npx tsc --noEmit` exit 0 |
| D1 원격 조회 | PASS | key tables 존재, `changed_db=false` |
| R2 bucket | PASS | `child-photos` 존재 |
| lint | N/A | package.json에 lint script 없음 |
| migrations list | N/A | Worker repo에 `migrations/` 폴더 없음 |

## 출시 전 잔여 확인

- Play Console 실제 가격/스토어 배포는 사용자 콘솔 작업이다.
- 실발사 알림 3종은 운영 시간대와 실제 수신자 영향을 고려해 별도 승인 시간에 반복 검증한다.
