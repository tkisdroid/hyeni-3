# 영단어·부모 풀이 조회 검증 기록

2026-09-12. 변경은 앱 `35ed585`와 Study `e295008`에서 만든 `feat/study-vocabulary-history`에 격리했다. 원래 작업 디렉터리의 수정·미추적 파일을 보존했다. 운영 D1·Worker·Pages·Play는 이 작업에서 변경하지 않았다.

## 구현 결과

| 영역 | 동작 |
| --- | --- |
| 아이 미니앱 | 영어 5단계, 총 4,067개. 새 단어·복습·모든 단어, 카드 뒤집기, 서버 자가평가 저장 |
| 부모 영어 | 선택한 아이의 단계별 확인 수·복습 수와 실제 평가 이력 |
| 부모 수학 | 실제 문제·그림·선택지·아이의 답·정답·해설·시각·힌트·시도 횟수, 20개씩 추가 조회 |
| 실패·격리 | 같은 요청 재시도, D1 부분 실패 원복, 다른 가족/아이 제외, 조회 오류·빈 기록·원문 누락 구분 |

영어 단계별 수는 352/352/813/1,322/1,228개다. 영어 자가평가와 수학 정답률은 합산하지 않는다. 출처의 뜻을 사용하고 시작 단어 93개는 짧은 대표 뜻을 발췌했다. 공식 학년별 필수 어휘나 인증 등급으로 표시하지 않는다.

## 실행 증거

| 검증 | 결과 |
| --- | --- |
| `npm test` | 2,105/2,105, fail 0 |
| Calendar `npm run test:worker` | 1,459/1,459, fail 0 |
| Study `pnpm run test:worker` | 24파일, 289/289 |
| 앱·Calendar Worker·Study Worker 타입 검사 | 통과 |
| `npm run i18n:verify` | 10개 언어, 생성물·manifest·오류 표면 검사 통과 |
| 앱 production build | exit 0, PWA 423개 URL 중복 0, 총 5,540,602/6,291,456 bytes |
| Study migration 검증 | schema 1~10 연속성 및 관련 2개 회귀 통과 |
| Study `wrangler deploy --dry-run` | 번들 생성 통과, gzip 275.46 KiB, 운영 업로드 없음 |
| 기존 실제 수학 3,384개 → 앱 파서 | 전수 통과. 18개 문항의 `alternative:string[]` 형식 불일치를 수정한 뒤 재검증 |
| `node scripts/qa-study-learning.mjs <저장소 밖 경로>` | 12개 검사 통과: 320/390/1280px, 한국어·영어, 키보드/동작 줄이기, 재시도·복습·부모 조회·아이 전환·역할 차단 |

브라우저는 production dist와 격리된 fixture API로 확인했다. Study 통합 테스트는 실제 테스트 D1·DO·서명 RPC를 사용하며, Calendar Hono 권한 테스트는 별도 서비스 stub을 사용한다. 이를 운영 HTTP 전체 E2E로 표시하지 않는다. 실제 음성 스크린리더, 네이티브 Android 동작은 미검증이다.

최종 브라우저 증거 위치: `%TEMP%/hyeni-study-vocabulary-history-20260912/browser-final/`의 `report.json`과 PNG. 전체 로그는 그 상위 디렉터리에 있다. 공개 어휘 카탈로그와 Worker 어휘 카탈로그의 SHA-256은 둘 다 `3baf62697c17c243466a69cbf1f66b6c0ae05b44cc40adf8e96a66b8aefea97c`다.

## 운영·기기 경계

`adb devices -l` 결과 연결 기기는 0대였다. 앱 설치와 실제 계정 검증을 수행하지 않았으며 기존 기기의 계정·역할·페어링·refresh를 변경하지 않았다.

실사용 적용은 Study D1 `0010_vocabulary_learning.sql` → Study Worker → Calendar Worker → 앱 순서다. schema 9에서 10으로 바뀌는 동안 기존 Study readiness가 닫히므로 변경 창에서 후속 배포까지 이어야 한다. Study 저장소 `docs/vocabulary-and-history-operations.md`에 자료 재현, 배포 및 schema 호환 롤백 범위를 기록했다.
