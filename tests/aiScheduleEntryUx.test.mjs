/**
 * AI 일정 추가 진입 UX 가드 (2026-07-14 TK 제보).
 *
 * ① 부모 홈 "AI로 일정 추가"의 음성/텍스트/알림장 버튼은 해당 탭으로 직접 진입해야 한다.
 * ② 화면 전환 직후 고스트 클릭이 마이크를 자동 시작시키지 않아야 한다(진입 무장 지연).
 * ③ 듣는 중 탭 전환은 즉시 동작해야 하고, 취소된 인식의 결과·토스트는 무시한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (p) => readFileSync(resolve(rootDir, p), "utf8");

test("부모 홈 AI 버튼 3개는 탭 파라미터로 해당 기능에 직접 진입한다", () => {
  const home = readSource("src/screens/parent/ParentHome.tsx");
  assert.match(home, /navigate\("\/ai-schedule\?tab=voice"\)/);
  assert.match(home, /navigate\("\/ai-schedule\?tab=text"\)/);
  assert.match(home, /navigate\("\/ai-schedule\?tab=image"\)/);
});

test("AiSchedule 은 ?tab= 파라미터로 초기 탭을 정한다 (유효값만)", () => {
  const ais = readSource("src/screens/feature/AiSchedule.tsx");
  assert.match(ais, /useSearchParams/);
  assert.match(ais, /requestedTab === "text" \|\| requestedTab === "image" \|\| requestedTab === "voice"/);
});

test("마이크는 진입 직후 자동 시작되지 않는다 (고스트 클릭 무장 지연 + 시작 가드)", () => {
  const ais = readSource("src/screens/feature/AiSchedule.tsx");
  assert.match(ais, /micArmedRef\.current = true;\s*\}, 700\)/);
  assert.match(ais, /if \(!micArmedRef\.current \|\| listening \|\| parseM\.isPending\) return;/);
  // 마운트 시 captureSpeech/startVoice 자동 호출 금지 — 클릭 핸들러에서만 시작.
  assert.doesNotMatch(ais, /useEffect\([^)]*startVoice/s);
});

test("듣는 중 탭 전환은 인식을 취소하고, 취소된 인식은 결과·토스트를 남기지 않는다", () => {
  const ais = readSource("src/screens/feature/AiSchedule.tsx");
  assert.match(ais, /const switchTab = \(key: TabKey\)/);
  assert.match(ais, /onClick=\{\(\) => switchTab\(t\.key\)\}/);
  assert.match(ais, /voiceGenRef\.current \+= 1;\s*cancelSpeechCapture\(\);\s*setListening\(false\);/);
  assert.match(ais, /if \(gen !== voiceGenRef\.current\) return;/);
  // 화면 이탈 시에도 인식을 정리한다.
  assert.match(ais, /return \(\) => \{[^}]*cancelSpeechCapture\(\);/s);

  const speech = readSource("src/lib/native/speech.ts");
  assert.match(speech, /export function cancelSpeechCapture/);
});
