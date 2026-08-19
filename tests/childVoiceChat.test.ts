// 아이 AI 친구 음성 대화 회귀(2026-08-17 TK 지시).
//
// 아이는 타자보다 말이 빠르다. 마이크로 말을 걸고 답을 귀로 들을 수 있어야
// "쓰는 앱"이 아니라 "친구와 이야기하는" 경험이 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estimateSpeechDurationMs,
  readChildVoiceReplyEnabled,
  shouldSpeakAiReply,
  SPEECH_LOCALE,
  speakableReplyText,
  type AiChatTurnSource,
  writeChildVoiceReplyEnabled,
} from "../src/transform/childVoiceChat.ts";
import { normalizeSpeechRms } from "../src/transform/childVoiceWave.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"] as const;
const IDS = [
  "child.aiChat.voice.startAria",
  "child.aiChat.voice.stopAria",
  "child.aiChat.voice.listening",
  "child.aiChat.voice.stop",
  "child.aiChat.voice.empty",
  "child.aiChat.voice.failed",
  "child.aiChat.voice.unsupported",
  "child.aiChat.voice.replyOnAria",
  "child.aiChat.voice.replyOffAria",
] as const;
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

test("네이티브 speak/stopSpeak 가 JS 로 노출되고 웹 폴백이 있다", () => {
  const speech = read("src/lib/native/speech.ts");
  assert.match(speech, /export async function speakText/);
  assert.match(speech, /export function stopSpeaking/);
  assert.match(speech, /export function isSpeechPlaybackSupported/);
  // 네이티브 우선 → 웹 speechSynthesis 폴백(추가 의존성 없이).
  assert.match(speech, /plugin\?\.speak/);
  assert.match(speech, /speechSynthesis/);
  assert.match(speech, /speak\(opts:\s*\{\s*text:\s*string;\s*language\?:\s*string;\s*rate\?:\s*number/);
  assert.match(speech, /plugin\.speak\(\{\s*text:\s*spoken,\s*language,\s*rate\s*\}\)/);
  assert.match(speech, /result\?\.started === true/);
  assert.match(speech, /const generation = \+\+speechPlaybackGeneration/);
  assert.match(speech, /generation !== speechPlaybackGeneration/);
  assert.match(speech, /export function stopSpeaking\(\): void \{\s*speechPlaybackGeneration \+= 1;/);
  // 네이티브 플러그인에 실제 메서드가 있어야 브리지가 의미를 갖는다.
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java");
  assert.match(plugin, /public void speak\(PluginCall call\)/);
  assert.match(plugin, /public void stopSpeak\(PluginCall call\)/);
  assert.match(plugin, /SpeechPlaybackGeneration ttsGeneration/);
  assert.match(plugin, /ttsGeneration\.next\(\)/);
  assert.match(plugin, /ttsGeneration\.cancel\(\)/);
  assert.match(plugin, /ttsGeneration\.isCurrent\(/);
  assert.match(plugin, /SpeechLocalePolicy\.apply\(/);
  assert.match(plugin, /onStart\(String id\) \{\s*handleTtsStarted\(id\);/);
  assert.doesNotMatch(plugin, /Locale\.KOREAN/);
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.intent\.action\.TTS_SERVICE/);
});

test("새 읽어주기는 이전 웹 음성을 끊고 native 실패도 중단한 뒤 폴백한다", () => {
  const speech = read("src/lib/native/speech.ts");
  const speakStart = speech.indexOf("export async function speakText");
  const stopStart = speech.indexOf("export function stopSpeaking", speakStart);
  assert.ok(speakStart >= 0 && stopStart > speakStart);
  const speak = speech.slice(speakStart, stopStart);

  const cancelAtStart = speak.indexOf("webSpeechSynthesis()?.cancel()");
  const nativeSpeak = speak.indexOf("await plugin.speak");
  assert.ok(cancelAtStart >= 0 && cancelAtStart < nativeSpeak);
  assert.match(speech, /async function stopNativePlaybackBeforeFallback/);
  assert.match(speech, /await plugin\.stopSpeak\(\);[\s\S]*generation === speechPlaybackGeneration/);
  assert.match(
    speak,
    /await stopNativePlaybackBeforeFallback\(fallbackPlugin, generation\);\s*if \(generation !== speechPlaybackGeneration/,
  );
});

test("Android TTS lifecycle은 실패 엔진과 늦은 초기화 callback을 닫는다", () => {
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java");
  assert.match(plugin, /private volatile boolean destroyed = false;/);
  assert.match(plugin, /private void disposeTextToSpeech\(\)/);

  const disposeStart = plugin.indexOf("private void disposeTextToSpeech()");
  const nextMethod = plugin.indexOf("\n    private ", disposeStart + 1);
  assert.ok(disposeStart >= 0 && nextMethod > disposeStart);
  const dispose = plugin.slice(disposeStart, nextMethod);
  assert.match(dispose, /textToSpeech = null;/);
  assert.match(dispose, /ttsReady = false;/);
  assert.match(dispose, /\.stop\(\);/);
  assert.match(dispose, /\.shutdown\(\);/);

  assert.match(
    plugin,
    /status -> \{\s*if \(destroyed\) \{\s*return;\s*\}[\s\S]*?getActivity\(\)[\s\S]*?runOnUiThread\(\(\) -> \{\s*if \(destroyed\) \{\s*return;/,
  );
  assert.match(
    plugin,
    /status != TextToSpeech\.SUCCESS[\s\S]*?disposeTextToSpeech\(\);/,
  );
  assert.match(
    plugin,
    /protected void handleOnDestroy\(\) \{\s*destroyed = true;[\s\S]*?ttsGeneration\.cancel\(\);[\s\S]*?pendingTtsRequest = null;[\s\S]*?ttsInitializing = false;[\s\S]*?disposeTextToSpeech\(\);/,
  );
  assert.match(
    plugin,
    /public void speak\(PluginCall call\)[\s\S]*?Activity activity = getActivity\(\);[\s\S]*?if \(destroyed \|\| activity == null\)[\s\S]*?resolveNotStarted\(call\);[\s\S]*?activity\.runOnUiThread\(\(\) -> \{\s*if \(destroyed\)/,
  );
  assert.match(
    plugin,
    /private void startUtterance\(PendingTtsRequest request\) \{[\s\S]*?try \{\s*if \(destroyed \|\| !ttsGeneration\.isCurrent/,
  );
});

test("Android TTS는 큐 접수와 실제 발화 시작을 구분한다", () => {
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java");

  assert.match(plugin, /TTS_START_TIMEOUT_MS\s*=\s*10_000L/);
  assert.match(plugin, /hyeni-tts-" \+ request\.generation/);
  assert.match(plugin, /onStart\(String id\) \{\s*handleTtsStarted\(id\);/);
  assert.match(
    plugin,
    /private void handleTtsStarted\(String utteranceId\)[\s\S]*?notifyTtsState\("started", utteranceId\);[\s\S]*?resolvePendingTtsStart\(true\);/,
  );
  assert.match(plugin, /postDelayed\(scheduled\.timeout, TTS_START_TIMEOUT_MS\)/);
  assert.match(plugin, /onError\(String id, int errorCode\)[\s\S]*?handleTtsTerminalState\("error", id\)/);
  assert.match(plugin, /onStop\(String id, boolean interrupted\)[\s\S]*?handleTtsTerminalState\("stopped", id\)/);
  assert.match(plugin, /if \(destroyed\) \{\s*return;\s*\}[\s\S]*?activeTtsUtteranceId = utteranceId;/);
  assert.match(plugin, /activeTtsUtteranceId == null[\s\S]*?!activeTtsUtteranceId\.equals\(utteranceId\)[\s\S]*?return;/);

  const queueAccepted = plugin.slice(
    plugin.indexOf("if (result == TextToSpeech.SUCCESS)"),
    plugin.indexOf("} else {", plugin.indexOf("if (result == TextToSpeech.SUCCESS)")),
  );
  assert.doesNotMatch(queueAccepted, /request\.call\.resolve|put\("started", true\)/);
});

test("말한 내용은 확인 단계 없이 바로 보낸다(받아쓰기가 아니라 대화)", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /const transcript = await captureSpeech|captureSpeech\(speechLang\)/);
  assert.match(chat, /send\(spoken, "voice"\)/);
  // 듣기 시작 전에 읽어주기를 멈춰야 아이 차례에 친구가 겹쳐 말하지 않는다.
  assert.match(chat, /stopSpeaking\(\);[\s\S]{0,140}const gen = \+\+voiceGenRef\.current;/);
});

test("화면을 떠나면 듣기와 읽어주기를 반드시 멈춘다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /useEffect\(\(\) => \(\) => \{[\s\S]*cancelSpeechCapture\(\);[\s\S]*stopSpeaking\(\);/);
});

test("읽어주기는 기본 꺼짐이고 아이별로 저장된다", () => {
  const store: Record<string, string> = {};
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    },
  };
  // 교실·도서관에서 아이 동의 없이 소리가 나면 안 되므로 기본은 꺼짐이다.
  assert.equal(readChildVoiceReplyEnabled("fam", "kid"), false);
  writeChildVoiceReplyEnabled("fam", "kid", true);
  assert.equal(readChildVoiceReplyEnabled("fam", "kid"), true);
  // 다른 아이의 설정을 넘겨받지 않는다.
  assert.equal(readChildVoiceReplyEnabled("fam", "kid2"), false);
  delete (globalThis as { window?: unknown }).window;
});

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
  // 읽어주기 시작과 파형 표시를 한 곳에서 맞춘다(둘이 갈라지면 말하는데 파형이 안 움직인다).
  assert.match(onSuccess, /speakReply\(spokenReply\);/);
  assert.match(chat, /const speakReply = \(text: string\) => \{[\s\S]{0,600}speakText\(text, speechLang\)/);
});

test("읽어줄 때 화면 마커는 소리로 읽지 않는다", () => {
  // "[[img:...]]" 를 그대로 읽으면 "대괄호 아이엠지 콜론..."처럼 들린다.
  assert.equal(speakableReplyText("사진 보냈어 [[img:abc/def.jpg]] 어때?"), "사진 보냈어 어때?");
  // 위치는 좌표가 아니라 사람이 읽는 주소만 남긴다.
  assert.equal(speakableReplyText("여기야 [[loc:37.1,127.2|동탄대로 683]]"), "여기야 동탄대로 683");
  assert.equal(speakableReplyText("[[loc:37.1,127.2]] 여기"), "여기");
  assert.equal(speakableReplyText("그냥 말"), "그냥 말");
  assert.equal(speakableReplyText(""), "");
});

test("음성 언어는 10개 locale 을 모두 덮는다", () => {
  for (const locale of LOCALES) {
    assert.match(SPEECH_LOCALE[locale], /^[a-z]{2,3}-[A-Za-z]{2,4}$/, `${locale} 언어 태그 없음`);
  }
  // AiSchedule 의 표와 어긋나면 같은 앱에서 언어가 갈린다.
  const aiSchedule = read("src/screens/feature/AiSchedule.tsx");
  for (const locale of LOCALES) {
    assert.ok(aiSchedule.includes(SPEECH_LOCALE[locale]), `${locale} 태그가 AiSchedule 과 다르다`);
  }
});

test("음성 문구는 10개 locale 에 모두 있고 아이 말투를 지킨다", () => {
  for (const locale of LOCALES) {
    const catalog = JSON.parse(read(`locales/${locale}/child.json`)) as Record<string, string>;
    for (const id of IDS) {
      assert.ok((catalog[id] ?? "").trim().length > 0, `${locale}:${id} 누락`);
    }
  }
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
  const ko = JSON.parse(read("locales/ko/child.json")) as Record<string, string>;
  for (const id of IDS) {
    assert.doesNotMatch(ko[id], /습니다|하세요/, `${id} 가 존댓말이다`);
  }
});


// ── 말로 이야기하는 동안의 화면(2026-08-19 TK 지시) ────────────────────────
// "음성으로 할 때에는 굳이 텍스트를 아이가 보지 않아도 되니 말하는 이미지(음성 파형)가
//  움직여도 좋을 것 같아요" — 그래서 듣는 중·말하는 중을 얼굴과 파형으로 보여 준다.

test("파형은 아이 목소리 크기를 실제로 받아서 움직인다", () => {
  // Android SpeechRecognizer 의 RMS(dB) → 0~1. 지어낸 값이 아니라 실제 입력이다.
  assert.equal(normalizeSpeechRms(-2), 0);
  assert.equal(normalizeSpeechRms(10), 1);
  assert.ok(normalizeSpeechRms(4) > 0.4 && normalizeSpeechRms(4) < 0.6);
  // 범위를 벗어난 값도 화면을 깨뜨리지 않는다.
  assert.equal(normalizeSpeechRms(-40), 0);
  assert.equal(normalizeSpeechRms(120), 1);
  // Number(null) === 0 함정 — 숫자가 아니면 조용함(0)으로 좁힌다.
  assert.equal(normalizeSpeechRms(null), 0);
  assert.equal(normalizeSpeechRms("6"), 0);
  assert.equal(normalizeSpeechRms(Number.NaN), 0);

  const plugin = read("android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java");
  // 예전에는 onRmsChanged 가 비어 있어 화면이 실제 목소리를 알 방법이 없었다.
  assert.match(plugin, /onRmsChanged\(float rmsdB\) \{[\s\S]{0,220}notifySpeechRms\(rmsdB\)/);
  assert.match(plugin, /notifyListeners\("speechRms", data\)/);
  // 음성 자체는 보내지 않는다 — 크기 하나뿐이다.
  assert.match(plugin, /data\.put\("rms", rmsdB\)/);
  assert.doesNotMatch(plugin, /notifyListeners\("speechRms"[\s\S]{0,80}buffer/);
});

test("친구가 말하는 중인지 알 수 있고, 신호가 없어도 파형이 영영 움직이지 않는다", () => {
  const speech = read("src/lib/native/speech.ts");
  // 네이티브 ttsState 와 웹 SpeechSynthesis 양쪽에서 시작·종료를 받는다.
  assert.match(speech, /plugin\.addListener\("ttsState"/);
  assert.match(speech, /utterance\.onstart = \(\) => emitPlayback\("started"\)/);
  assert.match(speech, /utterance\.onend = \(\) => emitPlayback\("done"\)/);
  assert.match(speech, /export function onSpeechPlaybackState/);
  // 웹에는 stopped 이벤트가 없어 중단 시 직접 알린다.
  assert.match(speech, /export function stopSpeaking\(\): void \{[\s\S]{0,200}emitPlayback\("stopped"\)/);

  // 종료 신호를 못 주는 기기용 상한 — 길이에 비례하되 무한정 기다리지 않는다.
  assert.equal(estimateSpeechDurationMs(""), 0);
  assert.equal(estimateSpeechDurationMs(null), 0);
  assert.ok(estimateSpeechDurationMs("응") >= 1_500);
  assert.ok(estimateSpeechDurationMs("가".repeat(40)) > estimateSpeechDurationMs("가".repeat(10)));
  assert.equal(estimateSpeechDurationMs("가".repeat(5_000)), 45_000, "상한이 있어야 한다");

  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /speakingTimerRef\.current = setTimeout\([\s\S]{0,160}estimateSpeechDurationMs\(text\)\)/);
  // 합성이 시작조차 안 됐으면 말하는 척하지 않는다.
  assert.match(chat, /if \(started\) return;[\s\S]{0,80}setSpeaking\(false\)/);
});

test("말하는 동안에는 글 대신 얼굴과 파형을 보여 주고, 원하면 글로 볼 수 있다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  const css = read("src/screens/child/AiFriendChat.css");
  // 듣는 중·말하는 중 모두 같은 화면을 쓴다.
  assert.match(chat, /const voiceActive = listening \|\| speaking;/);
  assert.match(chat, /\{voiceActive && !voiceTextMode \? \(/);
  assert.match(chat, /data-mode=\{listening \? "listening" : "speaking"\}/);
  assert.match(chat, /AI_BUDDY_LISTENING_FACE : AI_BUDDY_SPEAKING_FACE/);
  // 아이가 글을 보고 싶으면 접을 수 있고, 마이크를 다시 켜면 되돌아온다.
  assert.match(chat, /onClick=\{\(\) => setVoiceTextMode\(true\)\}/);
  assert.match(chat, /setVoiceTextMode\(false\);\n    const gen = \+\+voiceGenRef\.current/);
  // 접었을 때만 아래 한 줄 표시가 나온다(움직이는 표시자는 화면에 하나).
  assert.match(chat, /\{listening && voiceTextMode && \(/);
  // 실제 목소리 크기는 리렌더 없이 CSS 변수로만 흘린다(초당 10회 리렌더 방지).
  assert.match(chat, /stage\.style\.setProperty\("--voice-level"/);
  assert.match(chat, /stage\.dataset\.level = "live"/);
  // 값을 못 받는 기기에서는 기본 파형으로 강등한다.
  assert.match(css, /\.afc-voice__wave span \{[^}]*animation: afc-voice-bar/);
  assert.match(css, /\.afc-voice\[data-level="live"\] \.afc-voice__wave span \{[^}]*animation: none/);
  // 그만 누르면 듣기·읽어주기를 함께 멈춘다.
  assert.match(chat, /const stopVoiceStage = \(\) => \{[\s\S]{0,160}stopSpeaking\(\);/);
});

test("파형 화면 문구는 10개 locale 에 모두 있고 아이 말투를 지킨다", () => {
  for (const locale of LOCALES) {
    const catalog = JSON.parse(read("locales/" + locale + "/child.json"));
    for (const id of ["child.aiChat.voice.speaking", "child.aiChat.voice.showText"]) {
      assert.ok(typeof catalog[id] === "string" && catalog[id].trim(), locale + " " + id);
    }
  }
  const ko = JSON.parse(read("locales/ko/child.json"));
  assert.doesNotMatch(ko["child.aiChat.voice.speaking"], /(?:요|습니다|세요)/);
  assert.doesNotMatch(ko["child.aiChat.voice.showText"], /(?:요|습니다|세요)/);
});
