# 위치·출발 알림 및 장소명 수정 검증 — 2026-09-13

서버와 웹에는 반영했다. Android 코드는 수정·컴파일·단위 검증과 Debug APK 생성까지 완료했으며, 연결된 실기기가 없어 설치와 실이동 검증은 남아 있다.

## 원인과 변경

- 운영 제보 대상에서 약 95분의 실측 보고 공백을 확인했다. 보고가 재개된 뒤 정확도 기준을 충족한 첫 위치부터 출발 알림 생성까지는 약 6초였다. 서버 자료만으로 기기의 GPS 취득 중단과 통신 중단 중 어느 쪽인지 확정하지 않았다.
- 자동 위치 복구의 첫 10~15분 구간이 빠지는 계산을 수정했다. 10분 초과 첫 cron부터 복구를 요청한다. 등록장소 부근의 일시 끊김은 20분 초과 지속할 때 경고하고, 전원·배터리·미등록 장소의 경고는 기존 10분 기준을 유지한다. 반복 유예 중에도 30분 이상 지속하거나 전원 이상으로 바뀌면 알린다.
- 저배터리 판정을 가족 전체가 아닌 해당 아이로 제한했다. 실제 경고를 억제한 끊김에 불필요한 회복 알림을 만들지 않는다.
- 연결 끊김·회복 알림의 표시 유효기간을 10분으로 줄였다. 반대 상태가 확정되면 같은 아이의 이전 미전달 알림을 만료하고, 알림 이력과 실제 표시 ACK는 보존한다. SOS·위험구역·미도착 알림의 유효기간은 유지한다.
- Android 이동 감지 등록은 비동기 성공 후 확정하며 실패 시 다음 heartbeat에서 재시도한다. 첫 HTTP 요청이 실패해도 위치 원본이 파일 큐에 남도록 저장 순서를 수정했다. 등록장소 알림은 최초 사건 시각·멱등키·다음 상태를 저장해 같은 내용으로 재전송하며, 다른 세션이나 삭제된 장소의 늦은 응답이 상태를 덮지 못하게 했다.
- Kakao는 건물명을 우선하고, 건물명이 없을 때만 동일 주소·35m 이내의 유일한 상호를 사용한다. Google은 해당 지오코딩 결과의 이름 또는 정확히 같은 place ID의 이름을 사용한다. 불명확하거나 조회에 실패하면 주소를 유지한다. 미등록 도착 알림과 현재 위치가 같은 지도 공급자 변환을 사용한다.
- 이동 기록의 미등록 체류 장소에도 지도명을 표시한다. 조회는 화면에 표시한 아이·실측 시각을 기준으로 하며, 다른 시각의 최신 위치명을 붙이지 않는다. 서버의 무료 위치 지연·이력 범위 및 아이 본인 권한을 유지한다.

## 검증

| 계층 | 결과 |
|---|---|
| 앱 | `npm test`: 2,127개 통과, fail 0 |
| Worker | `npm run test:worker`: 1,500개 통과, fail 0 |
| 타입·번들 | 앱/Worker 타입 검사, production build, Worker dry run 통과 |
| PWA | precache 491개 중복 없음, 초기 번들 예산·물리 OAuth callback 검사 통과 |
| Android | GeofenceStateMachine 22개, LocationBuffer 9개, LocationFixPolicy 8개, RegisteredPlaceAlertPayload 1개, RegisteredPlaceAlertRetry 2개: 총 42개 통과 |
| 브라우저 | 390×844·1440×1000의 현재 위치/이동 기록, 응답 시각 불일치, 지도 API 실패의 4개 시나리오 통과. 페이지 예외·수평 넘침 없음 |

브라우저는 격리된 Chromium에서 production dist와 가상 가족·지도 응답을 사용했다. 실제 지도 공급자의 특정 건물명 응답이나 실제 휴대폰 알림 도착을 확인한 증거로 확대 해석하지 않는다.

## 운영 반영

- 작업 기준: `origin/main`의 `27e14a427b39aa0710142b49b9be7397e498a1af`에 이번 미커밋 변경을 적용한 `fix/location-alert-reliability` 작업폴더. 원래 작업폴더의 수정·미추적 파일은 보존했다. 커밋·푸시·main 병합·Play 제출은 하지 않았다.
- 배포 전 필수 Worker Secret 이름 10개와 D1의 `idx_pending_notifications_expiry` 정의를 확인했다. 이번 수정에 새 migration은 없다.
- Worker: `c50f774c-a7f3-48a4-bd2b-db12aaf0f48c`, 운영 트래픽 100%. 배포 후 `/api/health`는 `200`, `ready`, `no-store`; 무인증 `/api/maps/reverse`는 `401`이다.
- Pages: <https://9b8c7c3d.hyeni-calendar.pages.dev>. 이 배포 주소, 고정 Pages 주소, `hyenicalendar.com`, `www.hyenicalendar.com`에서 문서·진입 JS/CSS·Service Worker·OAuth callback이 모두 200이며 로컬 SHA-256과 일치했다.
- 진입 자산: `assets/index-CLDRMRo8.js`, SHA-256 `5a88da968c0bd2141b315101a947540bfc4f29e83c60c0bda94526683e8f3547`. 기존 운영 번들에 포함된 공개 Google 웹 지도 설정도 유지했다.
- D1 `hyeni-calendar`: 해당 아이가 활성·connected이고 5분 이내 실측이 있는 조건에서 10분 지난 과거 연결 알림 10건의 만료 시각만 변경했다. 원래 값 백업과 동일 SQL의 메모리 DB 리허설 후 적용했으며, readback으로 대상 10건 만료·이력 보존·ACK 불변을 확인했다. 후속 조회의 유효한 과거 연결 알림은 0건이다.

## 남은 기기 검증

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 16,416,067바이트, SHA-256 `83DA339C5BA467AABA07C1E41E791175C50BCCEE1B02E6C2EC3EF6ADDD5C764C`.
- 최종 `adb devices -l`은 연결 기기 0대였다. A17·razr·S25의 데이터·세션은 조작하지 않았다. 아이 기기 연결 후 이 작업폴더에서 `npm run android:install:debug -- ZY22H9VTQD`로 기본 사용자 0에 덮어 설치하고 출발·통신 단절/회복을 실기기로 확인해야 한다.
- 이 Debug APK에는 Android Google Maps 운영 키가 주입되지 않았다. 국내 Kakao 경로용 설치 후보이며, Play 서명 인증서로 제한된 Google 지도와 해외 실기기 동작은 별도 검증이 필요하다. 공개 스토어용 AAB는 생성하지 않았다.

로컬 증거: `C:/Users/TK/AppData/Local/Temp/hyeni-location-alerts-20260913/`의 `app-full.log`, `worker-full.log`, `android-final-build.log`, `browser/report.json`, `deployment-readback.json`, `obsolete-link-alert-expiry-result.json`.
