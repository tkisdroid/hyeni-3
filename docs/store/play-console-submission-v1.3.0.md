# Google Play Console 제출 패키지 — 혜니캘린더 v1.3.0

기준일: 2026-08-15

패키지: `com.hyeni.calendar`

버전: `versionName 1.3.0` / `versionCode 6`

현재 판정: **Play Console 등록 진행 중 — versionCode 6 코드·검증·스토어 자산·정책 영상 파일·Worker 배포는 준비됐고, YouTube 일부 공개 저장·Play 정책 선언·심사 계정·서명 AAB 업로드가 남아 있음**

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

짧은 설명과 자세한 설명은 `docs/store/play-listing.md`의 코드 블록을 그대로 사용한다. 등록정보에는 가격·할인·무료 프로모션을 넣지 않고 실제 가격과 체험 조건은 Google Play 결제 화면에서만 보여 준다.

### 새로운 기능

```text
가족 일정과 아이 안전 기능을 더 안정적으로 다듬었어요.
· 위치·도착 알림과 원격 안전 기능의 전달 신뢰성을 개선했어요.
· 가족 대화 전송과 알림 표시를 더 빠르고 안전하게 보완했어요.
· 알림 조용한 시간, 안심리포트와 프리미엄 안내를 정리했어요.
· 오류 제보와 접근성, 가로 화면 사용성을 개선했어요.
```

## 2. 그래픽 자산

다음 `output/play-store-final-v1/` 파일만 업로드 정본으로 사용한다. `output/store-screenshots/`, `output/store-safe-assets-v1/`, `output/store-listing-assets-v1/`, `output/store-ui-candidates-v1/`은 직접 업로드하지 않는다.

| 용도 | 파일 | 대체 텍스트 |
|---|---|---|
| 앱 아이콘 | `output/play-store-final-v1/play-icon-512.png` | 실제 Android 설치 아이콘과 같은 혜니캘린더 앱 아이콘 |
| 피처 그래픽 | `output/play-store-final-v1/play-feature-graphic-1024x500.png` | 가족 일정과 아이 안전을 한 곳에서 관리하는 혜니캘린더 |
| 휴대전화 1 | `output/play-store-final-v1/01-parent-home.png` | 오늘 일정과 아이 안전 상태를 확인하는 보호자 홈 |
| 휴대전화 2 | `output/play-store-final-v1/02-family-calendar.png` | 가족 일정을 월간으로 확인하는 가족 캘린더 |
| 휴대전화 3 | `output/play-store-final-v1/03-family-conversation.png` | 보호자와 아이가 메시지와 위치를 나누는 가족 대화 |
| 휴대전화 4 | `output/play-store-final-v1/04-daily-safety-report.png` | 아이의 하루 안전 정보를 보여 주는 안심 리포트 |
| 휴대전화 5 | `output/play-store-final-v1/05-weekly-family-report.png` | 가족의 한 주 일정과 대화를 요약한 주간 리포트 |
| 휴대전화 6 | `output/play-store-final-v1/06-child-home-sos.png` | 오늘 일정과 SOS 버튼을 쉽게 사용할 수 있는 아이 홈 |

기술 검사는 1080×1920, 불투명 RGB, 개인정보 패턴·텍스트 메타데이터 없음으로 통과해야 한다. 여섯 장을 육안 검토한 뒤 `output/play-store-final-v1/technical-review.json`의 `playUploadApproved=true`를 확인한 경우에만 Console에 업로드한다.

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

Play Console에서 받은 `deployment_cert.der`를 직접 파싱해 앱 서명 키 SHA-256
`98:09:2B:A4:B5:E1:BB:6D:97:8E:D8:75:29:4A:B3:1B:66:06:8E:8A:9F:6A:46:F9:3D:45:BD:CC:F2:8E:64:4F`를 확인했고,
`public/.well-known/assetlinks.json`의 개발용 debug 지문을 이 값으로 교체했다. 다음 순서를 지킨다.

1. production build와 Pages 배포 후 `https://hyeni-calendar.pages.dev/.well-known/assetlinks.json`의 HTTPS 200·콘텐츠·캐시를 확인한다.
2. 별도 업로드 키 재설정을 완료한 뒤 승인된 업로드 키로 최신 source commit의 release AAB를 만든다.
3. Play가 서명한 내부 테스트 설치본에서 `https://hyeni-calendar.pages.dev/oauth/callback` App Link 검증과 소셜 로그인 복귀를 확인한다.
4. 업로드 키를 재설정해도 `assetlinks.json`은 업로드 인증서가 아니라 위 Google Play 앱 서명 키 SHA-256을 계속 사용한다.

## 6. 2026-08-15 Play Console 등록 현황

완료된 항목:

- 승인된 업로드 키로 서명한 `versionCode 5` AAB를 Play에 업로드했다. Play가 읽은 값은 `versionName 1.3.0`, 최소 API 24, target SDK 36이며 프로덕션 임시 버전 이름은 `혜니캘린더 1.3.0 (5)`다. 이 파일은 이전 후보의 역사 증거이며 최신 제출본으로 재사용하지 않는다.
- 스토어 제목, 46자 짧은 설명, 1,731자 자세한 설명, Android 설치 아이콘과 같은 Play 아이콘, 피처 그래픽, 실제 production UI 기반 휴대전화 스크린샷 6장을 등록했다.
- 프로덕션 출시 초안에 AAB와 한국어 출시 노트를 넣고 2단계 미리보기까지 진행했다.
- 구독 `hyeni_premium`의 월간 `monthly-2900`은 KRW 4,900, 연간 `annual-27840`은 KRW 39,000으로 활성 상태다. 두 base plan의 `trial-7d`는 한국 신규 구독자에게 `P7D` 무료 체험으로 활성 상태이며 범위는 `anySubscriptionInApp`이다.
- 개인정보처리방침, Data Safety, 콘텐츠 등급, 타겟층 만 9세 이상, 광고 없음, 건강 앱, 금융 기능, 정부 앱, 전체 화면 인텐트 선언은 Console의 조치됨 상태다.
- 출시 미리보기의 차단 오류는 백그라운드 위치 선언과 Foreground Service 선언 두 건으로 확정했다.
- 최신 후보를 `versionCode 6`으로 올렸고 production build, 앱 1,298/1,298, Worker 1,161/1,161, Android unit 175/175·lint·assembleDebug를 통과했다. 현재 debug APK는 13,279,364 bytes, SHA-256 `74911c1ffdee285c6fc9cb95f3bed2b0ec8ff30816935cc1c45a2405b650d96e`다.
- A17 부모에 `adb install -r`로 최신 debug APK를 설치해 부모 세션이 보존된 홈과 razr 실제 기기명 `motorola razr 40 ultra` 표시를 확인했다. S25는 접근하지 않았다.
- 스토어 자산은 최신 dist 417파일, tree SHA-256 `aa6c305e4cf7a88e3607249ac80b242ebae479372d8ac00879abd24ae955e426`에서 다시 생성해 기술·육안 검토 후 `playUploadApproved=true`로 고정했다.
- Worker를 version ID `c4c769c3-b4d5-4ba1-8c68-ef2ba22c742c`로 배포하고 `/api/health` 200과 인증 없는 reverse-geocode 요청 401을 확인했다.
- 사용자가 A17·razr 정책 영상 촬영을 허용해 실제 기기 화면을 촬영했고, 개인정보·프로필·정밀 위치를 가린 무음 최종본 두 개만 YouTube 비공개 초안으로 업로드했다.

비차단 경고 두 건:

- R8/ProGuard 가독화 파일 없음: release 설정이 `minifyEnabled false`이므로 생성되는 `mapping.txt`가 없어 현재 빌드에는 해당 파일을 업로드하지 않는다.
- 네이티브 디버그 기호 없음: AAB의 서드파티 네이티브 라이브러리에 대응하는 별도 기호 산출물이 없으며 Play가 경고로만 분류한다. 이번 AAB를 다시 서명하지 않고 유지한다.

## 7. 제출 직전 필요한 실제 정보

### 7.1 심사 전용 로그인 정보

현재 저장된 “특수한 액세스 권한 없이 모든 기능 사용 가능” 선언은 실제 로그인·구독 구조와 맞지 않으므로 제출 전에 반드시 **제한된 부분 있음**으로 바꾼다. 비밀번호는 사용자만 Console에 직접 입력한다.

- 만료되지 않는 심사 전용 보호자 계정
- 심사 전용 아이가 이미 같은 가족에 연결된 상태
- 프리미엄 기능 전체 접근 가능
- 2단계 인증, 일회용 PIN, 위치 제한 없음
- 실제 사용자 이름·일정·위치가 아닌 데모 데이터만 포함

영문 심사 안내 500자:

```text
Sign in with the provided parent review account. A demo child is already paired. From Parent Home, review the family calendar, child location and route history, Today Safety Report, notifications, family chat, subscription, and Settings. Teacher mode is not included in this release. Location, alerts, ambient sound, and device status require the paired Android child device to be online with permissions granted. The demo account has premium access; do not create a new family or start a free trial.
```

계정과 비밀번호를 입력한 뒤 “프리미엄 또는 유료 콘텐츠를 포함하여 전체 액세스 권한을 제공” 체크박스를 선택하고 세부정보를 추가한다.

### 7.2 정책 시연 영상 2개

Google은 URL 형식만이 아니라 실제 제출 앱의 권한 안내, 백그라운드 동작, 사용자에게 보이는 지속 알림을 확인하므로 정적 화면이나 합성 영상으로 대체하지 않는다. 사용자가 2026-08-15 A17 부모·razr 아이의 정책 영상 촬영을 명시 허용했고, 현재 역할·세션·페어링을 유지한 실제 기기 흐름을 촬영했다. 개인정보·프로필·정밀 위치는 비식별 처리하고 오디오는 제거했다. 원본은 업로드하지 않고 1920×1080 최종본만 사용한다.

백그라운드 위치 앱 목적:

```text
혜니캘린더는 가족 일정 공유와 자녀 안전 확인을 위한 앱입니다. 보호자는 가족 일정과 준비물을 관리하고, 연결된 자녀의 현재 위치·이동 경로·등록 장소 도착·출발을 확인하며 SOS와 안전 알림을 받을 수 있습니다. 자녀 앱은 화면이 꺼져 있거나 다른 앱을 사용하는 동안에도 위치를 업데이트해 보호자가 등하교와 귀가 상황을 확인할 수 있게 합니다.
```

백그라운드 위치 단일 핵심 기능:

```text
자녀 위치·이동 경로 및 등록 장소 도착·출발 알림입니다. 아이 모드에서 기능 활성화 전 “앱을 사용하지 않을 때도 위치를 수집해 보호자에게 공유한다”는 별도 안내를 표시하고, 사용자가 동의한 뒤 Android의 항상 허용 권한 화면으로 이동합니다. 화면이 꺼지거나 앱이 백그라운드여도 위치를 수집해 보호자 지도와 안전 알림을 갱신합니다.
```

영상 A, 백그라운드 위치와 지오펜싱, 최종본 약 47초(Play 권장 30초 이하는 권장값이며 필수 장면을 연속으로 식별 가능하게 유지):

1. 아이 모드에서 백그라운드 수집을 명시한 prominent disclosure를 보여 준다.
2. 동의 버튼을 누르고 Android의 위치 권한과 항상 허용 설정을 보여 준다.
3. 앱을 백그라운드로 보내 위치 공유 지속 알림이 보이는 상태를 보여 준다.
4. 보호자 화면에서 아이의 최신 위치와 이동 경로가 갱신되는 모습을 보여 준다.
5. 등록 장소 도착·출발 알림이 보호자에게 보이는 모습을 보여 준다.

영상 B, 마이크와 `emergency_parental_alert`, 최종본 약 48초:

1. 보호자가 위급 주변 소리를 시작하고 아이 화면·잠금 화면·지속 알림에 청취 중임이 표시되는 모습을 보여 준다.
2. 최대 1분 상한과 아이 알림의 중지 동작을 보여 준다.
3. 보호자가 응급 신호 소리 울리기를 시작하고 아이 기기의 명확한 전체 화면 또는 heads-up 알림과 지속 알림을 보여 준다.
4. 아이 확인, 보호자 중지 또는 설정 시간 종료로 서비스가 끝나는 모습을 보여 준다.

Console URL 매핑:

| 입력란 | 링크 |
|---|---|
| 백그라운드 위치 선언 | 영상 A — `https://youtu.be/yTfCI3RsVE8` |
| FGS 사용자 시작 위치 공유 | 영상 A — `https://youtu.be/yTfCI3RsVE8` |
| FGS 지오펜싱 | 영상 A — `https://youtu.be/yTfCI3RsVE8` |
| FGS 기타 백그라운드 위치 업데이트(자녀 위치 추적기) | 영상 A — `https://youtu.be/yTfCI3RsVE8` |
| FGS 백그라운드 오디오 입력 | 영상 B — `https://youtu.be/cb_BFyed6uE` |
| FGS 특수 용도 기타 | 영상 B — `https://youtu.be/cb_BFyed6uE` |

현재 두 URL은 YouTube 비공개 초안이다. 외부 반영 확인 직후 제목·설명·`아동용 아님`·`일부 공개`를 저장하고 로그아웃 브라우저에서 링크 재생 가능 여부를 확인해야 한다.

특수 용도 권한 사용 설명:

```text
보호자가 연결된 아이 기기에 응급 신호를 보내면 FCM 명령을 받은 아이 앱이 즉시 포그라운드 서비스와 명확한 지속 알림을 시작해 소리를 재생합니다. 아이가 확인하거나 보호자가 중지하거나 설정 시간이 끝나면 종료합니다. 응급 신호는 도착 후 바로 알려야 하므로 작업을 미루거나 일시중지할 수 없고, 서비스가 중단되면 아이가 신호를 놓칠 수 있습니다.
```

두 영상 링크와 심사 계정이 저장되면 프로덕션 미리보기의 오류 두 건을 다시 검사한다. 그 전에 최신 clean commit의 versionCode 6 서명 AAB를 업로드해 versionCode 5 초안을 대체한다. 오류가 없어지면 출시 초안을 저장하고 게시 개요의 **검토를 위해 앱 전송**을 별도 최종 확인 뒤 실행한다.
