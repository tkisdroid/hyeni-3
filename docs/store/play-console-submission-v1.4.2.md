# Google Play Console 업데이트 패키지 — 혜니캘린더 v1.4.2

기준일: 2026-08-25

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.2` / `versionCode 14`

현재 판정: **출시 후보 메타데이터 준비·서명 AAB 생성 전**

이 문서는 기존 혜니 캐릭터의 짧은 입체 도약 변경을 Google Play에 전달하는 v1.4.2 업데이트 기록의 정본이다.
실제 AAB·배포·API 증거가 생긴 뒤에만 해당 상태를 완료로 바꾸며, 비밀번호·서비스 계정 키·refresh token은 기록하지
않는다.

## 변경 내용

- 기존 투명 WebP 18종 캐릭터와 상황별 표정은 그대로 유지한다.
- 아이 홈에서 혜니가 자리를 옮길 때 1.5초 perspective 도약·squash/stretch·부드러운 착지를 보여 준다.
- 발밑 그림자는 도약 높이에 맞춰 작아지고 접지할 때 퍼져 입체감을 보강한다.
- 드래그·탭/길게 누르기·대화·일정 안내·SOS 비겹침·움직임 줄이기 계약은 유지한다.
- GLB·Three.js·Blender·신규 생성 이미지는 포함하지 않는다.

## 현재 운영 경계

- 2026-08-25 fresh Android Publisher API readback에서 code 13은 `RELEASE_LIFECYCLE_STATE_IN_REVIEW`다.
- 기존 공개 code 6은 `RELEASE_LIFECYCLE_STATE_PUBLISHED`이고 전체 bundle 최대 versionCode는 13이다.
- v1.4.2는 더 높은 code 14로만 제출하며, 제출 직전 같은 상태를 다시 확인한다.
- D1은 신규 migration이 없으므로 어떤 migration도 실행하지 않는다. production D1은 읽기 전용으로만 확인한다.
- Worker source도 직전 배포 뒤 바뀌지 않았지만 사용자 지시에 따라 전체 테스트 후 현재 정본을 재배포한다.
- code 14가 Play에서 `PUBLISHED`되기 전에는 `public/app-version.json`의 minimum/latest를 1.4.0으로 유지한다.
- 기존 Play 등록정보·icon·feature graphic·phone screenshots는 write API로 변경하지 않는다.

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.2.md`의 text 코드 블록을 그대로 사용한다.

## 완료 조건

- [ ] 앱·Worker 전체 테스트, typecheck, production build 통과
- [ ] D1 변경 SQL 없음과 production 읽기 query `changes=0` 확인
- [ ] Worker 새 version ID와 health 200 readback
- [ ] Pages 세 도메인 동일 entry/CSS hash와 OAuth callback 확인
- [ ] razr 사용자 0에 code 14 debug APK 보존 설치
- [ ] clean source commit에서 승인 upload certificate signed AAB 생성
- [ ] AAB version/source/certificate/권한/web assets/16KB 증거 확인
- [ ] Android Publisher API validate·commit 후 code 14 심사 전송과 fresh lifecycle readback
- [ ] 기존 listing/image hash가 제출 전후 동일함을 확인

## 실기기 보호

razr `ZY22H9VTQD`에는 `npm run android:install:debug -- ZY22H9VTQD`로 사용자 0에만 보존 설치한다. 로그아웃·
역할 전환·재페어링을 하지 않고 refresh token을 읽거나 회전하지 않는다.
