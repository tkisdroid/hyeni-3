# Google Play Console 업데이트 패키지 — 혜니캘린더 v1.4.1

기준일: 2026-08-24

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.1` / `versionCode 13`

현재 판정: **업데이트 산출물 준비 중**

이 문서는 v1.4.1 업데이트 준비 상태의 정본이다. 기존 프로덕션 v1.4.0/code 12의 제출·readback 증거는
`docs/store/play-console-submission-v1.4.0.md`에 역사 기록으로 보존한다. 이번 문서의 체크 항목은 실제 증거가
생긴 뒤에만 완료로 바꾸며, 비밀번호·심사 계정 자격 증명·refresh·구매·서명 토큰은 기록하지 않는다.

## 변경 내용

- 아이 홈의 다음 일정 지도 노드·혜니 말풍선·`길찾기 출발!`을 `/route` 전체 지도에 직접 연결한다.
- 아이 길찾기는 본인 기기 GPS를 우선 사용하고 실패하면 서버의 마지막 본인 위치로 강등한다.
- 구독 상품 조회 실패, 잘못된 아이 대화 링크, 아이 미연결 부모 홈에 화면 내 복구 행동을 제공한다.
- 부모 홈 바로가기는 번역 문구가 아니라 고정 id로 이동하고 하단 탭 탐색 이름은 현재 언어의 라벨을 사용한다.
- Google Play offer·가격 검증 실패는 알 수 없는 오류 대신 상품을 불러오지 못했다는 부모용 안내를 표시한다.
- Worker와 D1 계약은 바뀌지 않으므로 앱 버전만을 위한 Worker 재배포는 하지 않는다.
- 선생님 모드는 v1.4.1 프로덕션에서도 기존 출시 gate를 유지한다.
- Play에서 1.4.1 제공 가능 상태를 확인하기 전에는 `app-version.json`의 latest/minimum을 1.4.0으로 유지해
  설치 앱을 아직 없는 업데이트로 보내지 않는다. Play readback 뒤 별도 정책 배포로 1.4.1을 알린다.

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.1.md`의 코드 블록 문구를 사용한다. 가격·할인·무료
프로모션은 문구에 넣지 않고 실제 가격과 체험 가능 여부는 Google Play 결제 화면을 정본으로 사용한다.

## 완료 조건

- [x] 앱 전체 테스트 `1,932/1,932`, TypeScript, production build 통과
- [x] Worker 전체 테스트 `1,274/1,274`와 typecheck 통과(Worker 무변경 확인용)
- [x] 브라우저 부모 43화면·아이 14화면과 PWA 설치/오프라인/업데이트 QA 문제 0건
- [x] Android unit test, lint, `assembleDebug` 통과
- [ ] clean 최신 commit으로 승인 업로드 키 서명 AAB 생성
- [ ] AAB의 인증서, `versionName 1.4.1`, `versionCode 13`, source SHA, non-debuggable, 16KB 정렬 확인
- [ ] AAB SHA-256·크기·mtime과 검증 JSON을 같은 evidence 폴더에 보존
- [ ] `main` 커밋을 `origin/main`에 푸시하고 Pages 새 배포 readback
- [ ] Play Console 업로드·심사 전송은 사용자 지시와 실제 readback 증거가 있을 때만 완료 처리

## 실기기 보호

연결된 허용 기기에는 `npm run android:install:debug -- <serial>`로 기본 사용자 0에만 `-r` 설치한다.
로그아웃·역할 전환·재페어링·refresh token 조회/회전은 하지 않는다. S25는 역할 의존 검증 전에 CDP로 역할을
확정하고, 연결되지 않은 기기를 억지로 재연결하지 않는다.
