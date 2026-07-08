import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("아이 홈과 SOS 화면에는 꾹 문구 대신 SOS 도움 요청 문구를 쓴다", () => {
  const childHome = readSource("src/screens/child/ChildHome.tsx");
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childHome, /SOS 도움 요청/);
  assert.match(childHome, /3초 누르면 엄마·아빠한테 바로 연결/);
  assert.match(childSos, /3초 누르면 보내져/);
  assert.doesNotMatch(childHome, /꾹/);
  assert.doesNotMatch(childSos, /꾹/);
});
