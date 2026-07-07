import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("일반 저장/아이 설정 화면은 첫 아이 폴백을 쓰지 않는다", () => {
  const useSchedule = readSource("src/queries/useSchedule.ts");
  const childSettings = readSource("src/screens/child/ChildSettings.tsx");

  assert.doesNotMatch(useSchedule, /children\[0\]/);
  assert.doesNotMatch(childSettings, /children\[0\]/);
});

test("첫 아이 기본값은 명시적 수신자 선택 화면에만 남긴다", () => {
  const remoteRing = readSource("src/screens/feature/RemoteRing.tsx");
  const stickerSend = readSource("src/screens/feature/StickerSend.tsx");

  assert.match(remoteRing, /children\[0\]/);
  assert.match(stickerSend, /children\[0\]/);
});
