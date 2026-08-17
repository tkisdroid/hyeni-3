import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const koChild = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/child.json"), "utf8"));

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("SOS 는 3초 홀드 안내를 반말로 명확히 말한다(시안 2a)", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /id: "child\.sos\.mainTitle"/);
  assert.match(childSos, /id="child\.sos\.mainDescription"/);
  assert.match(childSos, /id: progress > 0 \? "child\.sos\.keepHolding" : "child\.sos\.hintHold"/);
  // 2026-08-17 TK 지시: "도와 줘!"는 아이가 비명 지르는 말투다.
  // 실제로 하는 일(부모에게 도움 요청)을 반말로 말한다.
  assert.equal(koChild["child.sos.mainTitle"], "부모님께 도움을 요청할게");
  assert.doesNotMatch(koChild["child.sos.mainTitle"], /도와 ?줘/);
  assert.match(koChild["child.sos.mainDescription"], /<strong>3초<\/strong>.*<strong>내 위치<\/strong>/);
  assert.equal(koChild["child.sos.hintHold"], "3초 꾹");
  assert.doesNotMatch(koChild["child.sos.mainDescription"], /알려요|놀라요|갈래요/);
  assert.doesNotMatch(childSos, /i18n 안전 문구 불변식/);
});

test("SOS 발사 계약은 그대로다 — 3초 홀드 · 세션당 1회 · alertSent 확인", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /const HOLD_MS = 3000/);
  assert.match(childSos, /sentRef\.current = true/);
  assert.match(childSos, /result\.alertSent \? "sent" : "error"/);
  // 위치는 홀드 시작 때 읽고, 실패해도 알림은 나간다.
  assert.match(childSos, /acquirePosition\(\)/);
});

test("서버 접수 성공을 보호자 기기 표시 완료로 단정하지 않는다", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /id: "child\.sos\.accepted"/);
  assert.match(childSos, /id: "child\.sos\.acceptedDescription"/);
  assert.match(childSos, /id: "child\.sos\.notificationStarted"/);
  assert.equal(koChild["child.sos.accepted"], "SOS를 접수했어!");
  assert.match(koChild["child.sos.acceptedDescription"], /전송을 시작했어/);
  assert.equal(koChild["child.sos.notificationStarted"], "보호자에게 알림 전송을 시작했어");
  assert.doesNotMatch(
    Object.values(koChild).filter((value) => typeof value === "string").join("\n"),
    /보호자 모두에게 알림이 갔어|위치는 못 찾았지만 알림은 갔어|에게 알렸어!/,
  );
});

test("부모 홈에는 '꾹' 스티커 UI 를 되살리지 않는다(2026-07-09 TK 결정)", () => {
  const parentHome = readSource("src/screens/parent/ParentHome.tsx");
  assert.doesNotMatch(parentHome, /꾹/);
});

test("아이 SOS 3초 누르기는 포인터를 캡처해 미세 이동으로 중단되지 않는다", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");
  const holdButtonStart = childSos.indexOf('className="cs-hold hy-press"');
  const holdButton = childSos.slice(holdButtonStart, childSos.indexOf("</button>", holdButtonStart));

  assert.match(childSos, /setPointerCapture\(event\.pointerId\)/);
  assert.match(childSos, /releasePointerCapture\(event\.pointerId\)/);
  assert.doesNotMatch(holdButton, /onPointerLeave/);
});

test("SOS 부모 알림은 같은 멱등키로 일시 실패를 한 번 재시도한다", () => {
  const endpoint = readSource("src/lib/api/endpoints/sos.ts");

  assert.match(endpoint, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(endpoint, /event_id:\s*requestHash/);
  assert.match(endpoint, /error\.status >= 500/);
  assert.match(endpoint, /postParentSosAlert\(/);
  assert.match(endpoint, /SOS_ALERT_ATTEMPT_TIMEOUT_MS = 8_000/);
  assert.match(endpoint, /apiPost\("\/api\/parent-alerts", body, \{ signal: controller\.signal \}\)/);
});
