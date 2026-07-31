import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("SOS 는 3초 홀드 안내를 반말로 명확히 말한다(시안 2a)", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /꾹 눌러서 도와 줘!/);
  assert.match(childSos, /3초 꾹/);
  assert.match(childSos, /찾은 <b>내 위치<\/b>도 함께 담을게/);
  // 존댓말 금지(아이 모드) — 시안의 "알려요/놀라요"를 반말로 고쳤다.
  assert.doesNotMatch(childSos, /알려요|놀라요|갈래요/);
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

  assert.match(childSos, /SOS를 접수했어!/);
  assert.match(childSos, /보호자에게 알림 전송을 시작했어/);
  assert.doesNotMatch(childSos, /보호자 모두에게 알림이 갔어|위치는 못 찾았지만 알림은 갔어|에게 알렸어!/);
});

test("부모 홈에는 '꾹' 스티커 UI 를 되살리지 않는다(2026-07-09 TK 결정)", () => {
  const parentHome = readSource("src/screens/parent/ParentHome.tsx");
  assert.doesNotMatch(parentHome, /꾹/);
});
