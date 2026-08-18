// 아이 AI 친구 음성 대화 회귀(2026-08-17 TK 지시).
//
// 아이는 타자보다 말이 빠르다. 마이크로 말을 걸고 답을 귀로 들을 수 있어야
// "쓰는 앱"이 아니라 "친구와 이야기하는" 경험이 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readChildVoiceReplyEnabled,
  shouldSpeakAiReply,
  SPEECH_LOCALE,
  speakableReplyText,
  type AiChatTurnSource,
  writeChildVoiceReplyEnabled,
} from "../src/transform/childVoiceChat.ts";

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
  // 네이티브 플러그인에 실제 메서드가 있어야 브리지가 의미를 갖는다.
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/SpeechPlugin.java");
  assert.match(plugin, /public void speak\(PluginCall call\)/);
  assert.match(plugin, /public void stopSpeak\(PluginCall call\)/);
});

test("말한 내용은 확인 단계 없이 바로 보낸다(받아쓰기가 아니라 대화)", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /const transcript = await captureSpeech|captureSpeech\(speechLang\)/);
  assert.match(chat, /send\(spoken, "voice"\)/);
  // 듣기 시작 전에 읽어주기를 멈춰야 아이 차례에 친구가 겹쳐 말하지 않는다.
  assert.match(chat, /stopSpeaking\(\);\s*\n\s*const gen = \+\+voiceGenRef\.current;/);
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
  assert.match(onSuccess, /speakText\(spokenReply, speechLang\)/);
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
