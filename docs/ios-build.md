# iOS 빌드 가이드 — 혜니캘린더

## 현재 상태 (2026-08-24)
- `npx cap add ios` 완료 — `ios/App/App.xcodeproj` (Capacitor 8, SPM 기반)
- `npx cap sync ios` 완료 — dist 웹 에셋 포함
- Info.plist: 앱 이름(혜니캘린더) + 사진/카메라/위치(사용 중)/마이크 사용 설명 설정
- iOS 플러그인: `@capacitor/app`, `@capacitor/browser` (Android 커스텀 플러그인은 iOS에서 정직한 웹 폴백)
- App Store 아이콘·시작 화면은 혜니캘린더 PWA 브랜드 자산과 동일하게 구성
- 버전 `1.4.1` / 빌드 `13`, Bundle Identifier `com.hyeni.calendar`

## 아키텍처 전제 (CLAUDE.md 확정 사항)
- **iPhone = 보호자 전용, 조회·관리 중심.** 아이 기기는 Android 전용.
- 백그라운드 위치 추적·지오펜스·주변소리 송신·SOS 발신 등 아이 기기 기능은 iOS 빌드에 포함하지 않는다(웹 폴백 no-op — `src/lib/native/*`가 isNativePlatform+플러그인 부재 시 자동 폴백).
- 따라서 iOS 앱 = 부모 화면 전체 + 푸시 없음. 위치·기기상태·소리 울리기·주변소리·메시지·장소/알림 설정은 Worker→Android 아이 기기 경로로 동작한다.
- Google/카카오/네이버 OAuth는 `@capacitor/browser` 시스템 브라우저와 `com.hyeni.calendar.oauth://oauth/callback` 고정 복귀 URL을 사용한다. 서버 state와 별도 transaction secret을 모두 검증한다.
- iOS WKWebView 기본 origin `capacitor://localhost`는 Worker의 정확한 CORS allowlist에만 추가하며 접미사·유사 origin은 거부한다.

## macOS에서 빌드 (Windows에서는 Xcode 컴파일 불가)
```bash
# 1) 저장소 클론 후
npm install
npm run ios:sync

# 2) Xcode 열기
npx cap open ios
# 또는: open ios/App/App.xcodeproj

# 3) Xcode에서
#  - Signing & Capabilities → Team 선택(Apple Developer 계정)
#  - Bundle Identifier: com.hyeni.calendar (App Store Connect에 등록)
#  - Product > Archive → App Store Connect 업로드
```

`ios:sync`는 빌드·Capacitor 동기화 뒤 Windows에서 생성될 수 있는 Swift Package 역슬래시를 macOS 호환 경로로 정규화하고, 버전·권한·OAuth·아이콘·시작 화면을 검사한다.

## 패키징 때 필요한 사람 작업
- [ ] Xcode Team 선택과 자동 서명(인증서·프로비저닝은 저장소에 넣지 않음)
- [ ] Product > Archive → App Store Connect 업로드
- [ ] App Store 개인정보 응답·개인정보처리방침 URL·아동 안전 심사 노트 입력
- [ ] APNs 부모 알림이 필요하면 별도 네이티브 구현. 현재 앱 내 WebSocket 실시간과 화면 재조회는 동작하지만, 앱이 종료된 iOS 네이티브 컨테이너로 푸시는 오지 않는다.
