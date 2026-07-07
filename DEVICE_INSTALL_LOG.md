# DEVICE_INSTALL_LOG

작성일: 2026-07-08 KST

## 설치 명령

```bash
adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s ZY22H9VTQD install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 설치 결과

| 기기 | serial | 결과 | versionName | lastUpdateTime |
|---|---|---|---|---|
| A17 | RFKL40DP73J | Success | 1.1 | 2026-07-08 01:04:38 |
| razr | ZY22H9VTQD | Success | 1.1 | 2026-07-08 01:04:34 |

## APK

- 경로: `android/app/build/outputs/apk/debug/app-debug.apk`
- 크기: 약 15,204,535 bytes
- 빌드: `./gradlew assembleDebug` BUILD SUCCESSFUL

## 패키지

- `com.hyeni.calendar`
- debug build, `DEBUGGABLE`
