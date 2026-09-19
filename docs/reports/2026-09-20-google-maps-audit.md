# 해외 Google 지도 점검·수정 — 2026-09-20

사용자의 배포 진행 지시에 따라 최신 1.4.9 기반 Google 지도 수정본을 운영 웹에 배포했다. 최종 배포는 https://1cf06a72.hyeni-calendar.pages.dev 이며 https://hyenicalendar.com 에 반영됐다. 기존 운영의 부모 설정 로딩 개선과 유리 스타일도 함께 보존했다. 미완료 인증·세션 변경은 포함하지 않았다.

## 확인한 정본과 배포 불일치

- 기존 작업 폴더 `/Users/tk/orca/hyeni-3`: `1e59801`, 앱 `1.4.2`. Google 지도 구현 이전이다.
- 실제 원격 main: `2848bf99efbffa7f3b51c0aa10fff6792bf4e7ad`, 앱 `1.4.9`.
- 점검 시작 당시 브랜드·고정 Pages의 entry: `assets/index-Bqdl1de2.js`. KakaoMap 청크·Kakao 주소 검색·Kakao 도보 API를 사용한다. Google URL은 외부 길찾기 링크이며 인앱 지도 구현이 아니다.
- 최신 소스의 이전 정상 배포 기록: `https://fbf16999.hyeni-calendar.pages.dev`. Google 웹 지도 키·공통 FamilyMap과 Google 어댑터를 포함한다.
- 운영 Worker는 health `200 ready`, 무인증 `/api/maps/search`는 `401`이다. 지도용 서비스 계정·세션 시크릿 이름과 D1 `families.country_code/time_zone` 존재만 읽었다. 자격 값·실사용 토큰을 읽거나 가족 정보를 바꾸지 않았다.
- 수정 작업 폴더: `.worktrees/google-maps-audit-20260920`, 브랜치 `fix/google-maps-audit-20260920`. 기존 폴더의 로그인·세션·유리 스타일 수정은 그대로 보존했다.

## 수정한 문제

1. Google 웹 지도 실패 화면에서 SDK host가 사라져 재시도해도 지도를 생성하지 못했다. host를 유지하고 실제 클릭 가능한 재시도 레이어와 로딩 상태를 복구했다. 빈 배열 기본값도 고정해 오류 상태 렌더가 자동 재시도를 일으키지 않게 했다.
2. 핀·주소 정보만 바뀌어도 지도 중심·확대가 초기화됐다. 명시적 중심·재중앙 요청·화면 여백이 바뀔 때만 이동하고 사용자 확대를 유지한다. 이력 패널을 피하는 viewport padding을 적용했다.
3. Android는 장면 데이터가 바뀔 때마다 native 지도를 재생성했다. 생성과 장면 갱신을 분리하고 native 작업·destroy를 직렬화했다. 생성/marker 갱신 중 화면을 떠나도 늦은 지도를 제거한다.
4. Android native 지도 앞의 body/html·중간 배경과 부모 화면의 가상 배경이 남을 수 있었다. 조상 요소별 참조계수로 투명화하고 마지막 지도 해제 때 기존 배경 선언·우선순위·장식 클래스를 복구한다.
5. 실제 Google SDK 검증에서 `fonts.googleapis.com` 스타일시트가 CSP로 차단됐다. 해당 정확한 호스트만 style-src에 추가했다. 결제 redirect 보호용 `no-referrer`는 유지한다.
6. `npm run verify:pages-maps` 및 `npm run deploy:pages`를 추가했다. 원격 최신 main을 포함하지 않은 소스, 누락된 Google 청크·웹 키·공통 API·CSP는 배포 전에 실패시킨다. 배포 명령은 새로 빌드한 뒤 검증하며 Worker용 `.env`가 없는 임시 경로에서 Wrangler를 실행한다.

## 최종 운영 배포 검증

- 최종 entry: `assets/index-CqtF0rCH.js`. 배포별 주소·고정 Pages·브랜드 apex·www의 4개 origin에서 origin당 14개 자산을 로컬 dist와 해시 대조해 일치를 확인했다. OAuth callback·CSP·no-referrer·Worker health도 통과했다.
- 최종 운영 공개 키로 실제 Google SDK 12개국 좌표 검사를 다시 통과했다.
- 설정·지도·보안·스타일 집중 회귀 90/90, 디자인 수정 관련 검사 3/3, 경로 번들 예산 16/16 통과. typecheck와 새 production build 성공.
- 설정 WebKit·Chromium 12개 시나리오, 320·390px 오류·overflow 검사 통과. 지도 오류 스타일을 지도 청크로 옮겨 초기 CSS 예산을 유지했다.
- 배포 증거: 기존 작업 폴더 `artifacts/google-maps-audit-20260920/deployment.json`.

## 수정 과정 검증

- 앱 typecheck·production build: 통과.
- 지도·보안 헤더·배포물 집중 회귀: 54/54, `fail 0`.
- Worker 지도·권한·검색 세션·quota·Google adapter 회귀: 29/29, `fail 0`.
- 전체 앱 검사: 2,166/2,167. 유일한 실패는 Java Runtime 부재로 Android 병합 manifest를 생성할 수 없는 환경 오류다. 새 배포물 검사 4개는 이후 집중 실행에 포함했다.
- 실제 React 어댑터의 격리 Chrome 검사: 실패 후 재시도·핀 선택·확대 유지·padding·좌표 이동·리스너 제거·native 생성 및 marker 갱신 중 이탈·중첩 투명 배경 원복 통과. native SDK는 fixture이므로 Android 실기기 성공을 의미하지 않는다.
- 수정 전 Google 웹 어댑터를 같은 하니스에 넣으면 재시도 후 지도 생성 대기로 실패한다. 수정본에서는 통과한다.
- 운영 공개 웹 키·실제 Google SDK·현재 수정본의 CSP/no-referrer로 JP/TW/HK/SG/VN/TH/ID/MY/PH/US/GB/AU 12개국의 고정 좌표에서 타일 로딩과 인증 성공, CSP 위반 0을 확인했다. 실제 가족 API·좌표·세션은 사용하지 않았다. 한국에서 해외 좌표를 표시한 검사이며 해당 국가 통신망에서의 접근성 검사는 아니다.
- 구형 기존 작업 폴더에 배포 검사를 실행하면 최신 원격 main 미포함으로 차단된다.

## 남은 범위

- Android 변경은 새 앱 빌드·서명·스토어 업데이트 전에는 기존 설치 앱에 반영되지 않는다. 이번 작업에서 실기기 설치·스토어 제출은 하지 않았다.
- Google Routes adapter는 원래부터 `unavailableRoute()`만 반환한다. 앱 내부 도보 경로는 미구현/비활성이고 Google Maps 외부 길찾기가 대체 경로다. 최소 OAuth 범위 실검증 없이 광범위 권한이나 다른 공급자로 우회하지 않았다.
- 인증된 별도 해외 테스트 가족의 실제 Places/Geocoding 요청·장소 저장·부모 PWA와 아이 Android 알림 E2E는 수행하지 않았다. Worker fixture 통과를 실운영 E2E 성공으로 표현하지 않는다.

재실행: `npm run dev -- --host 127.0.0.1 --port 5198` 후 `npm run qa:map-adapters`.
실SDK 검사는 `node scripts/qa-google-maps-web-canary.mjs`로 실행한다. 현재 운영 웹에서 공개 키를 읽으며 키 값은 출력하지 않는다.
