# Play 출시 체크리스트 — 혜니캘린더 v1.2.0(versionCode 4)

## 현재 판정 (2026-07-14)

**제출 차단.** AI·UGC 안전조치의 코드·자동 회귀 테스트는 준비됐지만 실제 부모·아이 양방향 E2E와 운영 큐, 외부 처리 계약 증거, 아이 경로 API/SDK의 Families 적격성, 선생님 모드 production gate, Console 정책 선언, 개인정보 없는 자산, 최신 서명 AAB와 결제 E2E는 아직 최종 승인되지 않았다.

- [x] 등록정보 문안 초안: `docs/store/play-listing.md`
- [x] Data Safety 워크시트 초안: `docs/store/play-data-safety.md`
- [x] 출시 운영 가이드 초안: `docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md`
- [ ] Data Safety의 전체 데이터 유형과 외부 처리업체 서비스 제공자 예외를 계약·설정 기준으로 확정
- [ ] 공개 이용약관·개인정보처리방침·데이터 삭제 URL을 최신 문구로 배포하고 HTTPS 200·한글·갱신일 확인
- [ ] 개인정보 없는 스크린샷·아이콘·피처 그래픽을 데모 계정으로 새로 제작하고 PII·메타데이터 육안 검토
- [ ] 최신 최종 앱 커밋 이후 서명 AAB를 새로 빌드하고 versionCode·서명·SHA-256·mtime·16KB 정렬 확인
- [ ] 2026-07-14 최종 변경을 Worker·Pages에 배포하고 health·핵심 API·법적 문서 재확인
- [ ] 최신 debug APK를 A17(`RFKL40DP73J`)에 `install -r`하고 부모 세션·핵심 화면·WebView Console 확인
- [ ] S25·razr는 연결 해제·검증 제외 상태를 유지하고 adb 설치·실행·로그·세션 조회를 하지 않음

## P0 정책·제품 제출 차단 조건

- [x] **AI 답변 신고 코드**: 앱 내 신고, 실패·재시도·중복 방지, 서버 소유권 검증, D1 영속 저장을 구현하고 자동 회귀 테스트로 보호
- [x] **메모 신고 코드**: 가족 메모·사진·위치 신고와 서버의 가족·아이 스레드·본인 메시지 검증을 구현하고 자동 회귀 테스트로 보호
- [x] **사용자 차단 코드**: 1:1 UGC 메시지의 전송·조회·실시간·푸시만 차단하고 SOS·위험·위치 안전 알림과 가족 연결은 유지하도록 구현
- [x] **UGC 약관 코드**: 금지 콘텐츠, 신고·차단·조치·이의 제기 절차, 아동 위해 콘텐츠 금지를 공개 약관과 앱 동의 흐름에 반영
- [ ] **AI 답변 신고 E2E**: 실제 아이 세션에서 신고하고 D1 운영 큐 반영·운영자 처리를 확인
- [ ] **메모 신고 E2E**: 실제 부모·아이 양방향 세션에서 메시지·사진·위치 신고를 확인
- [ ] **사용자 차단 E2E**: 양방향 메시지·실시간·푸시는 차단되고 SOS·위험·위치 안전 채널은 유지되는지 확인
- [ ] **UGC 약관 E2E**: 신규·기존 세션의 동의 게이트와 공개 약관 링크를 확인
- [ ] `user_feedback.status='new'` 신고 큐의 담당자·처리 기준·증거 보존·사용자 회신 절차를 운영 문서로 확정
- [ ] 코드·자동 테스트 완료와 실기기·브라우저·D1 E2E 완료를 구분해 증거를 첨부
- [ ] **선생님 모드 출시 결정**: v1.2.0 Play 빌드에서는 `production gate`로 비활성화하고 실제 빌드에서 접근 불가 E2E를 남김. 정식 출시로 바꾸려면 등록정보·Data Safety·개인정보처리방침, 반복 사용 가능한 심사 계정과 선생님/보호자 역할별 E2E를 먼저 완료

## 증거 등급과 대체 금지

- **코드 증거**: 실제 소스·manifest·스키마가 요구 동작을 구현했음을 보여 준다. 배포·Console·실기기 결과를 대신하지 않는다.
- **자동 테스트 증거**: 단위·계약·회귀 테스트의 명령, 실행 시각, 통과 수를 기록한다. 실제 권한·네트워크·Play 결제를 대신하지 않는다.
- **실기기 증거**: 기기 모델·OS·앱 versionCode·설치 출처·화면/로그를 기록한다. A17 부모 검증은 아이 기기 위치·마이크·`CALL_PHONE` E2E를 대신하지 않는다.
- **운영 증거**: production Worker·Pages 배포 ID, D1 readback, HTTPS 응답, 실제 운영 API 결과를 기록한다. 로컬·mock 결과로 대체하지 않는다.
- **Console 증거**: Play Console의 대상 연령, Data Safety, Families, 모니터링, FGS/FSI, 트랙, 결제·RTDN 설정 화면과 승인 상태를 기록한다.
- **계약 증거**: 외부 처리업체별 계약·DPA, 제품 설정, 보관·삭제 기간, 학습·광고 등 2차 이용 조건과 아동 대상 적격성 문서를 기록한다.
- 어느 한 등급의 증거만으로 다른 등급을 완료 처리하지 않는다. 확인하지 않은 항목은 체크하지 않고 제출 차단을 유지한다.

## 서명 자격정보 안전 정리

- [x] 업로드 키스토어 경로는 Git에서 제외됨: `android/keystore/hyeni-upload.jks`
- [ ] `android/keystore/hyeni-upload-credentials.txt`의 값을 에이전트나 자동화가 읽지 않은 상태에서 운영자가 비밀번호 관리자로 옮김
- [ ] 운영자가 평문 자격정보 파일을 직접 삭제하고, 백업·휴지통·공유 폴더에도 사본이 없는지 확인
- [ ] 서명 비밀번호를 명령 인자, PowerShell history, CI 로그, 문서에 남기지 않음

비밀번호는 운영자가 보이지 않는 입력창에 직접 입력하고 Gradle 자식 프로세스에 임시 환경변수로만 전달한다. 빌드가 끝나거나 실패하면 반드시 환경변수를 제거한다.

```powershell
$storeSecret = Read-Host "업로드 키스토어 비밀번호" -AsSecureString
$keySecret = Read-Host "업로드 키 비밀번호" -AsSecureString
$storePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storeSecret)
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecret)

try {
  $env:HYENI_KEYSTORE = "../keystore/hyeni-upload.jks"
  $env:HYENI_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storePtr)
  $env:HYENI_KEY_ALIAS = "hyeni-upload"
  $env:HYENI_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)

  Set-Location C:\Users\TK\Desktop\hyeni-3\android
  .\gradlew bundleRelease
} finally {
  Remove-Item Env:HYENI_KEYSTORE -ErrorAction SilentlyContinue
  Remove-Item Env:HYENI_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:HYENI_KEY_ALIAS -ErrorAction SilentlyContinue
  Remove-Item Env:HYENI_KEY_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storePtr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
  $storeSecret = $null
  $keySecret = $null
}
```

## Data Safety·개인정보처리방침

- [ ] 이름, 이메일, 사용자 ID, 전화번호, 생년월일, 정확한 위치, 저장 장소·주소를 유형별로 신고
- [ ] 사진, 가족 메모·위치 공유, 일정·준비물, AI 입력·출력을 사용자 콘텐츠로 신고
- [ ] 설치된 앱, 앱 사용 시간, 잠금 해제, 배터리·네트워크·알림 상태, 오류 진단을 실제 처리 범위대로 신고
- [ ] 앱 설치 ID, FCM 토큰, 세션 ID, 구매 내역·구독 상태를 신고
- [ ] 주변 소리 음성 본문은 일시 처리, 감사 메타데이터는 저장된다는 차이를 표시
- [ ] Android `SpeechRecognizer`와 Web Speech의 외부 처리 가능성을 개인정보처리방침에 반영
- [ ] Cloudflare, Firebase/FCM, Google Play, Google/Kakao/Naver OAuth, OpenAI, Kakao 지도·모빌리티, 공개 OSRM, Resend, NCP SENS, 음성 인식 제공자의 실제 전송 필드를 Data Safety에 반영
- [ ] Resend의 `senderName`·`senderEmail`·`senderRole`·`senderUserId`·`familyId`·`content`, NCP SENS의 전화번호·6자리 OTP, 공개 OSRM의 출발·도착 좌표 전송을 반영
- [ ] 각 외부 흐름의 계약·DPA, 실제 설정, 보관·삭제 기간, 2차 이용 증거가 모두 확보되기 전에는 서비스 제공자 예외를 적용하지 않음
- [ ] 개인정보처리방침에 AI 친구뿐 아니라 AI 일정 사진·텍스트, AI 요약, 음성 인식 처리를 모두 포함
- [ ] Play 지원 이메일과 개인정보처리방침 연락처를 `mail@hyenicalendar.com`으로 일치시키고 실제 수신 확인
- [ ] 공개 삭제 안내가 주 보호자 가족 범위, 공동 보호자·아이 self 범위, 선생님 graph 범위와 독립 아이 계정 보존 조건을 구분하고, 로그인 없이 HTTPS 200으로 열리는지 확인

## Play Console 정책 선언

### 백그라운드 위치

- [ ] 선언 폼에는 **하나의 핵심 위치 기능**만 설명: “아이 기기가 앱 밖에 있어도 보호자에게 위치를 공유해 가족 안전 기능을 제공”
- [ ] 앱의 prominent disclosure에는 “location/위치”, 앱을 닫거나 사용하지 않을 때의 수집, 보호자 공유를 명시
- [ ] prominent disclosure와 심사 영상에는 현재 위치, 오늘 경로, 도착·출발, 일정 미도착, 위험 장소 등 실제 사용을 모두 보여 줌
- [ ] 전경 권한을 먼저 받고 별도 설명·사용자 동작으로 백그라운드 권한을 요청
- [ ] 거부해도 앱은 열리며 제한되는 위치 기능을 정확히 안내

### Foreground Service 3종

- [ ] `FOREGROUND_SERVICE_LOCATION`: 위치 공유의 핵심성, 시작 조건, 지속 알림·고유 아이콘, 중단 영향, 실제 영상 제출
- [ ] `FOREGROUND_SERVICE_MICROPHONE`: 아이가 매 요청을 허용한 최대 1분 세션, 지속 알림·중지, 중단 영향, 실제 영상 제출
- [ ] FGS `specialUse`(`emergency_parental_alert`): 구체적 사용 목적, 사용자에게 보이는 알림, 지연·중단 영향, 실제 영상 제출
- [ ] 최종 AAB의 merged manifest와 Play Console FGS 선언이 정확히 일치
- [ ] 2026-08-26 시행 예정 정책에서 geofencing이 승인 FGS 용도에서 제외되는 변경을 제출일에 다시 확인하고, 연속 위치 공유 핵심 기능과 지오펜스 트리거를 선언·구현에서 구분

### 전체 화면 인텐트·알림

- [ ] 혜니캘린더는 **전화·알람 앱이 아님**을 전제로 `USE_FULL_SCREEN_INTENT` 자동 허용 대상처럼 답하지 않음
- [ ] Android 특별 접근 권한을 사용자가 직접 허용하는 흐름과 거부·회수 상태를 확인
- [ ] 전체 화면을 사용할 수 없을 때 높은 중요도의 heads-up 알림으로 강등되는지 확인
- [ ] 일반 일정·미도착·메모 알림이 SOS 전체 화면으로 잘못 승격되지 않는지 확인

### 일정 알림·전화 최소 권한

- [x] 일정 알림 정본은 서버 cron이며 JS에서 네이티브 예약 알림 API를 호출하지 않음을 코드로 확인
- [x] 정확한 알람 특별 권한을 manifest에서 제거하고 위치 재시작·heartbeat·레거시 예약 알림은 inexact alarm으로 유지
- [x] **`CALL_PHONE` 결정**: v1.2.0에서는 아이 SOS 화면의 명시적 보호자 전화 버튼을 핵심 안전 동작으로 보아 유지. 권한 허용 시 `ACTION_CALL`, 거부·실패 시 `ACTION_DIAL` 폴백이며 통화기록은 읽지 않음을 코드와 manifest에서 확인
- [ ] `CALL_PHONE` 유지 근거, 권한 직전 설명, 아이 기기 허용·거부·회수, `ACTION_CALL`·`ACTION_DIAL` 결과를 실제 아이 기기 영상·로그로 검증하고 심사 접근 안내에 포함. 이 증거가 없으면 제출 차단
- [ ] 최종 merged manifest에서 사용하지 않는 민감 권한을 제거했다는 최소 권한 검토 기록 보관

### 자녀 모니터링·사용정보·마이크

- [ ] merged manifest의 `isMonitoringTool=child_monitoring` 확인
- [ ] 내부 테스트·비공개 테스트·공개 테스트·프로덕션 모든 활성 Play 트랙의 각 AAB에서 `isMonitoringTool=child_monitoring`과 모니터링 고지 문안이 동일함을 artifact manifest·트랙 목록으로 확인
- [ ] 스토어 긴 설명과 prominent disclosure에 자녀 보호 목적의 위치·앱 사용정보 모니터링을 공개
- [ ] 위치·마이크 foreground service 실행 중 지속 알림과 기능별 고유 아이콘이 표시되는지 확인
- [ ] `PACKAGE_USAGE_STATS`는 자녀 보호 목적과 Android 설정에서 사용자가 직접 허용하는 과정을 설명
- [ ] 주변 소리 듣기는 FCM 수신만으로 시작되지 않고 아이의 해당 세션 직접 허용 후에만 시작

### 대상 연령·Families

- [ ] 실제 보호자와 아이 이용자를 근거로 **보호자+아동 혼합 연령**과 정확한 연령 구간을 제품·정책 책임자가 결정
- [ ] 아이 모드에서 아동이 직접 일정·대화·SOS·AI를 사용하므로 심사를 피하기 위한 성인 전용 선택을 금지
- [ ] 정밀·백그라운드 위치를 유지하는 현재 앱의 아동 전용 제출을 금지
- [ ] 혼합 연령이어도 아이 경로에서 접근 가능한 API/SDK의 Families 적격성 증거가 없으면 해당 기능을 아이 경로에서 코드로 차단하고 차단 E2E를 확보
- [ ] Firebase/FCM, Kakao 지도·경로, 공개 OSRM, OpenAI, Android `SpeechRecognizer`·Web Speech 등 아이 경로의 모든 외부 처리에 대해 Families·아동 데이터 적격성을 확인
- [ ] 선택한 대상 연령과 근거를 출시 기록에 남김

## Play Console 설정·결제

- [ ] 앱 생성: `com.hyeni.calendar`, 한국어(대한민국), 무료 앱·인앱 구독 있음
- [ ] Play App Signing 사용 후 최신 AAB를 내부 테스트 트랙에 먼저 업로드
- [ ] Play Console의 **App signing key certificate SHA-256**을 `public/.well-known/assetlinks.json`에 반영하고 debug 인증서 지문은 출시 파일에서 제거한 뒤 Pages에 재배포
- [ ] `https://hyeni-calendar.pages.dev/.well-known/assetlinks.json`이 리디렉션 없이 HTTPS 200·`application/json`으로 응답하고, 설치된 Play 빌드의 `pm get-app-links com.hyeni.calendar`가 도메인을 `verified`로 표시
- [ ] 개인정보처리방침·데이터 삭제·앱 접근 권한 입력
- [ ] IARC 설문에 AI 생성 콘텐츠, 가족 간 사용자 통신, 사진·위치 공유를 사실대로 답하고 Console이 반환한 등급 사용
- [ ] Android Publisher API 활성화와 서비스 계정 최소 권한 부여
- [ ] Pub/Sub topic을 Play Console RTDN에 연결하고 인증 push subscription 구성
- [ ] Worker secret 4종 설정 후 누락 상태에서 `503` fail-closed 확인
- [ ] 상품 `hyeni_premium`의 실제 base plan·가격·국가를 Console과 앱 결제 화면에서 확인
- [ ] Play가 현재 계정에 eligible로 반환한 정확한 7일 무료 pricing phase만 표시되는지 확인
- [x] 코드 계약: 서버 `subscriptionsv2.get` 검증 후 `active|trial|grace`인 미승인 구독만 entitlement 저장 전에 acknowledge하고, 클라이언트는 서버가 `needsClientAcknowledge`를 지시할 때만 보조 acknowledge
- [x] 코드 계약: 복원은 `queryPurchases()` 결과 중 `PURCHASED` 구독만 서버에 재검증하고 `PENDING`·`UNSPECIFIED`를 entitlement로 열지 않음
- [x] 코드 계약: RTDN 알림 종류만 신뢰하지 않고 Google OIDC·audience·service account email 검증 뒤 `subscriptionsv2.get`으로 재조회하며 purchase token hash로 소유권·멱등 처리
- [ ] license tester로 `PURCHASED`·`PENDING`·취소 흐름, acknowledge 완료, trial·active·grace·on-hold·expired·revoked 상태, 구매 복원, 앱 재시작·foreground 재검증, 갱신·해지·환불·중복 RTDN 실제 E2E
- [ ] Play Console 주문·테스트 구독·RTDN/Pub/Sub 로그와 앱·Worker·D1 상태를 같은 테스트 건별로 연결해 Console 증거와 운영 증거를 보존
- [ ] Qonversion을 결제 정본 또는 활성 결제 경로처럼 안내하지 않음

## 심사 접근·스토어 자산

- [ ] 반복 사용 가능한 데모 보호자·자녀 계정과 단계별 접근 안내 제공
- [ ] 1회용 OTP·만료되는 QR·실사용 가족 계정을 심사 접근 수단으로 제공하지 않음
- [ ] 데모 계정 화면으로 1080×1920 JPEG/불투명 PNG 4~8장 재촬영
- [ ] 아이 사진·이름·주소·학교·학원·지도 좌표·초대 코드·QR·전화번호·이메일·알림 내용이 없는지 확대 검토
- [ ] 앱 아이콘 512×512와 피처 그래픽 1024×500을 Play Console 현재 규격으로 검증
- [ ] 지원 이메일 `mail@hyenicalendar.com`으로 실제 문의 송수신 확인

## 최종 승인

- [ ] 앱·Worker 전체 테스트와 빌드 통과
- [ ] A17 부모 모드와 배포 브라우저 최종 검증 증거 확보
- [ ] production Worker·Pages 배포 ID 기록
- [ ] 최신 서명 AAB의 SHA-256·크기·mtime·versionCode 기록
- [ ] AI·UGC·Data Safety·위치·FGS·FSI·모니터링·Families 제출 차단 조건 전부 해제
- [ ] Play Console 제출 화면을 정책 책임자와 운영자가 함께 최종 검토

체크하지 못한 항목이 하나라도 있으면 프로덕션 제출이나 단계적 출시 확대를 진행하지 않는다.
