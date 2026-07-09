# iOS 빌드 가이드 — 혜니캘린더

## 현재 상태 (2026-07-10)
- `npx cap add ios` 완료 — `ios/App/App.xcodeproj` (Capacitor 8, SPM 기반)
- `npx cap sync ios` 완료 — dist 웹 에셋 포함
- Info.plist: 앱 이름(혜니캘린더) + 사진/카메라/위치(사용 중) 사용 설명 설정
- iOS 플러그인: `@capacitor/app` 1개 (커스텀 네이티브 플러그인 10종은 Android 전용)

## 아키텍처 전제 (CLAUDE.md 확정 사항)
- **iPhone = 보호자 전용, 조회·관리 중심.** 아이 기기는 Android 전용.
- 백그라운드 위치 추적·지오펜스·주변소리 송신·SOS 발신 등 아이 기기 기능은 iOS 빌드에 포함하지 않는다(웹 폴백 no-op — `src/lib/native/*`가 isNativePlatform+플러그인 부재 시 자동 폴백).
- 따라서 iOS 앱 = 부모 화면 전체 + 푸시 없음(원하면 후속으로 APNs+@capacitor/push-notifications 추가).

## macOS에서 빌드 (Windows에서는 Xcode 컴파일 불가)
```bash
# 1) 저장소 클론 후
npm install
npm run build
npx cap sync ios

# 2) Xcode 열기
npx cap open ios
# 또는: open ios/App/App.xcodeproj

# 3) Xcode에서
#  - Signing & Capabilities → Team 선택(Apple Developer 계정)
#  - Bundle Identifier: com.hyeni.calendar (App Store Connect에 등록)
#  - Product > Archive → App Store Connect 업로드
```

## 남은 작업(후속)
- [ ] 앱 아이콘 세트(ios/App/App/Assets.xcassets/AppIcon) — public/pwa-512.png 기반 생성(Xcode 15+는 1024 단일 이미지로 충분)
- [ ] 스플래시(Splash.imageset) 교체 — 로즈 배경+마스코트
- [ ] (선택) APNs 푸시: FCM iOS 또는 APNs 직접 — 부모 알림 수신용. 현재 iOS는 앱 내 WS 실시간만 동작
- [ ] App Store 심사 자료: 개인정보처리방침 URL 동일 사용, 아동 안전 관련 심사 노트 준비
