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
  assert.match(
    probe,
    /text:\s*"AI \\uce5c\\uad6c \\uc74c\\uc131 \\ub2f5\\ubcc0 \\ud655\\uc778\\uc774\\uc57c\."/,
  );
  const ttsTextLiterals = [...probe.matchAll(/text:\s*"([^"\r\n]*)"/g)].map((match) => match[1]);
  assert.equal(ttsTextLiterals.length, 2);
  for (const text of ttsTextLiterals) assert.doesNotMatch(text, /[^\x00-\x7f]/);
  assert.match(probe, /window\.speechSynthesis\?\.cancel\(\)/);
  assert.match(probe, /\[switch\]\$ShortOnly/);
  assert.match(probe, /SpeechRecognition\.stopSpeak/);
  assert.match(probe, /SpeechRecognition\.addListener\("ttsState"/);
  assert.match(probe, /result\?\.started !== true/);
  assert.match(probe, /\["started",\s*"done",\s*"error",\s*"stopped"\]/);
  assert.match(probe, /normalized === "stopped" && probe\.stopRequested[\s\S]*?probe\.stop = "stopped"/);
  assert.match(
    probe,
    /\$targetPayload\s*=\s*Invoke-RestMethod[\s\S]*?foreach\s*\(\$target\s+in\s+\[object\[\]\]\$targetPayload\)/,
  );
  assert.doesNotMatch(probe, /Invoke-RestMethod[\s\S]{0,160}?\|\s*Where-Object/);
  assert.match(probe, /\[Uri\]::TryCreate/);
  assert.match(probe, /\$targetUrl\.Host\s+-eq\s+"localhost"/);
  assert.match(probe, /\$targets\.Count\s+-ne\s+1/);
  assert.doesNotMatch(probe, /\badb\b|refresh|Authorization|Bearer/);
  assert.doesNotMatch(probe, /https?:\/\/(?!127\.0\.0\.1)/);
});

test("네이티브 TTS CDP 확인은 성공 상태만 출력하고 명령 전체 deadline을 둔다", () => {
  const probe = read("scripts/verify-native-tts-cdp.ps1");

  assert.match(probe, /\$commandDeadline\s*=\s*\[DateTime\]::UtcNow\.AddSeconds\(/);
  assert.match(probe, /\[DateTime\]::UtcNow\s*-ge\s*\$commandDeadline[\s\S]*?throw/);
  assert.match(probe, /\[void\]\$Task\.GetAwaiter\(\)\.GetResult\(\)/);
  assert.match(probe, /\$responseItems\.Count\s+-ne\s+1[\s\S]*?throw/);
  assert.match(probe, /\$state\s+-eq\s+"failed"[\s\S]*?throw/);
  assert.match(probe, /-Name\s+"short"[\s\S]*?-ExpectedState\s+"done"/);
  assert.match(probe, /-Name\s+"long"[\s\S]*?-ExpectedState\s+"started"/);
  assert.match(probe, /-Name\s+"long"[\s\S]*?-TimeoutSeconds\s+15/);
  assert.match(probe, /-Name\s+"stop"[\s\S]*?-ExpectedState\s+"stopped"/);
  assert.match(probe, /shortCompletion\s*=\s*\$shortState/);
  assert.match(probe, /probe\.cancelled = true/);
  assert.match(probe, /-AwaitPromise\s+\$true/);
  assert.match(probe, /Promise\.allSettled\(cleanup\)/);

  const shortDoneWait = probe.indexOf('$shortState = Wait-CdpProbeState');
  const longSpeak = probe.indexOf("SpeechRecognition.speak", shortDoneWait);
  const longWait = probe.indexOf('$longState = Wait-CdpProbeState', longSpeak);
  const stopDelay = probe.indexOf("Start-Sleep -Milliseconds 700", longWait);
  const stopCall = probe.indexOf("Promise.resolve(SpeechRecognition.stopSpeak())", stopDelay);
  const stopRequested = probe.lastIndexOf('stop = "requested"', stopCall);
  const stopRequestedFlag = probe.lastIndexOf("stopRequested = true", stopCall);
  const stopEvent = probe.indexOf('probe.stop = "stopped"');
  assert.ok(
    shortDoneWait >= 0 &&
      longSpeak > shortDoneWait &&
      longWait > longSpeak &&
      stopDelay > longWait &&
      stopRequestedFlag > stopDelay &&
      stopRequested > stopRequestedFlag &&
      stopCall > stopRequested &&
      stopEvent >= 0,
  );

  const failClosed = probe.indexOf('-ExpectedState "stopped"');
  const successJson = probe.indexOf('shortPlayback = "started"', failClosed);
  assert.ok(failClosed >= 0 && successJson > failClosed);
});
