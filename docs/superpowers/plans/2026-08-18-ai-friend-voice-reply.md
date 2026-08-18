# 아이 AI 친구 음성 답변 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** 아이가 마이크로 AI 친구에게 말한 turn의 정상 답변은 읽어주기 영구 설정과 무관하게 한 번 자동 재생하고, 글 입력은 기존 설정을 따르며, Android와 웹에서 현재 앱 언어로 추가 TTS 비용 없이 읽는다.

**Architecture:** 기존 `SpeechRecognizer/Web Speech → 인식 텍스트 → /api/ai/child-chat → 저장된 assistant 답변 → TextToSpeech/speechSynthesis` 경로를 유지한다. 클라이언트 순수 정책 함수가 turn source와 영구 설정으로 재생 여부를 결정하고, 네이티브 브리지는 BCP 47 태그를 Android TTS에 전달한다. 서버 AI·크레딧·안전·DB 계약은 바꾸지 않고 공개 개인정보 문구만 실제 데이터 경계에 맞춘다.

**Tech Stack:** React 19, TypeScript strict, TanStack Query, React Intl 10개 locale, Capacitor 8, Android Java/JUnit4, Node 24 native test runner, Playwright, Cloudflare Worker.

**Spec:** [`docs/superpowers/specs/2026-08-18-ai-friend-voice-reply-design.md`](../specs/2026-08-18-ai-friend-voice-reply-design.md)

## Global Constraints

- 모든 응답·주석·커밋 메시지는 한국어로 작성하고 아이 화면 문구는 반말을 유지한다.
- 음성 원본을 혜니캘린더 Worker/OpenAI로 보내거나 저장하는 새 경로를 만들지 않는다. 서버에는 기존과 같이 인식 텍스트만 보낸다.
- 새 유료 TTS/STT API, endpoint, D1 schema, secret, Android 권한, CSS를 추가하지 않는다.
- 음성 turn도 기존 `/api/ai/child-chat` 1회 크레딧 계약을 따르고 TTS로 추가 차감하지 않는다.
- `source === "voice"`만 한 turn 자동 재생으로 인정한다. `composer`, `suggestion:*`, `confirm`을 음성 turn으로 추정하지 않는다.
- TTS 실패는 이미 성공한 텍스트 답변을 실패로 바꾸지 않는다. 음성 텍스트·세션 token을 로그에 남기지 않는다.
- 운영 AI 왕복은 대화 행과 크레딧을 만들므로 별도 허용 없이 실행하지 않는다.
- 실기기 접근은 razr `ZY22H9VTQD`와 필요한 경우 A17 `RFKL40DP73J`에만 한다. S25에는 `adb devices`를 포함한 어떤 adb 접근도 하지 않는다.
- 실기기 설치는 `adb install -r`만 사용하고 로그아웃·역할 변경·재페어링·refresh token 조회/회전을 하지 않는다.
- 공개 Worker를 갱신하기 전에 이미 발견된 약관 오표기(친구 초대 10회·3가족, 신고 버튼 위치)를 현재 정본과 일치시킨다. 음성 기능과 섞어 숨기지 않고 별도 테스트로 고정한다.

---

### Task 1: turn별 자동 재생 순수 정책을 TDD로 추가

**Files:**

- Modify: `tests/childVoiceChat.test.ts`
- Modify: `src/transform/childVoiceChat.ts`

- [ ] **Step 1: 실패하는 정책 매트릭스 테스트 작성**

`tests/childVoiceChat.test.ts`의 import에 `shouldSpeakAiReply`와 `type AiChatTurnSource`를 추가하고 아래 테스트를 넣는다.

```ts
test("음성 turn은 설정과 무관하게 읽고 글 turn은 읽어주기 설정을 따른다", () => {
  const cases = [
    ["voice", false, true, true],
    ["voice", true, true, true],
    ["composer", false, true, false],
    ["composer", true, true, true],
    ["suggestion:놀자", false, true, false],
    ["suggestion:놀자", true, true, true],
    ["confirm", false, true, false],
    ["confirm", true, true, true],
    ["voice", false, false, false],
    ["composer", true, false, false],
  ] as const satisfies readonly (
    readonly [AiChatTurnSource, boolean, boolean, boolean]
  )[];

  for (const [source, persistentEnabled, hasReply, expected] of cases) {
    assert.equal(
      shouldSpeakAiReply({ source, persistentEnabled, hasReply }),
      expected,
    );
  }
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test tests/childVoiceChat.test.ts`

Expected: `childVoiceChat.ts`가 `shouldSpeakAiReply`를 export하지 않아 FAIL. 기존 7개 테스트는 회귀 실패가 없어야 한다.

- [ ] **Step 3: 최소 순수 정책 구현**

`src/transform/childVoiceChat.ts`의 locale 표 아래에 다음을 추가한다.

```ts
export type AiChatTurnSource =
  | "composer"
  | "voice"
  | "confirm"
  | `suggestion:${string}`;

export function shouldSpeakAiReply({
  source,
  persistentEnabled,
  hasReply,
}: {
  source: AiChatTurnSource;
  persistentEnabled: boolean;
  hasReply: boolean;
}): boolean {
  return hasReply && (source === "voice" || persistentEnabled);
}
```

- [ ] **Step 4: GREEN 확인**

Run: `node --test tests/childVoiceChat.test.ts`

Expected: 새 매트릭스를 포함해 모두 PASS.

- [ ] **Step 5: 커밋**

```powershell
git add tests/childVoiceChat.test.ts src/transform/childVoiceChat.ts
git commit -m "아이 AI 음성 답변 재생 정책을 고정한다"
```

---

### Task 2: `AiFriendChat`에 turn source 판정을 연결하고 격리 브라우저로 검증

**Files:**

- Modify: `tests/childVoiceChat.test.ts`
- Modify: `src/screens/child/AiFriendChat.tsx`
- Create: `scripts/verify-ai-friend-voice-reply.mjs`
- Modify: `package.json`

- [ ] **Step 1: 실패하는 화면 연결 계약 추가**

`tests/childVoiceChat.test.ts`에 다음을 추가한다.

```ts
test("AI 답변은 해당 turn source와 최신 영구 설정으로 재생 여부를 판정한다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  const onSuccessStart = chat.indexOf("onSuccess: (res) => {");
  const onErrorStart = chat.indexOf("onError: (err) => {", onSuccessStart);
  assert.ok(onSuccessStart >= 0 && onErrorStart > onSuccessStart);
  const onSuccess = chat.slice(onSuccessStart, onErrorStart);
  assert.match(
    onSuccess,
    /const spokenReply = speakableReplyText\(reply\);/,
  );
  assert.match(
    onSuccess,
    /shouldSpeakAiReply\(\{\s*source,\s*persistentEnabled:\s*voiceReplyRef\.current,\s*hasReply:\s*Boolean\(spokenReply\),\s*\}\)/,
  );
  assert.match(onSuccess, /speakText\(spokenReply, speechLang\)/);
});
```

- [ ] **Step 2: 정적 계약 RED 확인**

Run: `node --test tests/childVoiceChat.test.ts`

Expected: `AiFriendChat.tsx`에 `shouldSpeakAiReply` 호출이 없어 새 테스트만 FAIL.

- [ ] **Step 3: 외부 요청이 전혀 없는 브라우저 검증 하니스 작성**

`scripts/verify-ai-friend-voice-reply.mjs`는 `@playwright/test`의 `chromium`을 사용한다. preview는 저장소의 고정 Vite 실행 파일로 시작하고 20초 안에 `/index.html`이 200이 되지 않으면 실패시킨다.

```js
const preview = spawn(
  process.execPath,
  [resolve(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4184", "--strictPort"],
  { cwd: ROOT, stdio: "ignore" },
);
```

Chromium은 DNS deny를 적용하고 service worker를 차단한다.

```js
const browser = await chromium.launch({
  headless: true,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
});
const context = await browser.newContext({ serviceWorkers: "block", locale: "ko-KR" });
```

아래 계약을 구현한다.

1. `page.addInitScript()`에서 `SpeechRecognition`, `SpeechSynthesisUtterance`, `speechSynthesis`를 가짜 구현으로 고정한다.
2. `window.__hyeniVoiceQa`에는 `transcript`, `spoken: Array<{text:string;lang:string}>`, `events: Array<"cancel"|"speak">`만 둔다.
3. `hyeni-api-session-v1`은 실제 `PersistedSession` 모양으로 저장하고 `hyeni-locale-v1`은 `ko`로 고정한다. JWT payload에는 `sub`, `role`, `family_id`, 미래 `exp`만 넣는다.

```js
localStorage.setItem("hyeni-api-session-v1", JSON.stringify({
  access: mockAccessJwt,
  refresh: "mock-refresh",
  user: {
    id: "voice-child",
    app_metadata: { role: "child", family_id: "voice-fam" },
    user_metadata: { role: "child", family_id: "voice-fam" },
  },
  session_instance_id: "voice-qa",
}));
localStorage.setItem("hyeni-locale-v1", "ko");
```

4. `context.route("**/*")`는 localhost 정적 asset만 `continue()`하고 외부 요청은 전부 fulfill한다. OPTIONS는 204, JSON 응답은 정확한 CORS header를 붙인다. `continuedExternalRequests`를 증가시키는 코드는 두지 않고 종료 시 값이 0인지 assert한다.

```js
const cors = {
  "access-control-allow-origin": "http://127.0.0.1:4184",
  "access-control-allow-headers": "authorization,content-type,x-device-install-id",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
};
```

`context.routeWebSocket("**", socket => socket.close())`로 realtime 연결도 서버에 연결하지 않는다. DNS deny, service worker block, HTTP route, WebSocket route 네 겹을 모두 유지한다.
5. 정확한 GET fixture는 아래 값을 사용한다.

```js
const apiFixtures = {
  "/api/family/mine": {
    familyId: "voice-fam",
    myRole: "child",
    myName: "혜니",
    parentName: "부모",
    primaryParentId: "voice-parent",
    isPrimaryParent: false,
    isCoParent: false,
    members: [
      { id: "voice-parent-member", user_id: "voice-parent", role: "parent", name: "부모" },
      { id: "voice-child-member", user_id: "voice-child", role: "child", name: "혜니" },
    ],
  },
  "/api/events": [],
  "/api/saved-places": [],
  "/api/daily-supplies": [],
  "/api/ai/messages": [],
  "/api/ai/settings/friend-public": { ai_friend_name: "통통이" },
  "/api/ai/credits/public-status": {
    is_premium: false,
    daily_included_limit: 5,
    daily_included_used: 0,
    daily_reset_date: new Date().toISOString().slice(0, 10),
    purchased_credits: 0,
    parent_daily_used: 0,
    parent_daily_limit: 5,
    available_remaining: 5,
    unlimited: false,
  },
};
```

`POST /api/ai/child-chat`은 body의 `message`로만 분기한다.

```js
let assistantSequence = 0;

function childChatReply(message) {
  if (message === "오류 답") return { status: 503, body: { error: "ai_provider_busy" } };
  if (message === "빈 답") return { status: 200, body: { reply: "", remaining: 4 } };
  const reply = message === "음성 질문" ? "음성 답변" : `글 답변 ${message}`;
  assistantSequence += 1;
  return {
    status: 200,
    body: {
      reply,
      remaining: 4,
      assistantMessageId: `00000000-0000-4000-8000-${String(assistantSequence).padStart(12, "0")}`,
    },
  };
}
```

하니스는 `.afc-mic`, `.afc-field`, `.afc-send`, `.afc-voicetog`만 조작하고 다음을 순서대로 assert한다.

```js
// 기본 off + 마이크: 1회, 이후 aria-pressed와 localStorage는 계속 off
// 기본 off + "글 질문": 증가 없음
// 토글 on + "글 질문 켬": 1회 증가
// "빈 답"과 "오류 답": 증가 없음
// 새 마이크 시작: 다음 speak보다 cancel이 먼저 기록
// 토글 off: 즉시 cancel
// location.hash="#/child/home": unmount cancel
```

`finally`에서 browser를 닫고 preview process를 종료한다. Windows에서 2초 안에 종료되지 않으면 검증한 `preview.pid`만 `taskkill /PID <pid> /T /F`로 정리한다. 결과에는 텍스트 답변과 event 개수·mock 처리 수·`continuedExternalRequests=0`만 출력하고 session/JWT를 출력하지 않는다.

`package.json` scripts에 다음을 추가한다.

```json
"qa:ai-voice": "node scripts/verify-ai-friend-voice-reply.mjs"
```

- [ ] **Step 4: 브라우저 RED 확인**

Run:

```powershell
npm run build
npm run qa:ai-voice
```

Expected: 첫 `기본 off + 마이크`에서 `spoken.length`가 0이라 FAIL. 실제 Worker 요청은 0건이어야 한다.

- [ ] **Step 5: 화면에 순수 정책 연결**

`src/screens/child/AiFriendChat.tsx` import를 다음처럼 확장한다.

```ts
import {
  readChildVoiceReplyEnabled,
  shouldSpeakAiReply,
  SPEECH_LOCALE,
  speakableReplyText,
  writeChildVoiceReplyEnabled,
  type AiChatTurnSource,
} from "@/transform/childVoiceChat";
```

source 상태와 함수 인자를 좁힌다.

```ts
const [pendingSendSource, setPendingSendSource] = useState<AiChatTurnSource | null>(null);

const send = (
  raw: string,
  source: AiChatTurnSource,
  confirmedTool?: ConfirmedAiTool,
) => {
```

기존 `voiceReplyRef.current && reply` 조건을 다음으로 교체한다. 리치 마커 정리 뒤 읽을 말이 없으면 합성을 시작하지 않는다.

```ts
const spokenReply = speakableReplyText(reply);
if (shouldSpeakAiReply({
  source,
  persistentEnabled: voiceReplyRef.current,
  hasReply: Boolean(spokenReply),
})) {
  void speakText(spokenReply, speechLang);
}
```

기존 `send(spoken, "voice")`, 마이크 직전 `stopSpeaking()`, 토글 off 중단, unmount STT/TTS 중단은 그대로 둔다. 마이크 turn이 localStorage 값을 `on`으로 바꾸는 코드는 추가하지 않는다.

- [ ] **Step 6: 정적·격리 통합 GREEN 확인**

Run:

```powershell
node --test tests/childVoiceChat.test.ts
npm run build
npm run qa:ai-voice
```

Expected: 세 명령 모두 exit 0. QA는 `voice=1`, `textOff=0`, `textOn=1`, `empty=0`, `error=0`, 음성 turn 뒤 영구 설정 off 유지, 중단 event 순서를 요약하고 실제 외부 네트워크 요청 0건을 출력한다.

- [ ] **Step 7: 커밋**

```powershell
git add tests/childVoiceChat.test.ts src/screens/child/AiFriendChat.tsx scripts/verify-ai-friend-voice-reply.mjs package.json
git commit -m "아이의 음성 질문에 답을 자동으로 읽어준다"
```

---

### Task 3: 읽어주기 토글 의미를 10개 locale에 정확히 반영

**Files:**

- Modify: `tests/childVoiceChat.test.ts`
- Modify: `locales/descriptions.json`
- Modify: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/child.json`
- Regenerate: `src/i18n/generated/catalogs/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/child.ts`

- [ ] **Step 1: 정확 문구 회귀 테스트를 먼저 작성**

`tests/childVoiceChat.test.ts`에 다음 표를 추가하고 기존 non-empty 검사 뒤에 exact equality를 검사한다.

```ts
const VOICE_TOGGLE_COPY = {
  ko: ["글로 물어본 답도 읽어주기 켜기", "글로 물어본 답도 읽어주기 끄기"],
  en: ["Turn on reading answers to text questions aloud", "Turn off reading answers to text questions aloud"],
  ja: ["文字で聞いた答えも読み上げる設定をオンにする", "文字で聞いた答えも読み上げる設定をオフにする"],
  "zh-CN": ["开启朗读文字提问的回答", "关闭朗读文字提问的回答"],
  "zh-TW": ["開啟朗讀文字提問的回答", "關閉朗讀文字提問的回答"],
  vi: ["Bật đọc to câu trả lời cho câu hỏi bằng chữ", "Tắt đọc to câu trả lời cho câu hỏi bằng chữ"],
  th: ["เปิดการอ่านออกเสียงคำตอบของคำถามที่พิมพ์", "ปิดการอ่านออกเสียงคำตอบของคำถามที่พิมพ์"],
  id: ["Nyalakan pembacaan jawaban untuk pertanyaan yang diketik", "Matikan pembacaan jawaban untuk pertanyaan yang diketik"],
  ms: ["Hidupkan bacaan jawapan untuk soalan yang ditaip", "Matikan bacaan jawapan untuk soalan yang ditaip"],
  fil: ["I-on ang pagbasa nang malakas ng sagot sa text", "I-off ang pagbasa nang malakas ng sagot sa text"],
} as const;

for (const locale of LOCALES) {
  const catalog = JSON.parse(read(`locales/${locale}/child.json`)) as Record<string, string>;
  assert.deepEqual(
    [
      catalog["child.aiChat.voice.replyOnAria"],
      catalog["child.aiChat.voice.replyOffAria"],
    ],
    VOICE_TOGGLE_COPY[locale],
  );
}
```

- [ ] **Step 2: RED 확인**

Run: `node --test tests/childVoiceChat.test.ts`

Expected: 10개 locale의 기존 일반 `읽어주기 켜기/끄기` 문구가 새 exact 표와 달라 FAIL.

- [ ] **Step 3: 원본 catalog와 description 갱신**

각 `locales/<locale>/child.json`의 기존 ID 값만 위 표의 순서대로 바꾼다.

- `child.aiChat.voice.replyOnAria` = 각 locale 배열의 첫 값
- `child.aiChat.voice.replyOffAria` = 각 locale 배열의 둘째 값

`locales/descriptions.json`의 두 description은 다음으로 바꾼다.

```json
"description": "글로 물어본 답도 읽어주는 영구 설정을 켜는 토글 aria 라벨"
```

```json
"description": "글로 물어본 답도 읽어주는 영구 설정을 끄는 토글 aria 라벨"
```

- [ ] **Step 4: 생성 catalog 갱신**

Run: `node scripts/i18n/build-catalogs.mjs`

Expected: 생성물 완료 메시지. ID를 추가하지 않았으므로 `messageIds.ts`, `catalogLoaders.ts`, `legacyKoreanMessages.ts`는 변경되지 않고 10개 `generated/catalogs/*/child.ts`만 변경된다.

- [ ] **Step 5: locale GREEN 확인**

Run:

```powershell
node --test tests/childVoiceChat.test.ts tests/i18nCatalogContract.test.mjs tests/i18nChildScreens.test.mjs tests/i18nUiWiring.test.mjs
node scripts/i18n/validate-catalogs.mjs --check-generated
```

Expected: 모두 PASS, `i18n 카탈로그 검증 통과`.

- [ ] **Step 6: 커밋**

```powershell
git add tests/childVoiceChat.test.ts locales/descriptions.json locales/*/child.json src/i18n/generated/catalogs/*/child.ts
git commit -m "AI 음성 읽어주기 설정 문구를 명확히 한다"
```

---

### Task 4: Android TTS에 BCP 47 locale을 전달하고 미지원 언어를 fail-soft 처리

**Files:**

- Modify: `tests/childVoiceChat.test.ts`
- Modify: `src/lib/native/speech.ts`
- Create: `android/app/src/main/java/com/hyeni/calendar/SpeechLocalePolicy.java`
- Create: `android/app/src/main/java/com/hyeni/calendar/SpeechPlaybackGeneration.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/SpeechLocalePolicyTest.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/SpeechPlaybackGenerationTest.java`
- Create: `scripts/verify-native-tts-cdp.ps1`
- Create: `tests/nativeTtsCdpProbeSafety.test.mjs`

- [ ] **Step 1: 실패하는 JVM 정책 테스트 작성**

`SpeechLocalePolicyTest.java`를 다음 구조로 만든다.

```java
package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class SpeechLocalePolicyTest {
    private static final String[] SUPPORTED_TAGS = {
        "ko-KR", "en-US", "ja-JP", "zh-CN", "zh-TW",
        "vi-VN", "th-TH", "id-ID", "ms-MY", "fil-PH"
    };

    @Test
    public void supportedTagsReachTheLanguageSetterExactly() {
        for (String tag : SUPPORTED_TAGS) {
            AtomicReference<String> applied = new AtomicReference<>();
            assertTrue(SpeechLocalePolicy.apply(tag, locale -> {
                applied.set(locale.toLanguageTag());
                return 0;
            }));
            assertEquals(tag, applied.get());
        }
    }

    @Test
    public void blankAndIllFormedTagsFallBackToKorean() {
        for (String tag : new String[] { null, "", "   ", "not_a_tag", "en--US" }) {
            AtomicReference<String> applied = new AtomicReference<>();
            assertTrue(SpeechLocalePolicy.apply(tag, locale -> {
                applied.set(locale.toLanguageTag());
                return 0;
            }));
            assertEquals("ko-KR", applied.get());
        }
    }

    @Test
    public void onlyNonNegativeTtsStatusesAreUsable() {
        assertFalse(SpeechLocalePolicy.apply("ko-KR", locale -> -1));
        assertFalse(SpeechLocalePolicy.apply("ko-KR", locale -> -2));
        assertTrue(SpeechLocalePolicy.apply("ko-KR", locale -> 0));
        assertTrue(SpeechLocalePolicy.apply("ko-KR", locale -> 1));
        assertTrue(SpeechLocalePolicy.apply("ko-KR", locale -> 2));
    }
}
```

`SpeechPlaybackGenerationTest.java`에는 초기화 중 중단과 새 요청의 세대 교체를 먼저 고정한다.

```java
package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SpeechPlaybackGenerationTest {
    @Test
    public void cancelInvalidatesAnInitializingRequest() {
        SpeechPlaybackGeneration generation = new SpeechPlaybackGeneration();
        long request = generation.next();
        assertTrue(generation.isCurrent(request));
        generation.cancel();
        assertFalse(generation.isCurrent(request));
    }

    @Test
    public void newerRequestInvalidatesThePreviousRequest() {
        SpeechPlaybackGeneration generation = new SpeechPlaybackGeneration();
        long first = generation.next();
        long second = generation.next();
        assertFalse(generation.isCurrent(first));
        assertTrue(generation.isCurrent(second));
    }
}
```

- [ ] **Step 2: JVM RED 확인**

Run from `android/`:

```powershell
.\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.SpeechLocalePolicyTest --tests com.hyeni.calendar.SpeechPlaybackGenerationTest
```

Expected: 두 production class가 없어 `cannot find symbol`로 FAIL.

- [ ] **Step 3: 실패하는 JS→native 언어 전달 계약 추가**

`tests/childVoiceChat.test.ts`의 첫 테스트에 다음 assertion을 추가한다.

```ts
assert.match(speech, /speak\(opts:\s*\{\s*text:\s*string;\s*language\?:\s*string;\s*rate\?:\s*number/);
assert.match(speech, /plugin\.speak\(\{\s*text:\s*spoken,\s*language,\s*rate\s*\}\)/);
assert.match(speech, /const generation = \+\+speechPlaybackGeneration/);
assert.match(speech, /generation !== speechPlaybackGeneration/);
assert.match(speech, /export function stopSpeaking\(\): void \{\s*speechPlaybackGeneration \+= 1;/);

const plugin = read("android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java");
assert.match(plugin, /SpeechPlaybackGeneration ttsGeneration/);
assert.match(plugin, /ttsGeneration\.next\(\)/);
assert.match(plugin, /ttsGeneration\.cancel\(\)/);
assert.match(plugin, /ttsGeneration\.isCurrent\(/);
assert.match(plugin, /SpeechLocalePolicy\.apply\(/);
assert.doesNotMatch(plugin, /Locale\.KOREAN/);
```

Run: `node --test tests/childVoiceChat.test.ts`

Expected: 현재 native 옵션이 `text, rate`뿐이고 JS/native generation guard가 없어 FAIL.

- [ ] **Step 4: serial 비의존 CDP probe의 실패 테스트 작성**

`tests/nativeTtsCdpProbeSafety.test.mjs`는 아직 없는 `scripts/verify-native-tts-cdp.ps1`을 읽고 다음을 고정한다.

```js
assert.match(probe, /ClientWebSocket/);
assert.match(probe, /127\.0\.0\.1/);
assert.match(probe, /ValidateSet\("Identity",\s*"Tts"\)/);
assert.match(probe, /expectedRole\s*=\s*"child"/i);
assert.match(probe, /familyScopesMatch/);
assert.match(probe, /\.afc/);
assert.match(probe, /SpeechRecognition\.speak/);
assert.match(probe, /SpeechRecognition\.stopSpeak/);
assert.doesNotMatch(probe, /\badb\b|refresh|Authorization|Bearer/);
assert.doesNotMatch(probe, /https?:\/\/(?!127\.0\.0\.1)/);
```

Run: `node --test tests/nativeTtsCdpProbeSafety.test.mjs`

Expected: probe 파일이 없어 FAIL.

- [ ] **Step 5: 순수 locale·재생 generation 정책 구현**

`SpeechLocalePolicy.java`를 다음으로 만든다.

```java
package com.hyeni.calendar;

import java.util.IllformedLocaleException;
import java.util.Locale;

final class SpeechLocalePolicy {
    static final String DEFAULT_LANGUAGE_TAG = "ko-KR";
    private static final Locale DEFAULT_LOCALE =
        Locale.forLanguageTag(DEFAULT_LANGUAGE_TAG);

    @FunctionalInterface
    interface LanguageSetter {
        int setLanguage(Locale locale);
    }

    private SpeechLocalePolicy() {}

    static Locale resolve(String rawTag) {
        String tag = rawTag == null ? "" : rawTag.trim();
        if (tag.isEmpty()) return DEFAULT_LOCALE;
        try {
            Locale locale = new Locale.Builder().setLanguageTag(tag).build();
            return locale.getLanguage().isEmpty() ? DEFAULT_LOCALE : locale;
        } catch (IllformedLocaleException ignored) {
            return DEFAULT_LOCALE;
        }
    }

    static boolean apply(String rawTag, LanguageSetter setter) {
        return setter.setLanguage(resolve(rawTag)) >= 0;
    }
}
```

`SpeechPlaybackGeneration.java`는 Android framework에 의존하지 않는 다음 package-private class로 만든다.

```java
package com.hyeni.calendar;

final class SpeechPlaybackGeneration {
    private long current = 0L;

    long next() {
        current += 1L;
        return current;
    }

    void cancel() {
        current += 1L;
    }

    boolean isCurrent(long generation) {
        return generation == current;
    }
}
```

- [ ] **Step 6: JS 브리지에 language와 pending 재생 무효화 적용**

`src/lib/native/speech.ts`를 다음처럼 바꾼다.

```ts
interface NativeSpeakPlugin {
  speak(opts: { text: string; language?: string; rate?: number }): Promise<{ started?: boolean }>;
  stopSpeak(): Promise<{ status?: string }>;
}
```

```ts
const result = await plugin.speak({ text: spoken, language, rate });
```

module scope에 `let speechPlaybackGeneration = 0;`을 둔다. `speakText()` 시작에서 `const generation = ++speechPlaybackGeneration;`을 캡처하고 native `await` 직후, native catch 직후, 웹 합성 직전에 `generation !== speechPlaybackGeneration`이면 `false`를 반환한다. `stopSpeaking()` 첫 줄은 `speechPlaybackGeneration += 1;`로 이전 native 초기화 callback과 웹 폴백을 모두 무효화한다. 웹 폴백의 `utterance.lang = language`는 그대로 둔다.

- [ ] **Step 7: Android plugin의 고정 한국어 제거와 초기화 중 중단 선형화**

`SpeechPlugin.java`에서 `java.util.Locale` import를 제거한다. `speak()`에서 다음을 읽는다.

```java
String language = call.getString(
    "language",
    SpeechLocalePolicy.DEFAULT_LANGUAGE_TAG
);
```

다음 상태를 추가한다.

```java
private final SpeechPlaybackGeneration ttsGeneration = new SpeechPlaybackGeneration();
private boolean ttsInitializing = false;
private PendingTtsRequest pendingTtsRequest;
```

`PendingTtsRequest`는 `PluginCall call`, `String text`, `String language`, `float rate`, `long generation`을 final field로 보관하는 private static inner class다.

`speak()`의 UI-thread block은 다음 순서를 지킨다.

1. `long generation = ttsGeneration.next()`로 새 요청이 이전 요청을 무효화한다.
2. `ttsReady`면 `startUtterance(request)`를 즉시 호출한다.
3. 초기화 중이면 기존 `pendingTtsRequest.call`을 `{ started:false }`로 resolve하고 최신 request로 교체한다.
4. 초기화 중이 아니면 `ttsInitializing=true`로 만든 뒤 `TextToSpeech`를 정확히 한 번 생성한다.
5. init callback은 UI thread에서 `ttsInitializing=false`로 만들고 최신 pending을 한 번 꺼낸다. init 성공이면 `ttsReady=true`로 만들되, pending이 없거나 generation이 stale이면 절대 `speak()`하지 않는다. stale call은 `{ started:false }`로 resolve한다. 최신 요청만 `startUtterance(request)`로 보낸다.

공용 응답 helper는 다음 모양을 사용한다.

```java
private void resolveNotStarted(PluginCall call) {
    call.resolve(new JSObject().put("started", false));
}
```

`startUtterance(PendingTtsRequest request)` 시작 부분을 다음으로 바꾼다.

```java
private void startUtterance(PendingTtsRequest request) {
    try {
        if (!ttsGeneration.isCurrent(request.generation)) {
            resolveNotStarted(request.call);
            return;
        }
        if (!SpeechLocalePolicy.apply(request.language, textToSpeech::setLanguage)) {
            textToSpeech.stop();
            request.call.reject("TTS language not available");
            return;
        }
        textToSpeech.setSpeechRate(request.rate);
```

이 guard 다음의 기존 utterance listener와 `QUEUE_FLUSH`를 유지하되 `request.text`와 `request.call`을 사용한다.

`stopSpeak()`의 UI-thread block은 `ttsGeneration.cancel()` → pending call `started:false` resolve/clear → `textToSpeech.stop()` 순서로 실행한다. `handleOnDestroy()`도 generation을 먼저 cancel하고 pending call을 `started:false`로 resolve/clear한 뒤 기존 stop/shutdown을 실행한다. 이 순서로 init callback이 늦게 와도 native 재생을 시작하지 않고, JS의 stale check 때문에 오래된 답변이 웹 폴백으로 되살아나지도 않는다.

미지원 언어에서 `ttsReady=false`, shutdown, 언어팩 설치 화면 열기, 음성 텍스트 로그 출력을 추가하지 않는다. reject는 기존 JS catch를 거쳐 웹 `speechSynthesis`로 강등된다.

- [ ] **Step 8: token을 반출하지 않는 localhost CDP probe 작성**

`scripts/verify-native-tts-cdp.ps1`은 `-Port` 기본값 9224와 `[ValidateSet("Identity", "Tts")] -Mode` 기본값 `Tts`만 받고 adb 명령은 실행하지 않는다. `.NET ClientWebSocket`을 사용해 `http://127.0.0.1:<Port>/json/list`에서 `localhost` 혜니 WebView target 하나만 고르고, Origin header를 설정하지 않은 채 그 target에 연결한다. 모든 `Runtime.evaluate`는 `awaitPromise=false`의 짧은 동기식 명령으로 보내고 결과는 별도 polling한다.

역할 확인 expression은 raw session을 WebView 안에서만 파싱하고 다음 projection만 반환한다.

```js
(() => {
  const session = JSON.parse(localStorage.getItem("hyeni-api-session-v1") || "null");
  const app = session?.user?.app_metadata ?? {};
  const user = session?.user?.user_metadata ?? {};
  return {
    role: app.role ?? user.role ?? null,
    hasFamilyId: typeof (app.family_id ?? user.family_id) === "string" && (app.family_id ?? user.family_id).length > 0,
    familyScopesMatch: !app.family_id || !user.family_id || app.family_id === user.family_id,
    rootVisible: (() => {
      const root = document.querySelector(".afc");
      return !!root && root.getClientRects().length > 0;
    })(),
  };
})()
```

script는 먼저 `role === "child"`, `hasFamilyId`, `familyScopesMatch`를 확인한다. `location.hash = "#/child/ai-friend"`로 이동한 뒤 `.afc` 가시성을 확인하며 raw session은 PowerShell로 반환하지 않는다. `Mode=Identity`에서는 여기서 끝내고, `Mode=Tts`에서만 운영 AI API를 호출하지 않은 채 native plugin에 다음 두 동작을 보낸다.

1. `"AI 친구 음성 답변 확인이야."`를 `ko-KR`, rate 1로 재생하고 2.5초 기다린다.
2. `"AI 친구 음성 답변 중단 확인을 위해 이 문장을 끝까지 천천히 읽고 있어. 중간에 소리가 멈추는지 확인해 줘."`를 재생하고 700ms 뒤 `stopSpeak()`를 호출한다.

각 Promise는 WebView의 `window.__hyeniNativeTtsProbe`에 `pending|started|stopped|failed` enum만 남기고 PowerShell은 별도 polling으로 확인한다. stdout은 `mode`, `role`, `hasFamilyId`, `familyScopesMatch`, `rootVisible`, 짧은 재생·긴 재생·중단 enum만 담은 단일 JSON으로 제한한다. raw session·familyId·JWT·음성 텍스트는 출력하지 않는다.

- [ ] **Step 9: 관련 GREEN 확인**

Run:

```powershell
node --test tests/childVoiceChat.test.ts tests/nativeTtsCdpProbeSafety.test.mjs
Push-Location android
try {
  .\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.SpeechLocalePolicyTest --tests com.hyeni.calendar.SpeechPlaybackGenerationTest
  if ($LASTEXITCODE -ne 0) { throw "Android 음성 정책 테스트 실패" }
} finally {
  Pop-Location
}
```

Expected: Node와 JVM 테스트 모두 PASS. source guard는 `Locale.KOREAN` 재도입, native/JS generation 누락, unsafe CDP probe를 차단한다.

- [ ] **Step 10: 커밋**

```powershell
git add tests/childVoiceChat.test.ts tests/nativeTtsCdpProbeSafety.test.mjs src/lib/native/speech.ts scripts/verify-native-tts-cdp.ps1 android/app/src/main/java/com/hyeni/calendar/SpeechLocalePolicy.java android/app/src/main/java/com/hyeni/calendar/SpeechPlaybackGeneration.java android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java android/app/src/test/java/com/hyeni/calendar/SpeechLocalePolicyTest.java android/app/src/test/java/com/hyeni/calendar/SpeechPlaybackGenerationTest.java
git commit -m "Android AI 음성 답변에 앱 언어를 전달한다"
```

---

### Task 5: 기존 공개 문구 오표기를 별도 선행 수정하고 음성 개인정보 경계를 반영

**Files:**

- Modify: `worker/tests/legalCopy.test.mjs`
- Modify: `worker/routes/legal.ts`
- Modify: `tests/playReleaseDocumentation.test.mjs`
- Modify: `worker/README.md`
- Modify: `docs/store/play-release-checklist.md`
- Modify: `docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md`
- Modify: `docs/reports/2026-08-01-pricing-launch-readiness.md`
- Modify: `docs/store/play-data-safety.md`

- [ ] **Step 1: 기존 추천·신고 오표기의 실패 테스트를 먼저 작성**

`worker/tests/legalCopy.test.mjs`의 기존 10회 assertion을 교체하고 현재 UI·정책을 정확히 고정한다.

```js
assert.match(source, /친구 초대 보상은 유료 구독권이 아니라 양쪽 가족에 각각 AI 대화 50회/);
assert.match(source, /초대 가족 수 상한은 없습니다/);
assert.doesNotMatch(source, /양쪽 가족에 AI 대화 10회|최대 3가족/);
assert.match(source, /상대가 보낸 가족 메모를 길게 눌러/);
assert.match(source, /AI 친구 답변을 길게 눌러 '이 답변 신고'/);
assert.doesNotMatch(source, /해당 메시지 아래의 '신고·차단'|답변 아래의 '이 답변 신고'/);
```

`tests/playReleaseDocumentation.test.mjs`의 `Promise.all`에 `read("../worker/README.md")`를 추가해 `workerReadme`를 받는다. 다음 네 문서의 친구 초대 문단이 모두 현재 정본을 말하는지 검사한다.

```js
for (const currentReferralDocument of [workerReadme, checklist, guide, readiness]) {
  assert.match(
    currentReferralDocument,
    /(?:친구 초대|추천 보상|양쪽 가족)[^\n]*(?:각각|양쪽 가족)[^\n]*AI 대화 50회/,
  );
  assert.match(
    currentReferralDocument,
    /초대 가족 수 상한(?:은)? (?:없다|없음|없습니다)/,
  );
  assert.doesNotMatch(
    currentReferralDocument,
    /(?:친구 초대|추천 보상|추천인 가족)[^\n]*(?:AI 대화 10회|최대 3가족|평생 3가족)/,
  );
}
```

- [ ] **Step 2: 기존 오표기 RED 확인**

Run:

```powershell
node --test worker/tests/legalCopy.test.mjs
node --test tests/playReleaseDocumentation.test.mjs
```

Expected: Worker 약관과 네 현행 운영 문서에 남은 10회·3가족 및 신고 버튼 위치 때문에 새 테스트가 FAIL.

- [ ] **Step 3: 기존 오표기를 모든 현행 문서에서 함께 수정**

`worker/routes/legal.ts`의 친구 초대 조항을 다음으로 교체한다.

```ts
"친구 초대 보상은 유료 구독권이 아니라 양쪽 가족에 각각 AI 대화 50회를 한 번 지급하는 혜택입니다. 초대 가족 수 상한은 없습니다. 신규 가족 생성 72시간 경과와 첫 실제 위치 저장 후 48시간 유지가 모두 확인되어야 지급됩니다. 본인·공동 보호자·기존 가족·중복 추천 또는 부정 이용은 지급 대상에서 제외됩니다.",
```

신고·차단 조항 두 줄도 현재 long-press UI에 맞춘다.

```ts
"상대가 보낸 가족 메모를 길게 눌러 앱 안에서 신고하거나 상대의 메모를 차단할 수 있습니다. 차단은 두 사람 사이의 메모 조회·푸시에만 적용되며 가족 연결, 위치 공유, SOS, 도착·위험장소 등 안전 알림은 중단하지 않습니다.",
"AI 친구 답변을 길게 눌러 '이 답변 신고'로 앱 안에서 신고할 수 있습니다. 신고 내용은 운영 검토 큐에 저장되며 부모에게 자동 전달된다고 표시하지 않습니다.",
```

다음 네 현행 운영 문서의 친구 초대 문단을 같은 정책으로 동기화한다. 문서 제목의 과거 날짜는 파일 식별자일 뿐 정책 수치를 과거값으로 남길 이유가 없으므로 현재 운영 문구는 모두 갱신한다.

- `worker/README.md`
- `docs/store/play-release-checklist.md`
- `docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md`의 두 군데
- `docs/reports/2026-08-01-pricing-launch-readiness.md`

모든 문서는 `양쪽 가족에 각각 AI 대화 50회 1회 지급`, `초대 가족 수 상한 없음`, `신규 가족 72시간 + 첫 실제 위치 후 48시간`을 함께 유지한다. 클라이언트 지급 endpoint 없음, 부정 이용 차단, 최소수집 조건은 삭제하지 않는다.

- [ ] **Step 4: 기존 문구 GREEN 확인 후 별도 커밋**

Run:

```powershell
node --test worker/tests/legalCopy.test.mjs
node --test tests/playReleaseDocumentation.test.mjs
```

Expected: 두 테스트 PASS. 네 운영 문서의 친구 초대 문단에 10회·3가족 문구가 남지 않는다.

```powershell
git add worker/tests/legalCopy.test.mjs worker/routes/legal.ts tests/playReleaseDocumentation.test.mjs worker/README.md docs/store/play-release-checklist.md docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md docs/reports/2026-08-01-pricing-launch-readiness.md
git commit -m "친구 초대와 신고 공개 문구를 현재 정책에 맞춘다"
```

- [ ] **Step 5: 음성 처리 공개 문구의 실패 테스트 작성**

`worker/tests/legalCopy.test.mjs`에서 갱신일 기대값을 `2026-08-18`로 바꾸고 개인정보 처리 테스트에 다음을 추가한다.

```js
assert.match(source, /일정·AI 친구 음성 입력/);
assert.match(source, /Worker와 OpenAI에는 음성 원본이 아니라 인식된 텍스트만 전송/);
assert.match(source, /Android TextToSpeech/);
assert.match(source, /Web speechSynthesis/);
assert.match(source, /합성할 AI 답변 텍스트/);
```

외부 처리업체 배열에는 `TextToSpeech`, `speechSynthesis`를 추가한다.

`tests/playReleaseDocumentation.test.mjs`의 Data Safety 테스트에도 다음을 추가한다.

```js
assert.match(dataSafety, /AI 일정·AI 친구 음성 입력/);
assert.match(dataSafety, /Worker와 OpenAI에는 음성 원본이 아니라 인식된 텍스트만 전송/);
assert.match(dataSafety, /TextToSpeech/);
assert.match(dataSafety, /speechSynthesis/);
assert.match(dataSafety, /합성할 AI 답변 텍스트/);
assert.match(dataSafety, /음성이 항상 기기 안에서만 처리된다[^\n]*설명하지 않는다/);
assert.match(dataSafety, /assistant 답변[^\n]*읽어주기[^\n]*(?:TextToSpeech|speechSynthesis)/);
```

외부 처리업체 배열에는 `TextToSpeech`, `speechSynthesis`를 추가한다.

- [ ] **Step 6: 음성 고지 RED 확인**

Run:

```powershell
node --test worker/tests/legalCopy.test.mjs
node --test tests/playReleaseDocumentation.test.mjs
```

Expected: 기존 정책 교정 테스트는 계속 PASS하고 새 음성 합성·외부 처리 문구만 없어 FAIL.

- [ ] **Step 7: Worker 공개 개인정보 문구 갱신**

`worker/routes/legal.ts`의 `META.lastUpdated`를 `2026-08-18`로 바꾼다.

`EXTERNAL_PROCESSING`의 음성 항목을 다음으로 교체한다.

```ts
"운영체제·브라우저 음성 서비스 제공자(Android SpeechRecognizer·Web Speech Recognition·Android TextToSpeech·Web speechSynthesis 및 선택된 음성 엔진) — 음성 입력 시 사용자 음성·인식 결과·기기 관련 정보를, 답변 읽어주기 시 합성할 AI 답변 텍스트·기기 관련 정보를 외부에서 처리할 수 있음",
```

개인정보 선택 항목의 음성 문구를 다음으로 교체한다.

```ts
"• 음성 입력·AI 답변 읽어주기: 일정·AI 친구 음성 입력은 운영체제 또는 브라우저의 음성 인식 서비스가 음성을 처리할 수 있으며, 혜니캘린더 Worker와 OpenAI에는 음성 원본이 아니라 인식된 텍스트만 전송됩니다. AI 친구 답변 읽어주기를 사용하면 운영체제·브라우저·선택된 음성 엔진이 합성할 AI 답변 텍스트와 기기 관련 정보를 외부에서 처리할 수 있습니다.",
```

- [ ] **Step 8: Play Data Safety 초안 갱신**

`docs/store/play-data-safety.md`에서 다음을 모두 수행한다.

- 초안 기준일을 `2026-08-18`로 바꾼다.
- 총괄의 `음성 인식 제공자`를 `음성 인식·합성 제공자`로 바꾼다.
- 오디오 행의 이름을 `AI 일정·AI 친구 음성 입력`으로 바꾸고, STT 제공자가 음성을 처리하며 `혜니캘린더 Worker와 OpenAI에는 음성 원본이 아니라 인식된 텍스트만 전송`한다고 적는다.
- AI 친구 프롬프트·assistant 답변 행의 처리 칸에 읽어주기 사용 시 Android `TextToSpeech`, Web `speechSynthesis`, 선택된 엔진이 합성할 assistant 답변 텍스트를 처리할 수 있다고 적는다.
- 제목을 `음성 인식·합성 외부 처리 주의`로 바꾸고, “항상 기기 안에서만 처리된다”고 설명하지 않는 STT 원본 경계와 TTS 답변 텍스트 경계를 함께 적는다.
- provider 행을 `OS/브라우저 음성 인식·합성 제공자`로 바꾸고 사용자 음성·인식 결과·기기 관련 정보·합성할 AI 답변 텍스트와 TTS 엔진의 계약·보관·학습·아동 적격성 증거를 열거한다.
- Families 대상 목록과 제출 체크의 `음성 인식`을 `음성 인식·합성`으로 확장한다.

- [ ] **Step 9: 음성 공개 문서 GREEN 확인**

Run:

```powershell
node --test worker/tests/legalCopy.test.mjs
node --test tests/playReleaseDocumentation.test.mjs
npm run typecheck:worker
```

Expected: 두 대상 테스트와 Worker typecheck 모두 PASS.

- [ ] **Step 10: 음성 고지를 별도 커밋**

```powershell
git add worker/tests/legalCopy.test.mjs worker/routes/legal.ts tests/playReleaseDocumentation.test.mjs docs/store/play-data-safety.md
git commit -m "AI 음성 처리 경계를 공개 문서에 반영한다"
```

---

### Task 6: 운영 정본 동기화, 전체 검증, 배포와 안전한 실기기 확인

이 계획의 실행 방식을 사용자가 선택하면 이 Task의 Worker·Pages 배포와 razr `install -r`까지 포함한다. 단 모든 로컬 검증과 운영 D1 read-only preflight가 통과해야 하며, 실패 뒤 다른 기기·migration·secret 변경으로 우회하지 않는다.

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify after deployment evidence: `CLAUDE.md`

- [ ] **Step 1: AGENTS/CLAUDE에 같은 음성 turn 계약 기록**

두 파일의 현행 AI 친구 블록과 `AI 실패 안내` 사이에 다음 문단을 같은 내용으로 넣는다.

```md
- ★**AI 친구 음성 turn 자동 답변(2026-08-18 TK 승인)**: 마이크가 만든 `source="voice"`의 정상 reply는 가족+아이 읽어주기 설정이 꺼져 있어도 그 turn만 자동 TTS한다. `composer`·`suggestion:*`·`confirm`은 기존 영구 설정을 따르고, 빈·오류·한도 응답은 읽지 않는다. 새 마이크 시작·토글 off·화면 이탈은 STT/TTS를 즉시 중단하며 초기화 중이던 오래된 native callback도 재생을 되살리지 않는다. 사용자 음성 원본은 Worker·OpenAI에 보내지 않고 인식 텍스트만 기존 안전·크레딧·저장 경로로 보낸다. 단 OS·브라우저·선택된 STT/TTS 제공자는 음성 또는 합성할 답변 텍스트를 외부 처리할 수 있으므로 “항상 기기 안에서만 처리”라고 고지하지 않는다. TTS는 추가 API·크레딧·권한 없이 fail-soft이며 10개 locale 태그를 전달한다. 회귀=`tests/childVoiceChat.test.ts`·`tests/nativeTtsCdpProbeSafety.test.mjs`·Android `SpeechLocalePolicyTest`/`SpeechPlaybackGenerationTest`·`worker/tests/legalCopy.test.mjs`·`tests/playReleaseDocumentation.test.mjs`.
```

- [ ] **Step 2: 정본 문서 커밋**

```powershell
git add AGENTS.md CLAUDE.md
git commit -m "AI 친구 음성 답변 운영 계약을 기록한다"
```

- [ ] **Step 3: 전체 앱·Worker·i18n 검증**

Run from repository root. 한 명령이라도 실패하면 배포로 넘어가지 않는다.

```powershell
node scripts/i18n/validate-catalogs.mjs --check-generated
node --test tests/childVoiceChat.test.ts tests/nativeTtsCdpProbeSafety.test.mjs tests/playReleaseDocumentation.test.mjs
npm run typecheck
npm test
npm run typecheck:worker
npm run test:worker
npm run build
npm run qa:ai-voice
git diff --check
```

Expected: 전부 exit 0. `qa:ai-voice`는 service worker·DNS·HTTP·WebSocket 차단 아래에서 실제 외부 네트워크 요청 0건을 확인한다.

- [ ] **Step 4: Capacitor 동기화와 Android 전체 검증**

```powershell
npx --no-install cap sync android
if ($LASTEXITCODE -ne 0) { throw "Capacitor Android 동기화 실패" }

Push-Location -LiteralPath android
try {
  .\gradlew.bat testDebugUnitTest lintDebug assembleDebug
  if ($LASTEXITCODE -ne 0) { throw "Android unit/lint/assemble 검증 실패" }
} finally {
  Pop-Location
}

git diff --check
if ($LASTEXITCODE -ne 0) { throw "공백 오류가 남았습니다" }
```

Expected: JVM unit, lint, debug APK assemble 모두 성공. `cap sync`가 의도하지 않은 tracked 변경을 만들면 diff를 검토해 원인을 해결한 뒤 전체 검증부터 다시 실행한다.

- [ ] **Step 5: clean exact source를 push하고 배포 SHA 고정**

```powershell
if (git status --porcelain) { throw "배포 전 worktree가 clean하지 않습니다" }
$sourceCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -cnotmatch '^[0-9a-f]{40}$') {
  throw "배포 source commit을 확인하지 못했습니다"
}
git log -7 --oneline
git push origin main
if ($LASTEXITCODE -ne 0) { throw "origin/main push 실패" }
$remoteCommit = (git rev-parse origin/main).Trim()
if ($remoteCommit -cne $sourceCommit) { throw "origin/main이 배포 SHA와 다릅니다" }
```

Expected: 구현·문서 커밋이 원격 main에 있고 이후 배포는 이 `$sourceCommit`을 사용한다.

- [ ] **Step 6: Cloudflare 자격 증명을 출력 없이 주입하는 공용 shell guard 준비**

다음 helper를 Step 7~9의 각 독립 PowerShell block 맨 앞에 포함한다. 루트 `.env`의 D1 전용 token이나 만료된 global Wrangler OAuth를 쓰지 않는다. `worker/.env`의 두 값을 따옴표 제거 후 process env로 주입하고, 성공·실패 모두 이전 process env를 복원한다. 값 자체는 stdout·오류·파일에 출력하지 않는다.

```powershell
$repoRoot = 'C:\Users\TK\Desktop\hyeni-3'
$workerEnvPath = Join-Path $repoRoot 'worker/.env'
$wranglerCli = Join-Path $repoRoot 'node_modules/wrangler/bin/wrangler.js'
$wranglerConfig = Join-Path $repoRoot 'worker/wrangler.toml'
foreach ($requiredPath in @($workerEnvPath, $wranglerCli, $wranglerConfig)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) { throw "배포 필수 파일 누락" }
}

function Get-ReleaseEnvValue([string]$Name) {
  $pattern = '^\s*' + [Regex]::Escape($Name) + '\s*='
  $lines = @(Get-Content -LiteralPath $workerEnvPath | Where-Object { $_ -match $pattern })
  if ($lines.Count -ne 1) { throw "worker/.env 키가 정확히 하나가 아닙니다: $Name" }
  $value = $lines[0].Substring($lines[0].IndexOf('=') + 1).Trim()
  if ($value.Length -ge 2) {
    $first = $value.Substring(0, 1)
    $last = $value.Substring($value.Length - 1, 1)
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  if ([string]::IsNullOrWhiteSpace($value)) { throw "worker/.env 값이 비었습니다: $Name" }
  return $value
}

function Remove-ExactReleaseTempDirectory([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $leaf = [IO.Path]::GetFileName($fullPath)
  if (-not $fullPath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      $leaf -notmatch '^hyeni-(?:d1|worker|pages)-ai-voice-[0-9a-f]{32}$') {
    throw "허용되지 않은 임시 디렉터리 삭제 대상"
  }
  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

function Invoke-WithCloudflareReleaseCredentials([scriptblock]$Action) {
  $hadToken = Test-Path Env:\CLOUDFLARE_API_TOKEN
  $hadAccount = Test-Path Env:\CLOUDFLARE_ACCOUNT_ID
  $oldToken = $env:CLOUDFLARE_API_TOKEN
  $oldAccount = $env:CLOUDFLARE_ACCOUNT_ID
  try {
    $env:CLOUDFLARE_API_TOKEN = Get-ReleaseEnvValue 'CLOUDFLARE_API_TOKEN'
    $env:CLOUDFLARE_ACCOUNT_ID = Get-ReleaseEnvValue 'CLOUDFLARE_ACCOUNT_ID'
    & $Action
  } finally {
    if ($hadToken) { $env:CLOUDFLARE_API_TOKEN = $oldToken }
    else { Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue }
    if ($hadAccount) { $env:CLOUDFLARE_ACCOUNT_ID = $oldAccount }
    else { Remove-Item Env:\CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue }
  }
}
```

- [ ] **Step 7: 프로덕션 D1 read-only preflight를 통과시킴**

위 guard 안에서 저장소의 정본 SQL을 `Get-Content -Raw`로 읽고 direct local Wrangler를 사용한다. `.env`가 없는 새 임시 디렉터리에서 실행하고 종료 후 그 정확한 빈 디렉터리만 제거한다.

```powershell
Invoke-WithCloudflareReleaseCredentials {
  $sqlPath = Join-Path $repoRoot 'worker/ops/release-d1-readonly-preflight.sql'
  if (-not (Test-Path -LiteralPath $sqlPath)) { throw "D1 read-only preflight SQL 누락" }
  $sql = Get-Content -LiteralPath $sqlPath -Raw
  $opsDir = Join-Path ([IO.Path]::GetTempPath()) ("hyeni-d1-ai-voice-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $opsDir | Out-Null
  Push-Location -LiteralPath $opsDir
  try {
    $raw = (node $wranglerCli d1 execute hyeni-calendar --remote --yes --json "--command=$sql" "--config=$wranglerConfig" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "운영 D1 read-only preflight 실행 실패" }
  } finally {
    Pop-Location
    Remove-ExactReleaseTempDirectory $opsDir
  }

  try { $batch = @($raw | ConvertFrom-Json -ErrorAction Stop) }
  catch { throw "D1 preflight 응답이 JSON이 아닙니다" }
  if ($batch.Count -ne 1 -or $batch[0].success -ne $true) {
    throw "D1 preflight 성공 batch가 정확히 하나가 아닙니다"
  }
  $rows = @($batch[0].results)
  if ($rows.Count -ne 1) { throw "D1 preflight 결과 행이 정확히 하나가 아닙니다" }
  $meta = $batch[0].meta
  foreach ($metaField in @('changes', 'changed_db', 'rows_written')) {
    if ($meta.PSObject.Properties.Name -notcontains $metaField) {
      throw "D1 preflight meta 필드 누락: $metaField"
    }
  }
  if ($meta.changed_db -isnot [bool]) { throw "D1 changed_db가 boolean이 아닙니다" }
  if ([int64]$meta.changes -ne 0 -or $meta.changed_db -ne $false -or [int64]$meta.rows_written -ne 0) {
    throw "D1 read-only preflight가 쓰기를 보고했습니다"
  }
  $row = $rows[0]
  $zeroFields = @(
    'missing_objects', 'duplicate_groups', 'duplicate_rows', 'rows_removed_by_merge',
    'ai_parent_settings_duplicate_groups', 'ai_parent_settings_duplicate_rows',
    'ai_parent_settings_rows_to_normalize'
  )
  $oneFields = @(
    'has_exact_ai_parent_settings_unique', 'has_ai_friend_limit_source',
    'has_ai_schedule_limit_source', 'has_debt_applied', 'has_refund_status',
    'has_customer_key', 'has_web_ai_record_scope'
  )
  foreach ($requiredField in (@('required_objects', 'present_objects') + $zeroFields + $oneFields)) {
    if ($row.PSObject.Properties.Name -notcontains $requiredField) {
      throw "D1 preflight 결과 필드 누락: $requiredField"
    }
  }
  if ([int64]$row.required_objects -ne [int64]$row.present_objects) {
    throw "D1 required/present object 집계가 다릅니다"
  }
  foreach ($zeroField in $zeroFields) {
    if ([int64]$row.$zeroField -ne 0) { throw "D1 preflight 0 불변식 실패: $zeroField" }
  }
  foreach ($oneField in $oneFields) {
    if ([int64]$row.$oneField -ne 1) { throw "D1 preflight readiness 실패: $oneField" }
  }
}
```

Expected: 식별자 없는 단일 집계 행, 쓰기 meta 0/false/0, 누락·중복 0, 일곱 readiness flag 1. 이 기능에는 migration이 없으므로 하나라도 다르면 기존 SQL을 적용하거나 데이터를 수정하지 말고 배포를 중단해 보고한다.

- [ ] **Step 8: 이전 Worker version을 확보한 뒤 배포·health·법적 readback을 원자적으로 검증**

위 자격 증명 guard와 저장소 밖 임시 디렉터리에서 다음 순서를 지킨다.

1. `node $wranglerCli deployments list --name hyeni-calendar-api --json "--config=$wranglerConfig"`를 파싱하고 `created_on`이 가장 늦은 deployment에서 `percentage === 100`인 version을 정확히 하나 골라 UUID 형식의 `$previousWorkerVersionId`로 보존한다. Wrangler의 JSON 배열 순서를 최신순이라고 가정하지 않는다.
2. `node $wranglerCli deploy "--config=$wranglerConfig" --message="AI 친구 음성 답변 공개 고지"`를 실행한다. `npm run deploy:worker`나 `npx`는 사용하지 않는다.
3. deployments list를 다시 읽어 새 100% active version이 이전 ID와 다른지 확인하고 `$workerVersionId`로 기록한다.
4. 최대 3회, 5초 간격으로 `/api/health`, `/privacy`, `/terms`를 함께 확인한다. health JSON은 property가 정확히 `ok`, `status` 두 개이며 `{ ok:true, status:"ready" }`여야 한다. 두 HTML은 redirect 없는 HTTPS 200이어야 한다.
5. `/privacy`는 `2026-08-18`, `일정·AI 친구 음성 입력`, `Android TextToSpeech`, `Web speechSynthesis`, `음성 원본이 아니라 인식된 텍스트`를 포함해야 한다.
6. `/terms`는 `양쪽 가족에 각각 AI 대화 50회`, `초대 가족 수 상한은 없습니다`, `상대가 보낸 가족 메모를 길게 눌러`, `AI 친구 답변을 길게 눌러`를 포함하고 `최대 3가족`은 포함하지 않아야 한다.

active version 판정은 다음 helper처럼 배열 위치가 아니라 `created_on`으로 한다. 이 helper와 deploy/readback을 `Invoke-WithCloudflareReleaseCredentials` 한 번 안에서 실행하고, 성공 시 `{ PreviousVersionId, WorkerVersionId, VerifiedAt }`만 반환해 `$workerEvidence`로 보존한다.

```powershell
function Read-ActiveWorkerVersion {
  $raw = (node $wranglerCli deployments list --name hyeni-calendar-api --json "--config=$wranglerConfig" 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Worker deployment 목록 조회 실패" }
  $deployments = @($raw | ConvertFrom-Json -ErrorAction Stop)
  if ($deployments.Count -lt 1) { throw "Worker deployment 목록이 비었습니다" }
  $latest = @($deployments | Sort-Object { [DateTimeOffset]::Parse([string]$_.created_on) })[-1]
  $fullTraffic = @($latest.versions | Where-Object { [double]$_.percentage -eq 100.0 })
  if ($fullTraffic.Count -ne 1) { throw "100% active Worker version이 정확히 하나가 아닙니다" }
  $versionId = [string]$fullTraffic[0].version_id
  if ($versionId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    throw "Worker version ID 형식이 잘못됐습니다"
  }
  return $versionId
}
```

Worker block은 `hyeni-worker-ai-voice-<32자리 GUID>` 임시 디렉터리를 별도로 만들고 그 안에서 목록 조회·deploy·readback·필요 시 rollback을 모두 수행한다. `finally`에서 `Remove-ExactReleaseTempDirectory`로 그 정확한 디렉터리만 정리한다. D1·Pages 작업 디렉터리를 재사용하지 않는다.

배포 명령 이후 어느 검증이든 세 번 연속 실패하면 현재 active version을 다시 조회한다. 이전 ID와 다르면 다음 명령으로 코드만 즉시 복구하고 health가 다시 정확히 ready인지 확인한다.

```powershell
node $wranglerCli rollback $previousWorkerVersionId --name hyeni-calendar-api "--config=$wranglerConfig" --message="AI 음성 답변 배포 검증 실패 자동 복구" --yes
if ($LASTEXITCODE -ne 0) { throw "Worker 자동 롤백 실패 — 즉시 운영 확인 필요" }
```

롤백 성공 여부와 무관하게 원래 실패를 보고하고 Pages·기기 단계로 넘어가지 않는다. D1·R2·KV·secret은 수정·롤백하지 않는다. 성공한 경우에만 `$workerVersionId`와 readback 시각을 기록한다.

- [ ] **Step 9: Pages를 exact SHA로 배포하고 deployment/canonical bytes를 교차 검증**

위 자격 증명 guard 안에서 `git -C $repoRoot status --porcelain`, `git -C $repoRoot rev-parse HEAD`, `git -C $repoRoot rev-parse origin/main`을 다시 읽어 clean 상태와 동일한 40자리 `$sourceCommit`을 재확인한다. 배포 전 `pages deployment list --project-name=hyeni-calendar --environment=production --json`의 첫 production 항목에서 `Id`·`Deployment`를 rollback 기준으로 기록한다. `.env`가 없는 새 임시 디렉터리에서 direct local Wrangler만 실행한다.

```powershell
$pagesEvidence = Invoke-WithCloudflareReleaseCredentials {
$dirty = git -C $repoRoot status --porcelain
$sourceCommit = (git -C $repoRoot rev-parse HEAD).Trim()
$remoteCommit = (git -C $repoRoot rev-parse origin/main).Trim()
if ($dirty -or $sourceCommit -cnotmatch '^[0-9a-f]{40}$' -or $sourceCommit -cne $remoteCommit) {
  throw "Pages 배포 source가 clean origin/main이 아닙니다"
}

$pagesOpsDir = Join-Path ([IO.Path]::GetTempPath()) ("hyeni-pages-ai-voice-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $pagesOpsDir | Out-Null
Push-Location -LiteralPath $pagesOpsDir
try {
  $beforeRaw = (node $wranglerCli pages deployment list --project-name=hyeni-calendar --environment=production --json 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "기존 Pages production 목록 조회 실패" }
  $beforePages = @($beforeRaw | ConvertFrom-Json -ErrorAction Stop)
  if ($beforePages.Count -lt 1) { throw "기존 Pages production deployment가 없습니다" }
  $previousPagesDeploymentId = [string]$beforePages[0].Id
  $previousPagesDeploymentUrl = [string]$beforePages[0].Deployment
  if ($previousPagesDeploymentId -notmatch '^[0-9a-fA-F-]{20,64}$' -or $previousPagesDeploymentUrl -notmatch '^https://') {
    throw "기존 Pages rollback 기준이 유효하지 않습니다"
  }

  $pagesDeployOutput = (node $wranglerCli pages deploy (Join-Path $repoRoot 'dist') --project-name=hyeni-calendar --branch=main "--commit-hash=$sourceCommit" --commit-message="AI 친구 음성 답변 $sourceCommit" --commit-dirty=false 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Pages production 배포 실패" }
  $deploymentUrlMatch = [Regex]::Match(
    $pagesDeployOutput,
    '(?:Take a peek over at|Visit your deployment at)\s+(https://[a-z0-9-]+\.hyeni-calendar\.pages\.dev)'
  )
  if (-not $deploymentUrlMatch.Success) { throw "Pages deployment URL을 확인하지 못했습니다" }
  $pagesDeploymentUrl = $deploymentUrlMatch.Groups[1].Value

  $afterRaw = (node $wranglerCli pages deployment list --project-name=hyeni-calendar --environment=production --json 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "신규 Pages production 목록 조회 실패" }
  $afterPages = @($afterRaw | ConvertFrom-Json -ErrorAction Stop)
  $newPages = @($afterPages | Where-Object { $_.Deployment -ceq $pagesDeploymentUrl })
  if ($newPages.Count -ne 1 -or $newPages[0].Environment -cne 'Production' -or $newPages[0].Source -cne $sourceCommit.Substring(0, 7)) {
    throw "신규 Pages deployment ID·환경·source 교차 확인 실패"
  }
  $pagesDeploymentId = [string]$newPages[0].Id
} finally {
  Pop-Location
  Remove-ExactReleaseTempDirectory $pagesOpsDir
}

[pscustomobject]@{
  PreviousDeploymentId = $previousPagesDeploymentId
  PreviousDeploymentUrl = $previousPagesDeploymentUrl
  DeploymentId = $pagesDeploymentId
  DeploymentUrl = $pagesDeploymentUrl
  SourceCommit = $sourceCommit
}
}
$previousPagesDeploymentId = $pagesEvidence.PreviousDeploymentId
$previousPagesDeploymentUrl = $pagesEvidence.PreviousDeploymentUrl
$pagesDeploymentId = $pagesEvidence.DeploymentId
$pagesDeploymentUrl = $pagesEvidence.DeploymentUrl
$sourceCommit = $pagesEvidence.SourceCommit
```

배포 뒤 같은 Pages 목록을 다시 읽고 `Deployment === $pagesDeploymentUrl`인 항목이 정확히 하나인지, 그 항목의 `Environment === "Production"`, `Source === $sourceCommit.Substring(0, 7)`인지 확인해 `Id`를 기록한다. 현재 local Wrangler의 JSON 목록은 full SHA가 아니라 7자리 `Source`를 반환하므로 full SHA는 실제 deploy 인자와 clean local/remote SHA에서, 목록은 URL·ID·7자리 source에서 각각 교차 확인한다. 이어서 redirect를 자동 추적하지 않고 raw bytes를 받는 `.NET HttpClient` 검증 함수를 사용해 다음을 확인한다.

- 대상 origin 두 개: `$pagesDeploymentUrl`, `https://hyeni-calendar.pages.dev`
- `dist/index.html`과 각 origin `/`의 SHA-256 및 byte length가 정확히 같음
- local `index.html`이 참조한 `/assets/*.js`, `/assets/*.css` 전부가 각 origin의 동일 path와 byte-for-byte 일치하며 entry JS가 최소 1개 존재함
- `manifest.webmanifest`, `sw.js`, `.well-known/assetlinks.json`이 두 origin 모두 HTTPS 200이고 local `dist`와 byte-for-byte 일치함
- root 응답의 `Content-Security-Policy`가 존재하고 `default-src 'self'`를 포함함
- `Strict-Transport-Security`가 존재하며 `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`가 정확함

deployment URL은 즉시 통과해야 하고 canonical은 `Cache-Control: no-cache`와 `$sourceCommit` query를 붙여 최대 60초만 재시도한다. 단순 200만으로 성공 처리하지 않는다. byte·header·commit 검증이 끝까지 실패하면 새 APK를 설치하지 않고, 미리 기록한 이전 production deployment ID로 Cloudflare Dashboard rollback이 필요하다고 즉시 보고한다. 확인되지 않은 과거 `dist`를 다시 업로드하거나 deployment를 삭제하지 않는다.

- [ ] **Step 10: razr만 serial-scoped CDP로 전후 역할을 확인하고 `install -r` 뒤 native TTS를 검증**

전역 `adb devices`와 `chrome://inspect/#devices`를 사용하지 않는다. 다음 helper는 razr PID에 해당하는 WebView socket만 localhost 9224로 forward하며 `finally`에서 그 forward만 제거한다.

```powershell
$repoRoot = 'C:\Users\TK\Desktop\hyeni-3'
$nativeTtsProbe = Join-Path $repoRoot 'scripts/verify-native-tts-cdp.ps1'
$debugApk = Join-Path $repoRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
foreach ($requiredPath in @($nativeTtsProbe, $debugApk)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) { throw "razr 검증 파일 누락" }
}

function Invoke-RazrCdpProbe([ValidateSet('Identity','Tts')][string]$Mode) {
  adb -s ZY22H9VTQD shell am start -n com.hyeni.calendar/.MainActivity | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "razr 앱 시작 실패" }
  $pidText = (adb -s ZY22H9VTQD shell pidof com.hyeni.calendar | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $pidText -notmatch '^\d+$') { throw "razr WebView PID 확인 실패" }
  adb -s ZY22H9VTQD forward --no-rebind tcp:9224 "localabstract:webview_devtools_remote_$pidText" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "razr CDP forward 실패" }
  try {
    $probeJson = (powershell.exe -NoProfile -ExecutionPolicy Bypass -File $nativeTtsProbe -Port 9224 -Mode $Mode | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "razr CDP $Mode probe 실패" }
    return $probeJson | ConvertFrom-Json -ErrorAction Stop
  } finally {
    adb -s ZY22H9VTQD forward --remove tcp:9224 | Out-Null
  }
}

$razrState = (adb -s ZY22H9VTQD get-state | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $razrState -cne 'device') { throw "허용된 razr가 연결되지 않았습니다" }
$beforeInstall = Invoke-RazrCdpProbe -Mode Identity

adb -s ZY22H9VTQD install -r $debugApk
if ($LASTEXITCODE -ne 0) { throw "razr 세션 보존 설치 실패" }
$afterInstall = Invoke-RazrCdpProbe -Mode Tts

foreach ($projection in @($beforeInstall, $afterInstall)) {
  if ($projection.role -cne 'child' -or
      $projection.hasFamilyId -ne $true -or
      $projection.familyScopesMatch -ne $true -or
      $projection.rootVisible -ne $true) {
    throw "razr 역할·가족 scope projection 불변식 실패"
  }
}
foreach ($field in @('role', 'hasFamilyId', 'familyScopesMatch', 'rootVisible')) {
  if ($beforeInstall.$field -cne $afterInstall.$field) {
    throw "razr install -r 전후 projection 불일치: $field"
  }
}
```

전후 projection은 `role === "child"`, `hasFamilyId === true`, `familyScopesMatch === true`, `rootVisible === true`여야 하고 네 값이 동일해야 한다. raw session·access/refresh token·family ID는 WebView 밖으로 가져오지 않는다. post-install probe는 짧은 문장이 끝까지 들리고 긴 문장이 700ms 뒤 멈추는지를 사용자에게 확인받아 automatic enum과 별도 기록한다. 운영 마이크→AI 왕복은 대화 행·크레딧 보호를 위해 실행하지 않는다.

razr가 연결되지 않았으면 설치·가청 검증만 미완료로 기록하고 A17이나 S25로 대체하지 않는다. 로그아웃·역할 전환·재페어링·앱 데이터 삭제·refresh token 조회/회전은 하지 않는다.

- [ ] **Step 11: 배포 증거와 남은 한계를 CLAUDE에 기록**

`CLAUDE.md`의 음성 turn 항목 또는 최신 배포 상태에 다음 실제 결과만 기록한다.

- 앱/Worker/Android 테스트 통과 수와 실행 명령
- D1 read-only aggregate gate 통과와 migration 미실행
- Worker version ID, health·privacy·terms readback 시각
- Pages source commit, deployment ID·URL, deployment/canonical byte·header 검증
- razr `install -r` 성공 여부, 전후 child projection 일치, automatic TTS start/stop과 사용자 가청 확인을 구분한 결과
- 운영 AI 음성 왕복은 크레딧·대화 행 보호를 위해 미실행했다는 사실
- 소스가 최신 Play 후보보다 새로워 기존 서명 AAB는 stale이며, 다음 제출 전 사용자가 비밀번호를 입력해 새 AAB 서명·hash·mtime을 확인해야 한다는 사실

그 뒤 커밋·push한다.

```powershell
git add CLAUDE.md
git commit -m "AI 음성 답변 배포 검증 결과를 기록한다"
git push origin main
if ($LASTEXITCODE -ne 0) { throw "배포 증거 push 실패" }
if (git status --porcelain) { throw "최종 worktree가 clean하지 않습니다" }
```

Expected: 최종 worktree clean. 자격 증명 값을 읽어 출력하거나 서명 자격 파일을 열지 않고, 기존 AAB를 최신 후보로 표시하지 않는다.
