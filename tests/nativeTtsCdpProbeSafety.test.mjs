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

test("네이티브 TTS CDP 확인은 성공 상태만 출력하고 명령 전체 deadline을 둔다", () => {
  const probe = read("scripts/verify-native-tts-cdp.ps1");

  assert.match(probe, /\$commandDeadline\s*=\s*\[DateTime\]::UtcNow\.AddSeconds\(/);
  assert.match(probe, /\[DateTime\]::UtcNow\s*-ge\s*\$commandDeadline[\s\S]*?throw/);
  assert.match(probe, /\$shortState\s+-ne\s+"started"[\s\S]*?throw/);
  assert.match(probe, /\$longState\s+-ne\s+"started"[\s\S]*?throw/);
  assert.match(probe, /\$stopState\s+-ne\s+"stopped"[\s\S]*?throw/);

  const longWait = probe.indexOf('$longState = Wait-CdpProbeState -Socket $socket -Name "long"');
  const stopDelay = probe.indexOf("Start-Sleep -Milliseconds 700", longWait);
  const stopCall = probe.indexOf("Promise.resolve(SpeechRecognition.stopSpeak())", stopDelay);
  assert.ok(longWait >= 0 && stopDelay > longWait && stopCall > stopDelay);

  const failClosed = probe.indexOf('$stopState -ne "stopped"');
  const successJson = probe.indexOf("shortPlayback = $shortState", failClosed);
  assert.ok(failClosed >= 0 && successJson > failClosed);
});
