# Google Play Console 안정화 출시 패키지 — 혜니캘린더 v1.4.5

기준일: 2026-08-31

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.5` / `versionCode 17`

현재 판정: **production 1.4.5 (17) 제출 완료 — Google Play 검토 진행 중, 게시 전**

## 출시 범위

- 빈 전화번호를 가진 아이도 이름·생일을 정상 저장하고, 저장 실패 안내는 화면의 구체적인 팝업 하나만 표시한다.
- 아이 전화번호 아래의 “아이 기기가 없어도 연락할 번호예요” 문구를 제거한다.
- 등록장소 도착·출발 알림은 실제 사건 시각을 표시하고, 사건 시각부터 30분이 지난 지연 전달은 새로 보내지 않는다.
- 부모 학습 화면과 접근 게이트의 상단 safe-area 여백을 다른 상세 화면과 맞춘다.
- 부모 홈 두 번째 히어로를 “혜니캘린더 미니앱이 출시되었어요 / 학습도 할 수 있어요”로 바꾼다.

## Play 기준선

- code 16은 이미 사용됐으므로 이번 후보는 재사용하지 않고 versionCode 17을 썼다.
- 2026-08-31 Google Play Console production에 검증된 code 17 AAB를 업로드했다. Console이
  `17 (1.4.5)`·min API 24·target SDK 36과 지원 기기 변동 0대를 읽었다.
- 출시 이름은 `혜니캘린더 1.4.5 (17)`이며, `docs/store/play-release-notes-v1.4.5.md`의 한국어 출시 노트를
  입력했다. 국가/지역 출시는 100%를 유지했다.
- 기존 code 16 심사를 취소하고 최신 code 17로 검토를 다시 시작한다는 확인을 거쳐 제출했다. 빠른 자동 검사가
  완료된 fresh readback에서 `검토 중인 변경사항`에는 code 17의 `전체 출시 시작`만 남고,
  `변경사항을 검토 중입니다`로 표시됐다. 최근 실제 게시일은 2026-08-28로 유지돼 아직 production 게시 전이다.
- 비차단 경고는 R8 매핑 파일과 네이티브 디버그 기호가 없다는 2건이었다. 이 경고를 게시 완료로 간주하지 않는다.

## 서명 AAB 증거

- clean source: `35bb1b715efdb43472d9d2a5e354a7689424a6fb`
- 파일: `android/app/build/outputs/bundle/release/app-release.aab`
- 크기: `13,114,530 bytes`
- SHA-256: `6a80f8f9209c90d380e6723ee40d359180ad957566539063d9ff87b1ac9c20c0`
- 승인 upload certificate SHA-256:
  `32f729e8cc1df82d94eacd0d264439fcd7102b15fcdc269660254a87f25a81db`
- package/version: `com.hyeni.calendar` / `1.4.5` / `17`
- non-debuggable, 서명·certificate·웹 자산·16KiB ELF 검증 모두 GREEN
- 증거 파일:
  - `artifacts/release-evidence/android-release-aab-evidence-20260831-130817-35bb1b7.json`
  - `artifacts/release-evidence/android-release-aab-verification-20260831-130817-35bb1b7.txt`
  - `artifacts/release-evidence/release-record-20260831-130817-35bb1b7-post-signing.json`

## D1·Worker 경계

- `origin/main` 이후 이번 출시 변경에는 D1 schema 또는 migration 파일 변경이 없다. 운영 D1에 임의 SQL을 적용하지 않는다.
- Worker는 아이 프로필의 빈 전화번호 정규화와 장소 알림 사건 시각·30분 TTL 변경을 포함한 version
  `a55cdf44-937b-46fd-8541-0e57d72addf2`로 배포했다. production health는 200·`no-store`·`ready`다.
- D1은 `family_members.phone` schema를 read-only로 확인했고 `changes=0`·`changed_db=false`다.

## 완료 조건

- [x] 앱 2,091/2,091·Worker 1,448/1,448, typecheck, i18n verify, production build 통과
- [x] Android unit 186/186·lint·debug APK 통과
- [x] 운영 D1 read-only `changes=0`·`changed_db=false`, Worker 배포·health 확인
- [x] Pages 배포와 고정·브랜드 도메인 최신 자산 확인
- [x] A17·S25 사용자 0 보존 설치와 versionName 1.4.5/versionCode 17 확인
- [x] clean source commit에서 승인 upload certificate 서명 AAB 생성·검증
- [x] Play production code 17 업로드·제출 후 fresh lifecycle readback
- [ ] Google Play 검토 통과와 실제 production 게시 확인

최종 마감 readback 시 A17은 계속 연결되어 1.4.5/code 17·기존 `firstInstallTime`·`MainActivity`를 다시
확인했다. S25는 앞선 보존 설치·버전 확인 뒤 연결이 끊겨 마감 시점 재조회는 하지 못했고, razr는 이번 설치 기간
내내 연결되지 않았다.

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.5.md`의 text 코드 블록을 사용한다.
