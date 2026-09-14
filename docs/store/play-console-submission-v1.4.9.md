# Play 검토 요청 — 1.4.9 (versionCode 21)

## 2026-09-14 최종 제출 확인

- 앱: `com.hyeni.calendar`, 프로덕션 출시명 `혜니캘린더 1.4.9 (21)`.
- 시스템 Chrome에서 최종 전송 확인 버튼까지 실행했다.
- 제출 활동 **ID 12**, Console 제출 시각 **2026-09-14 20:25 KST**, 상태 **검토 중** 확인.
- [제출 활동](https://play.google.com/console/u/0/developers/5454444916579168584/app/4973968570577959797/publishing/submission-activity/12/details).
- 제출한 변경사항은 프로덕션 업데이트 1건이다. 기존 10개 제공 국가, 출시율 100%, 관리형 게시 꺼짐을 유지했다.
  이 국가 수는 앱 내부 Google 지도 공급자 ISO 248개국 정책과 별개다. 이번 제출에서 국가/정책/상품 설정은 변경하지 않았다.
- 게시 개요는 `검토 중인 변경사항`으로 전환되었다. 확인 당시 Google의 빠른 자동 검사는 진행 중이며,
  검사 성공 후 본심사에 전달된다. 심사 승인·공개 게시 완료를 뜻하지 않는다. 기존 설정상 승인 뒤 자동 공개된다.
- 실기기 검증은 사용자 지시로 생략했으며 실제 설치·FCM/Web Push 수신 성공으로 기록하지 않는다.

## 빌드 증거

- source: `d7ef90526a3b5fee5db758b4e3c0cdd4595ce61f`, clean worktree에서 새 빌드.
- 파일: `artifacts/release-evidence/play-upload-v1.4.9-vc21-d7ef905/hyeni-calendar-v1.4.9-vc21-d7ef905.aab`.
- 크기: `13,610,832 bytes`.
- SHA-256: `ca6b4b8c975e25e2428954e345f4b1025313db32b73dd14c66a73d716c475818`.
- 증거: `artifacts/release-evidence/android-release-aab-evidence-20260914-194517-d7ef905.json`.
- release / non-debuggable / versionName 1.4.9 / versionCode 21 / source SHA 내장 일치.
- jarsigner·Play 업로드 인증서 일치, 웹 번들 투영 일치, 16KB bundle/APK/전체 ELF LOAD 정렬 통과.
- 사용자 직접 보안 입력으로 서명했다. 평문 서명 properties 0개, 레거시 자격정보 파일 없음.
- Play가 code 21 / target SDK 36 / API 24 이상 / ABI 4개를 처리 완료했다.
- 출시 노트 10개 언어 저장·제출 확인.

## 차단 아닌 경고 및 별도 출시 증거

- Play 버전 검증: 오류 표시 없음, 경고 3개.
- OpenGL ES 요구로 `CHAINWAY C66` 1종 지원 제외. Console 기존 설치 영향 0건.
- 가독화 파일 없음: 현재 `minifyEnabled false` 유지. 네이티브 디버그 기호 업로드 권고도 남아 있다.
- 전체 release-record는 CI/운영 provenance/운영 승인 증거 등의 별도 누락으로 HOLD를 유지한다.
  이를 AAB 서명 실패 또는 검토 요청 미접수로 혼동하지 않으며, 모든 출시 게이트 통과로 바꾸지 않는다.
- Google Routes는 비활성 상태다. 이번 버전에서 도보 경로 지원을 약속하지 않는다.
- 이번 단계에서는 Worker/Pages 재배포, 운영 D1/Secret 변경을 수행하지 않았다.
