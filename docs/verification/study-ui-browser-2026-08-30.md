# 혜니캘린더 Study UI 출시 전 검증 — 2026-08-30

## 검증 대상

- Calendar 후보: `51d49f8b63e93d11d0b8d5ef897fe030e155bdcb`
- Study private Worker 후보: `a12d8daea0b61ff44b1df839279993bdf76c9b5d`
- 실행 환경: Windows, production `dist`, 격리된 Chrome 프로필, 한국어 locale
- 데이터 경계: 합성 가족·아이·미션 fixture만 사용했으며 운영 계정과 학습 기록은 변경하지 않았다.

## 통과한 자동 게이트

- Calendar 전체 테스트: 2,072/2,072 통과
- Calendar Worker 전체 테스트: 1,438/1,438 통과
- 앱/Worker TypeScript: 통과
- i18n: 10개 locale 카탈로그·PWA manifest·Android locale·사용자 노출 literal·오류 surface 통과
- Task 8 locale 감사: 22,068개 항목 통과
- production build: 초기 자체 JS 368,076/500,000바이트, 초기 CSS 44,996/48,000바이트, PWA precache 480개
- 브라우저 QA: 부모 44화면, 아이 15화면, 문제 0건
- PWA 런타임: install·offline·안전 업데이트 문제 0건

## Study 핵심 사용자 흐름

- 부모 홈의 Study 카드는 외부 링크나 iframe 없이 내부 `#/study`로 이동한다.
- 명시적으로 선택한 자녀의 리포트·정답률·개념 숙련도를 표시한다.
- 부모 학년 override 저장과 생년월일 기준 복구 후 row version 재조회가 동작한다.
- 이용 국가 미확정 대표 보호자는 KR 확인 후 진입하고, 보조 보호자·국외 가족·역할이 다른 직접 접근은 차단된다.
- Study 장애 상태에서도 Calendar 세션과 부모 홈은 유지되고 Study 카드만 닫힌다.
- 아이 홈의 Study 타일은 내부 `#/study/learn`으로 이동한다.
- 새 미션 시작, 활성 미션 이어하기, 답 제출, 정답 피드백, 완료 저장을 확인했다.
- 첫 제출 503 뒤 같은 idempotency key로 재전송되어 중복 제출 없이 완료됐다.
- 학년을 정할 수 없는 아이에게 family/member/grade 선택 입력을 노출하지 않고 보호자 확인 경로만 제공한다.
- 키보드 첫 초점, 48px 뒤로 버튼, 200% 확대(scale 2), 가로 overflow 0을 확인했다.

## 증거

- Browser report: `artifacts/release-evidence/browser-qa/20260830T054900Z-p181308-ed326bf6/report.json`
  - SHA-256 `5a1e00a9baefc07fc83edbfa514d59c5478fe0387f48918ccc3dad6e7467aaaf`
- PWA report: `artifacts/release-evidence/pwa-runtime-qa/20260830T055523Z-p185672-a2548e5c/report.json`
  - SHA-256 `908c3bc4ae886449418818394e9c64c086502d28d0b5f3e81378a31cdb988db5`
- `dist/index.html` SHA-256 `054fee154afb39366bdfa427015bba495f966fc519d02850f9c333f84eb1a3c9`
- `dist/sw.js` SHA-256 `583902da04528f4b3bbcf92a738ee3c547a89398f088d39f8815c3fdc0a49b07`

## 현재 판정 경계

이 문서는 Calendar 웹/PWA 수용 검증 통과를 확정한다. Android release 패키징·실기기 WebView, 원격 D1 migration, Service Binding 배포, 단계별 feature flag 활성화와 운영 smoke는 이후 출시 단계에서 별도로 통과해야 한다. Play Store 업데이트는 이번 범위에 포함하지 않는다.
