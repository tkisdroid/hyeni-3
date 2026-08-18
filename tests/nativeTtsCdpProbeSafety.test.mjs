import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("네이티브 TTS CDP 확인은 localhost와 비식별 projection만 사용한다", () => {
  const probe = read("scripts/verify-native-tts-cdp.ps1");

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
});
