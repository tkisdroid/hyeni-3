# Google Play Console 제출 패키지 — 혜니캘린더 v1.3.0

기준일: 2026-08-04

패키지: `com.hyeni.calendar`

버전: `versionName 1.3.0` / `versionCode 5`

현재 판정: **HOLD — 로컬 산출물은 준비됐지만 서명·Console·운영·실기기 게이트가 남아 있음**

이 문서는 Play Console에 입력할 값과 아직 사람이 확인해야 하는 값을 분리한 제출 정본이다. 비밀번호, 심사 계정 자격 증명, 구매·인증 토큰은 저장소나 출시 패키지에 기록하지 않는다.

## 1. 등록정보

| Console 항목 | 입력값 |
|---|---|
| 앱 이름 | 혜니캘린더 - 우리 가족 일정과 아이 안전 |
| 기본 언어 | 한국어(대한민국) |
| 앱/게임 | 앱 |
| 카테고리 | 육아(Parenting) |
| 광고 포함 | 아니요 |
| 지원 이메일 | `mail@hyenicalendar.com` |
| 웹사이트 | https://hyeni-calendar.pages.dev |
| 개인정보처리방침 | https://hyeni-calendar-api.tkisdroid.workers.dev/privacy |
| 데이터 삭제 안내 | https://hyeni-calendar-api.tkisdroid.workers.dev/data-deletion |
| 앱 내 구매 | 예 — Google Play 정기 결제 |

짧은 설명과 자세한 설명은 `docs/store/play-listing.md`의 코드 블록을 그대로 사용한다. 가격은 Play 결제 화면에서 월 4,900원·연 39,000원인지 확인된 경우에만 현재 문안을 유지한다.

### 새로운 기능

```text
가족 일정과 아이 안전 기능을 더 안정적으로 다듬었어요.
· 위치·도착 알림과 원격 안전 기능의 전달 신뢰성을 개선했어요.
· 가족 대화 전송과 알림 표시를 더 빠르고 안전하게 보완했어요.
· 알림 조용한 시간, 안심리포트와 프리미엄 안내를 정리했어요.
· 오류 제보와 접근성, 가로 화면 사용성을 개선했어요.
```

## 2. 그래픽 자산

다음 파일만 업로드 후보로 사용한다. `output/store-screenshots/`와 `output/store-safe-assets-v1/`은 업로드하지 않는다.

| 용도 | 파일 | 대체 텍스트 |
|---|---|---|
| 앱 아이콘 | `output/store-listing-assets-v1/play-icon-512.png` | 혜니캘린더의 하트 모양 가족 일정 앱 아이콘 |
| 피처 그래픽 | `output/store-listing-assets-v1/play-feature-graphic-1024x500.png` | 가족 일정과 아이 안전을 함께 관리하는 혜니캘린더 |
| 휴대전화 1 | `output/store-ui-candidates-v1/01-parent-home-ui.png` | 오늘 일정과 아이 안전 상태를 확인하는 보호자 홈 |
| 휴대전화 2 | `output/store-ui-candidates-v1/02-family-calendar-ui.png` | 가족 일정을 월간으로 확인하는 가족 캘린더 |
| 휴대전화 3 | `output/store-ui-candidates-v1/03-family-memo-ui.png` | 보호자와 아이가 메시지를 나누는 가족 대화 |
| 휴대전화 4 | `output/store-ui-candidates-v1/04-daily-safety-report-ui.png` | 아이의 하루 안전 정보를 보여 주는 안심리포트 |
| 휴대전화 5 | `output/store-ui-candidates-v1/05-weekly-family-report-ui.png` | 가족의 한 주 일정과 안전 정보를 요약한 주간 리포트 |
| 휴대전화 6 | `output/store-ui-candidates-v1/06-child-home-ui.png` | 일정과 SOS를 쉽게 사용할 수 있는 아이 홈 |

기술 검사는 1080×1920, 불투명 RGB, 개인정보 패턴·텍스트 메타데이터 없음으로 통과했다. `output/store-ui-candidates-v1/technical-review.json`의 `playUploadApproved=false`는 유지한다. 실제 Console 업로드 전 정책 책임자가 여섯 장을 육안 승인해야 한다.

## 3. 앱 액세스

Console에서 **일부 또는 모든 기능이 제한됨**을 선택한다. 보호자 로그인과 이미 연결된 아이가 필요한 앱이므로 반복 사용할 수 있는 심사 전용 보호자 계정을 Console의 비공개 앱 액세스 입력란에 직접 저장한다. 자격 증명은 이 저장소에 저장하지 않는다.

심사 안내 문안:

```text
혜니캘린더는 보호자 계정 로그인 후 가족 기능을 사용할 수 있습니다. 제공한 심사 전용 보호자 계정에는 심사 전용 아이 계정이 이미 연결되어 있습니다. 보호자 홈에서 가족 캘린더, 위치, 오늘의 안심리포트, 알림, 가족 대화, 설정을 확인할 수 있습니다. 선생님 모드는 이번 버전의 출시 범위가 아닙니다. 위치·알림·주변 소리 기능은 연결된 Android 아이 기기의 권한과 네트워크 상태가 필요합니다.
```

Console에 자격 증명을 넣기 전에 다음을 확인한다.

- 심사 기간 동안 만료·2단계 인증·IP 제한 없이 반복 로그인 가능
- 보호자와 심사 전용 아이가 이미 같은 가족에 연결됨
- 실제 사용자 데이터가 아닌 심사 전용 데모 데이터만 포함
- 비밀번호 변경이나 아이 재페어링 없이 핵심 화면 접근 가능
- 프리미엄 기능을 심사해야 하면 Play 라이선스 테스터 계정과 상품 상태를 별도로 준비

## 4. 정책 질문의 확인된 사실

### 대상 연령과 Families

보호자와 아이 모드를 함께 제공하고 아이가 일정·대화·SOS·AI 기능을 직접 사용하므로 성인 전용으로 제출하지 않는다. 정밀·백그라운드 위치를 사용하는 현재 앱을 아동 전용으로 제출하지 않는다. 실제 이용자 근거에 맞는 혼합 연령 구간, 외부 SDK·API의 Families 적격성, 중립적 연령 화면 필요 여부를 정책 책임자가 승인하기 전에는 대상 연령 설문을 확정하지 않는다.

### 콘텐츠 등급

IARC 질문에는 다음 실제 기능을 숨기지 않고 답한다.

- 가족 구성원끼리 메시지·사진·위치를 공유하는 비공개 UGC
- AI가 생성하는 일정 후보·대화·요약
- 위치 공유, 도착·출발·위험 장소 알림
- 보호자가 위급 상황에 최대 1분간 요청하는 주변 소리
- UGC와 AI 답변 신고, 사용자 차단, 운영자 검토 기능

등급 결과는 Console 설문이 산출하므로 저장소에서 등급값을 미리 정하지 않는다.

### Data Safety

데이터 수집은 **예**다. 상세 유형·처리 목적·필수 여부·일시 처리·공유 여부의 초안은 `docs/store/play-data-safety.md`를 사용한다. Cloudflare, Firebase/FCM, Google Play, Toss Payments, Google·Kakao·Naver OAuth, OpenAI, Kakao 지도·모빌리티, 공개 OSRM, Resend, NCP SENS, 음성 인식 처리의 실제 계약·설정과 전송 필드를 정책 책임자가 확인하기 전에는 서비스 제공자 예외와 공유 여부를 확정하지 않는다.

### 위치·모니터링·Foreground Service

- 백그라운드 위치: 아이 기기가 앱 밖에 있어도 보호자에게 위치를 공유하고 도착·출발·미도착·위험 장소 안전 기능을 제공한다.
- `location` FGS: 지속적인 위치 공유 중 아이 기기에 고유 아이콘이 있는 지속 알림을 표시한다. 중단하면 최신 위치와 장소 알림이 제한된다.
- `microphone` FGS: 보호자의 위급 상황 요청과 서버 승인 증표가 일치할 때 최대 1분 실행한다. 아이 화면과 지속 알림에 청취 중임을 표시하고 중지할 수 있으며 음성 내용은 장기 저장하지 않는다.
- `specialUse`: `emergency_parental_alert` 목적의 보호자 긴급 알림 처리다. 지연되면 보호자가 위급 신호를 늦게 확인할 수 있다.
- `isMonitoringTool`: manifest 값은 `child_monitoring`이며 스토어 설명에도 위치와 앱 사용정보 모니터링을 공개한다.

백그라운드 위치와 FGS 세 유형은 실제 아이 기기에서 권한 안내, 지속 알림, 기능 동작, 중단 영향을 한 영상으로 식별 가능하게 제출한다.

### 전체 화면 인텐트

혜니캘린더는 전화·알람 앱이 아니므로 자동 허용 대상으로 선언하지 않는다. SOS·emergency·사용자가 시작한 소리 울리기·위급 주변 소리에 한정하며, 특별 접근 권한이 없으면 높은 중요도의 heads-up 알림으로 강등된다. 일반 일정·메모·미도착 알림은 전체 화면으로 승격하지 않는다.

## 5. App Links와 서명

`public/.well-known/assetlinks.json`의 현재 지문은 개발용 debug 인증서다. 다음 순서를 지킨다.

1. 최신 소스에서 승인된 업로드 키로 release AAB를 만든다.
2. AAB를 Play Console에 업로드하고 Play App Signing을 활성화하거나 현재 설정을 확인한다.
3. **앱 서명 키 인증서**의 SHA-256을 Console에서 복사한다. 업로드 인증서 SHA-256을 대신 쓰지 않는다.
4. `public/.well-known/assetlinks.json`을 앱 서명 키 지문으로 교체한다.
5. production build와 Pages 배포 후 `https://hyeni-calendar.pages.dev/.well-known/assetlinks.json`의 HTTPS 200·콘텐츠·캐시를 확인한다.
6. Play가 서명한 설치본에서 `https://hyeni-calendar.pages.dev/oauth/callback` App Link 검증과 소셜 로그인 복귀를 확인한다.

## 6. 출시 전 남은 외부 작업

- 사용자 Gradle 설정에서 `HYENI_KEYSTORE`, `HYENI_KEYSTORE_PASSWORD`, `HYENI_KEY_ALIAS`, `HYENI_KEY_PASSWORD` 네 평문 property를 제거
- 별도 비공개 터미널의 환경변수로 최신 clean commit의 release AAB 생성
- 새 AAB의 `jarsigner`, 업로드 인증서, SHA-256, mtime, schema v4 16KB 정적 증거 확인
- Play Console에서 `versionCode 5` 미사용 여부 확인. 이미 사용됐다면 코드와 모든 제출 문서를 함께 올려 재빌드
- Play App Signing 앱 서명 인증서 지문으로 `assetlinks.json` 교체·Pages 배포·App Link E2E
- 심사 전용 보호자·아이 계정과 라이선스 테스터를 Console에 직접 입력
- 대상 연령·Families·IARC·Data Safety·백그라운드 위치·FGS·FSI 선언과 심사 영상 승인
- Google Play 상품 가격, 무료 체험 eligibility, 구매·복원·해지·환불·RTDN 실결제 E2E
- 필요한 D1 migration·secret을 승인된 변경 창에서 선행 적용하고 Worker·Pages 배포 후 readback
- A17 보호자와 razr 아이에만 `adb install -r`로 최종 설치·권한·알림·위치·결제·crash/ANR 검증. S25는 접근하지 않음
- 단계적 출시와 첫 60분 오류율·ANR·crash·알림 대기열 모니터링, 중단·rollback 책임자 확정

위 항목이 하나라도 확인되지 않으면 제출 상태는 `HOLD`다. 로컬 debug APK/AAB나 2026-07-10의 기존 release AAB는 Play 업로드 파일로 사용하지 않는다.
