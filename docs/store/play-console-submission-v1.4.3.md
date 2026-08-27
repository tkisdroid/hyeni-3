# Google Play Console 업데이트 패키지 — 혜니캘린더 v1.4.3

기준일: 2026-08-27

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.3` / `versionCode 15`

현재 판정: **Google Play production 심사 제출 완료 (`IN_REVIEW`)**

## 이번 업데이트 범위

- 아이 모드 시작 카드를 누르면 애니메이션 종료를 기다리지 않고 즉시 다음 단계로 이동한다.
- 비밀번호 관리자·브라우저 자동완성으로 ID와 비밀번호가 채워지면 즉시 로그인한다.
- 자동완성과 수동 입력이 겹쳐도 로그인 요청이 중복되지 않도록 단일 요청 gate를 적용한다.

## 명시적 제외 범위

- 작업 중인 locale 변경은 포함하지 않는다.
- 완성 전 새 히어로 캐러셀은 포함하지 않는다.
- Worker·D1·Pages·스토어 등록정보·이미지는 변경하지 않는다.

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.3.md`의 text 코드 블록을 그대로 사용한다.

## 제출 결과

- 제출 완료: 2026-08-27 03:10 KST
- Play 출시 이름: `혜니캘린더 1.4.3 (15)`
- production 트랙 상태: `completed`
- 출시 수명주기: `RELEASE_LIFECYCLE_STATE_IN_REVIEW`
- 직전 게시본: `혜니캘린더 1.4.2 (14)` / `RELEASE_LIFECYCLE_STATE_PUBLISHED`
- Play Console 화면 재확인: `혜니캘린더 1.4.3 (15) 검토 중`

## 제출 바이너리

- source commit: `ef2933a057f5bba58a8574feca17c82286e9d7c9`
- 파일: `hyeni-calendar-v1.4.3-vc15-ef2933a.aab`
- 크기: `13,013,743 bytes`
- SHA-256: `b2f78392f311781ac697b8107bdc4b43bf1ac75af1e3bc9b484cbe4538ed5ad3`
- 업로드 인증서 SHA-256: `32f729e8cc1df82d94eacd0d264439fcd7102b15fcdc269660254a87f25a81db`
- manifest: `com.hyeni.calendar` / `versionName 1.4.3` / `versionCode 15` / `debuggable=false`
- 16KB page alignment: bundle·universal APK·4개 native library 모두 통과

Play 업로드 응답의 code 15 AAB SHA-256과 로컬 AAB SHA-256이 일치한다.

## 검증 결과

- 앱 전체 테스트: `1,946/1,946` 통과, fail `0`
- Worker 전체 테스트: `1,298/1,298` 통과, fail `0`
- 앱·Worker typecheck: 통과
- production build·PWA bundle 검증: 통과
- Android unit: `181/181` 통과
- Android lint·assembleDebug: 통과
- 브라우저 QA: 부모 `43`, 아이 `14`, 문제 `0`; 자동완성 로그인은 요청 `1회` 및 reload 세션 유지 확인
- locale source 변경: 기준 v1.4.2 대비 `0`
- 새 히어로 캐러셀 파일: 미포함

## 변경 보존 확인

- 스토어 등록정보 전후 SHA-256: `d0c0824da0c55530dbd681af08765e69d8b34aa6f04d24aec074558f3c4b9dc9`로 동일
- 스토어 이미지 10개 전후 SHA-256: `651ef7874b929ad9062517a7a5c1605a98da8b9d04107b02f3aab4f85bdfede1`로 동일
- Worker·D1·Pages 배포: 실행하지 않음
