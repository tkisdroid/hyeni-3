# 아이 AI 친구 음성 답변 설계

- 날짜: 2026-08-18
- 상태: 사용자 방향 승인, 구현 전 문서 검토 대기
- 대상: 아이 모드 `#/child/ai-friend`

## 1. 목표

아이가 AI 친구의 마이크 버튼을 눌러 말하면, 인식된 텍스트를 기존 AI 친구 안전 파이프라인으로 처리하고 답변을 음성으로 자동 재생한다. 별도 유료 음성 API나 실시간 음성 모델은 도입하지 않고 Android 시스템 STT/TTS와 웹 표준 폴백을 재사용한다.

성공 기준은 다음과 같다.

- 마이크로 보낸 turn의 정상 AI 답변은 읽어주기 영구 설정이 꺼져 있어도 한 번 자동 재생된다.
- 키보드·추천 칩·확인 카드로 보낸 turn은 기존 아이별 읽어주기 설정을 그대로 따른다.
- 새 음성 입력을 시작하거나 읽어주기를 끄거나 화면을 떠나면 재생 중인 음성이 즉시 멈춘다.
- 사용자 음성 원본은 혜니캘린더 Worker나 OpenAI에 업로드하지 않는다. Worker에는 음성 인식 결과인 텍스트만 전송한다.
- TTS 추가 API 비용, 새 서버 endpoint, 새 DB, 새 Android 권한을 만들지 않는다.
- 앱의 현재 10개 locale에 맞는 언어 태그를 Android TTS에도 전달한다.

## 2. 현행과 문제

현재 저장소에는 이미 아래 흐름이 구현돼 있다.

1. `captureSpeech()`가 Android `SpeechRecognizer`를 우선 사용하고, 웹에서는 Web Speech API로 강등한다.
2. 인식 결과를 `send(spoken, "voice")`로 기존 `POST /api/ai/child-chat`에 텍스트 전송한다.
3. 서버는 기존 멤버십·크레딧·아동 안전·도구 확인·저장·신고 계약을 적용한다.
4. 성공 답변은 `speakText()`가 Android `TextToSpeech` 또는 웹 `speechSynthesis`로 읽을 수 있다.

그러나 실제 재생 조건이 `voiceReplyRef.current && reply`뿐이라 읽어주기 설정의 기본값이 꺼진 새 기기에서는 마이크로 질문해도 답변이 텍스트로만 나온다. 또한 웹 TTS는 앱 locale을 사용하지만 Android `SpeechPlugin`은 `Locale.KOREAN`으로 고정돼 있다.

## 3. 검토한 접근

### A. 음성 turn만 자동 TTS, 나머지는 기존 토글 유지 — 채택

마이크 탭은 아이가 소리로 대화하겠다는 명시적 사용자 동작으로 본다. `source === "voice"`인 정상 답변은 그 한 번 자동 재생하고, 그 밖의 입력은 기존 영구 설정을 따른다.

장점은 요구와 정확히 일치하고 교실·도서관에서 키보드로 조용히 대화하는 기본값을 보존한다는 점이다. 서버·과금·안전 계약도 바뀌지 않는다.

### B. 첫 마이크 사용 때 읽어주기 토글을 영구적으로 켜기 — 제외

구현은 단순하지만 이후 키보드로 입력한 답까지 계속 소리가 난다. 아이가 한 번 마이크를 쓴 사실을 장기적인 자동 재생 동의로 확대하므로 조용한 장소에서 예기치 않은 소리가 날 수 있다.

### C. OpenAI TTS 또는 Realtime 음성으로 교체 — 제외

현재 기기 STT/TTS는 추가 음성 API 비용이 0원이고 텍스트 AI 비용만 든다. 저장소 원가 정본상 Realtime 음성은 현재 경로보다 약 6~37배 비싸며, 텍스트 단계에 걸린 아동 안전·부모 가드레일·도구 확인·신고 가능한 저장 응답을 새 음성 경로에 다시 구축해야 한다.

## 4. 동작 계약

### 4.1 turn별 재생 판정

재생 여부는 순수 판정 함수 한 곳에서 결정한다.

```ts
shouldSpeakAiReply({ source, persistentEnabled, hasReply })
```

- `hasReply === false`: 재생하지 않는다.
- `source === "voice"`: `persistentEnabled`와 무관하게 재생한다.
- 그 밖의 source: `persistentEnabled === true`일 때만 재생한다.

허용된 source는 현재 호출부가 사용하는 정확한 문자열을 따른다. `voice`만 자동 재생 대상으로 보고 `composer`, `suggestion:*`, `confirm` 등은 음성 turn으로 추정하지 않는다. 현재 한 화면에서 동시에 AI mutation을 하나만 허용하므로 응답 콜백이 어떤 turn에서 시작됐는지 `send()`의 `source` 클로저로 안전하게 판별할 수 있다.

### 4.2 읽어주기 토글 의미

가족+아이 단위 `localStorage` 설정과 기본 꺼짐은 유지한다. 이 설정은 “마이크가 아닌 입력의 답도 읽어주기”를 뜻한다.

아이콘 전용 버튼의 접근성 문구는 이 의미가 드러나도록 바꾼다.

- 꺼짐: `글로 물어본 답도 읽어주기 켜기`
- 켜짐: `글로 물어본 답도 읽어주기 끄기`

마이크로 시작한 한 turn의 자동 재생은 영구 설정을 바꾸지 않는다. 새로운 장식 배지나 상태 pill은 추가하지 않는다.

### 4.3 재생 수명주기

- 마이크를 새로 누르기 직전에 기존 TTS를 중단한다.
- 토글을 끄면 현재 재생을 중단한다.
- AI 친구 화면이 unmount되면 STT와 TTS를 모두 중단한다.
- 새 답변은 Android `QUEUE_FLUSH` 및 웹 `speechSynthesis.cancel()` 뒤 재생하므로 이전 답변과 겹치지 않는다.
- 빈 응답, API 오류 안내, 일일 한도 안내는 자동 합성하지 않는다. 글로 표시되는 기존 정직한 오류 UX를 유지한다.
- TTS 실패는 AI 답변 성공을 실패로 바꾸지 않는다. 텍스트 답변은 이미 화면에 남고 재생 함수는 `false`로 조용히 강등한다.

## 5. 데이터 흐름과 안전

```text
아이의 마이크 탭
  → Android SpeechRecognizer / Web Speech
  → 인식된 텍스트
  → 기존 POST /api/ai/child-chat
  → 멤버십·크레딧·아동 안전·부모 가드레일·도구 확인
  → 저장된 assistant 답변 + 신고 가능한 message id
  → 화면 텍스트 표시
  → Android TextToSpeech / Web speechSynthesis
```

- 음성 원본은 혜니캘린더 Worker와 OpenAI로 보내지 않는다.
- 다만 Android `SpeechRecognizer`, Web Speech, 시스템 TTS는 기기·브라우저·선택된 음성 엔진에 따라 외부 제공자 서버에서 음성이나 합성할 텍스트를 처리할 수 있다. “항상 기기 안에서만 처리된다”고 안내하지 않는다.
- Worker로 들어온 인식 텍스트는 일반 AI 친구 입력과 동일하게 500자 상한, 안전 판정, 대화 저장, 장기기억 필터, 콘텐츠 신고 계약을 따른다.
- TTS에 넘기기 전 `speakableReplyText()`로 `[[img:...]]` 마커와 위치 좌표를 제거하고 사람이 읽을 주소만 남긴다.
- 음성 turn도 기존 “아이의 한 번 발화 = 1회” 크레딧 규칙을 따른다. TTS 때문에 추가 차감하지 않는다.

## 6. Android 언어 처리

`speakText(text, language, rate)`가 네이티브 플러그인에도 `language`를 전달한다. Android는 별도 순수 정책 함수에서 BCP 47 태그를 `Locale`로 해석한다.

- 빈 값·해석 불가 값은 `ko-KR`로 강등한다.
- `TextToSpeech.setLanguage()`가 `LANG_MISSING_DATA` 또는 `LANG_NOT_SUPPORTED`를 반환하면 해당 네이티브 재생을 실패로 끝낸다.
- JS는 기존처럼 웹 `speechSynthesis` 폴백을 시도한다.
- TTS 엔진 설치 화면을 자동으로 열거나 새 권한을 요구하지 않는다.

지원 여부 버튼을 비동기 사전 진단하는 별도 기능은 이번 범위에 넣지 않는다. 실제 재생 실패가 대화를 막지 않는 현재 fail-soft 계약을 유지한다.

## 7. 공개 고지와 문서

공개 개인정보처리방침의 `일정 음성 입력` 범위를 `일정·AI 친구 음성 입력`으로 넓힌다. 음성 인식뿐 아니라 운영체제·브라우저 TTS 제공자가 합성할 답변 텍스트를 외부 처리할 수 있다는 경계도 정직하게 적는다.

Play Data Safety 초안은 다음 사실을 함께 반영한다.

- STT 제공자는 아이 음성·인식 결과·기기 관련 정보를 처리할 수 있다.
- 혜니캘린더 서버는 음성 원본이 아니라 인식된 텍스트를 받는다.
- TTS 제공자는 합성을 위해 AI 답변 텍스트를 처리할 수 있다.

구현 뒤 `AGENTS.md`와 `CLAUDE.md`에 이 음성 turn 계약과 회귀 테스트를 같은 내용으로 추가한다.

## 8. 변경 범위

예상 파일은 다음과 같다.

- `src/screens/child/AiFriendChat.tsx`: turn source 기반 재생 판정 적용
- `src/transform/childVoiceChat.ts`: 순수 재생 판정과 기존 마커 정리·설정 계약 유지
- `src/lib/native/speech.ts`: 네이티브 `language` 전달
- `android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java`: locale 적용과 미지원 언어 실패 처리
- Android의 작은 순수 locale 정책 파일과 JVM 단위 테스트
- `locales/*/child.json` 및 생성 catalog: 토글 접근성 문구 10개 locale 동기화
- `tests/childVoiceChat.test.ts`: 자동 재생·토글·중단·locale 계약 회귀
- `worker/routes/legal.ts`, `worker/tests/legalCopy.test.mjs`: 공개 고지 확장
- `docs/store/play-data-safety.md`: STT/TTS 실제 데이터 경계 보완
- `AGENTS.md`, `CLAUDE.md`: 운영 정본 동기화

서버 AI route, D1 schema, 결제·크레딧 정책, CSS, Android 권한은 변경하지 않는다.

## 9. 검증

### 자동 검증

- 순수 함수: 음성 source/텍스트 source × 토글 on/off × 빈/정상 답변 조합
- 화면 계약: `send(spoken, "voice")`, 새 음성 시작·토글 off·unmount 중단
- 음성 마커 정리와 10개 locale 문구
- Android JVM: 10개 locale 태그 변환, 빈 값·무효 값 한국어 폴백
- Worker 공개 법적 문구 회귀
- `npm run typecheck`
- 관련 앱/Worker 테스트
- `npm run build`
- `npx cap sync android`
- Android unit test, `lintDebug`, `assembleDebug`

### 비파괴 통합 검증

운영 AI 대화 행이나 크레딧을 만들지 않도록 격리 브라우저에서 `/api/ai/child-chat`을 mock해 다음을 확인한다.

1. 토글 off + 마이크 source → 답변 자동 재생 호출 1회
2. 토글 off + 키보드 source → 재생 0회
3. 토글 on + 키보드 source → 재생 1회
4. 빈/오류 답변 → 재생 0회
5. 화면 이탈과 새 마이크 입력 → 중단 1회

실제 가청 TTS는 허용된 razr 아이 기기에만 `adb install -r`로 세션을 보존해 확인한다. AI 서버 호출 없이 네이티브 플러그인에 짧은 고정 문구를 전달해 스피커 재생과 중단을 검증한다. A17 부모 세션은 역할 확인 등 필요한 읽기 검증만 하고, S25에는 어떤 adb 접근도 하지 않는다.

운영 AI와 연결한 실제 “발화→AI→가청 재생”은 테스트 대화·크레딧·대화 기록을 만들므로 자동 수행하지 않는다. 사용자가 별도로 허용한 경우에만 정확한 범위를 정해 실행하고, 삭제가 허용되지 않는 운영 기록을 테스트 목적으로 만들지 않는다.

## 10. 배포와 완료 판정

- 앱 변경은 Pages와 Android APK 모두에 반영해야 한다.
- 공개 개인정보처리방침 변경은 Worker 배포가 필요하다.
- D1 migration과 secret 변경은 없다.
- 현재 Play 제출 후보보다 소스가 새로워지므로 다음 심사 제출용 AAB는 최신 커밋에서 다시 빌드하고 서명·해시·mtime을 검증해야 한다. 기존 AAB를 최신 후보로 간주하지 않는다.
- 자동 테스트·격리 브라우저·Android 로컬 TTS 검증 결과를 구분해 기록하며, 실제 운영 AI 음성 왕복을 실행하지 않았다면 미검증으로 명시한다.

## 11. 범위 밖

- 연속 대화를 위한 OpenAI Realtime 세션
- 음성 파일 업로드·저장·재생 이력
- 목소리 선택·속도 설정 UI
- 배경 화면에서 AI 친구가 자동으로 말하기
- 부모가 아이의 읽어주기 설정을 원격 변경하기
- TTS 엔진 설치 또는 언어팩 다운로드 화면 자동 실행
