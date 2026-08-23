# Google Play Console 제출 패키지 — 혜니캘린더 v1.4.0

기준일: 2026-08-23

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.0` / `versionCode 12`

현재 판정: **프로덕션 제출·API readback 완료**

이 문서는 v1.4.0 제출 상태의 정본이다. v1.3.0 등록정보·그래픽 자산·정책 선언의 상세 이력은
`docs/store/play-console-submission-v1.3.0.md`에 보존한다. 비밀번호, 심사 계정 자격 증명,
refresh·구매·서명 토큰은 저장소나 출시 증거에 기록하지 않는다.

## 1. Play Console 실측 기준선

2026-08-23 Android Publisher API로 제출 직전 실측한 결과는 다음과 같다.

- 전체 트랙에 업로드된 최대 `versionCode`는 6이다.
- 프로덕션의 `혜니캘린더 1.3.0 (6)`은 `completed` 상태였다.
- 내부 테스트의 `1.3.0 (5)`는 내부 테스터에게 제공 중이다.
- v1.4.0은 기존 심사를 임의로 취소하지 않는다. 사용자가 2026-08-23 등록과 최종 제출까지 자동 진행하도록
  명시 승인했으므로 대상 앱·프로덕션 트랙·AAB를 자동 검증한 뒤 제출한다.

기존 프로덕션 AAB의 역사 증거는 10,539,140 bytes, SHA-256
`6b31166c7b6e141ed451a81970ed78a4a934ea1ecd8cc31addd4024f9d0dbc45`다. 이 값은 v1.4.0
산출물 증거로 재사용하지 않는다.

## 2. 새로운 기능

Play 출시 노트 정본은 `docs/store/play-release-notes-v1.4.0.md`다.

```text
아빠가 아이를 위해 만든 혜니캘린더를 더 안정적으로 다듬었어요.
· 공동 보호자 일정 등록 오류 수정
· iPhone Safari 일정 등록 안정화
· AI 친구 메시지 전송 안정화
· 주변 소리 청취 기록 오류 안내 개선
· 앱 이름과 아이콘 새단장
```

앱 문구와 등록정보에는 AI가 사람인 것처럼 오인시키는 표현을 쓰지 않는다. 음성 인식 입력과 Android
기기 TTS 재생은 각각 사용자 설정·플랫폼 지원 상태를 존중하고, 실패하면 텍스트 대화를 계속 사용할 수 있다.
가격·할인·무료 프로모션을 넣지 않고 실제 가격과 체험 조건은 Google Play 결제 화면만 정본으로 사용한다.

## 3. 이번 후보의 변경 경계

- 앱/PWA/Android: v1.4.0 및 `versionCode 12`로 올린다.
- Worker/D1: v1.4.0 버전 번호만을 위한 소스·스키마 변경은 없으므로 재배포하지 않는다.
- Pages: 새 앱 번들과 `app-version.json`을 배포하되, 기존 설치에는 `blockingUpdate:false`의 권장 업데이트만
  표시한다. Play에서 v1.4.0을 실제로 받을 수 없는 동안에는 공개 배포 시점을 별도로 판단한다.
- 선생님 모드: v1.4.0 프로덕션에서도 비활성 상태를 유지한다.
- 스토어 그래픽·정책 영상·앱 액세스·Data Safety: 기능 경계가 달라진 항목만 재검토하고, 변경하지 않은
  v1.3.0 자료는 기존 SHA-256·Console readback을 역사 증거로 사용한다.

## 4. 완료 조건

- [x] 앱 전체 1,908/1,908, TypeScript, production build 통과
- [x] Worker 전체 1,272/1,272와 typecheck 통과(무변경 확인용)
- [x] Android unit, lint, `assembleDebug` 통과
- [ ] v1.4.0/code 12 debug APK를 필요 시 실기기에 `npm run android:install:debug -- <serial>`로 보존 설치하고 버전 확인
- [x] clean commit `b6e3e84` 기준 승인 업로드 키 서명 release AAB 생성
- [x] 인증서, source SHA, non-debuggable, manifest, 16KB 정렬, AAB SHA-256 증거 확인
- [x] 커밋을 `origin/main`에 푸시
- [x] Pages 배포 후 배포별 주소·고정 URL의 새 제목과 entry readback 확인
- [x] Play 업로드 직전 대상 앱·프로덕션 트랙·기존 최대 code 6·AAB code 12 교차 확인
- [x] 최종 심사 전송까지 사용자 실행 승인 확보(2026-08-23)
- [x] Android Publisher API validate·commit 후 프로덕션 code 12·등록정보·아이콘·출시 노트 readback

## 5. S25 설치 안전 기록

사용자가 기존 S25 앱을 직접 삭제한 뒤 재설치를 요청했다. 따라서 기존 앱 데이터와 세션은 이미 삭제됐으며
복구할 수 없다. v1.4.0 설치는 패키지 `com.hyeni.calendar`와 exact serial `R5CY521CFNZ`만 대상으로 하고,
앱 실행·로그인·역할 전환·세션 또는 토큰 조회는 하지 않는다.

## 6. 최종 제출 증거

- source commit: `b6e3e84abd126670766b025730af8e5274c6679f`
- AAB: `artifacts/release-evidence/play-upload-v1.4.0-vc12-b6e3e84/hyeni-calendar-v1.4.0-vc12-b6e3e84.aab`
- 크기: 12,697,989 bytes
- AAB SHA-256: `60d6da74593ef7ba384e009a0bb80c55c2488db1983e80c79f35fc5d8af8dbdf`
- Play readback: `혜니캘린더 1.4.0 (12)` / production / `completed`
- 등록 이름: `혜니캘린더 - 우리아이 일정&안전 한번에`
- Play 아이콘 SHA-256: `b36b840603fa6870adbc6823d238a8513b1f3ce4e59b2c4a8f95c873d58570e8`
- Pages 배포: `https://ba35ac2e.hyeni-calendar.pages.dev`
- Pages entry: `assets/index-Dv5q4xDb.js`, SHA-256 `f617fcd6607bc4ce291d93ef8de91530334ff47fd7f4a2b1e6e3a8e29c7c0911`

Play API의 `completed`는 해당 편집의 전체 출시 의도를 뜻한다. Google의 심사·스토어 캐시 전파 완료 시각까지
보장하지 않으므로 실제 공개 버전 전환은 Play Console/스토어에서 후속 readback한다.
