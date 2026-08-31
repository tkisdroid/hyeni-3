# Google Play Console 안정화 출시 패키지 — 혜니캘린더 v1.4.5

기준일: 2026-08-31

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.5` / `versionCode 17`

현재 판정: **출시 후보 준비 중 — production 1.4.4 (16)는 검토 중, code 17은 서명·제출 전**

## 출시 범위

- 빈 전화번호를 가진 아이도 이름·생일을 정상 저장하고, 저장 실패 안내는 화면의 구체적인 팝업 하나만 표시한다.
- 아이 전화번호 아래의 “아이 기기가 없어도 연락할 번호예요” 문구를 제거한다.
- 등록장소 도착·출발 알림은 실제 사건 시각을 표시하고, 사건 시각부터 30분이 지난 지연 전달은 새로 보내지 않는다.
- 부모 학습 화면과 접근 게이트의 상단 safe-area 여백을 다른 상세 화면과 맞춘다.
- 부모 홈 두 번째 히어로를 “혜니캘린더 미니앱이 출시되었어요 / 학습도 할 수 있어요”로 바꾼다.

## Play 기준선

- 2026-08-31 Google Play Console 읽기 전용 확인에서 production `혜니캘린더 1.4.4 (16)`은
  `검토 중인 변경사항`이며 작업은 `전체 출시 시작`으로 표시됐다.
- code 16은 이미 사용됐으므로 이번 후보는 재사용하지 않고 versionCode 17을 쓴다.
- 새 code 17 제출은 기존 code 16 검토를 대체하며, 제출 뒤에도 `IN_REVIEW`와 실제 게시 완료를 구분한다.

## D1·Worker 경계

- `origin/main` 이후 이번 출시 변경에는 D1 schema 또는 migration 파일 변경이 없다. 운영 D1에 임의 SQL을 적용하지 않는다.
- Worker는 아이 프로필의 빈 전화번호 정규화와 장소 알림 사건 시각·30분 TTL 변경을 포함하므로 전체 회귀 뒤 재배포한다.
- D1은 스키마 readback만 수행하고 `rows_written=0`을 확인한다.

## 완료 조건

- [ ] 앱·Worker 전체 테스트, typecheck, i18n verify, production build 통과
- [ ] Android unit·lint·debug APK 통과
- [ ] 운영 D1 readback `rows_written=0`, Worker 배포·health 확인
- [ ] Pages 배포와 고정·브랜드 도메인 자산 일치 확인
- [ ] A17·S25 사용자 0 보존 설치와 versionName 1.4.5/versionCode 17 확인
- [ ] clean source commit에서 승인 upload certificate 서명 AAB 생성·검증
- [ ] Play production code 17 업로드·제출 후 fresh lifecycle readback

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.5.md`의 text 코드 블록을 사용한다.
