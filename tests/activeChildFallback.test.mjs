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

test("명시적 수신자 화면도 활성 아이가 없으면 첫 아이를 임의 선택하지 않는다", () => {
  const remoteRing = readSource("src/screens/feature/RemoteRing.tsx");
  const stickerSend = readSource("src/screens/feature/StickerSend.tsx");

  assert.match(remoteRing, /children\[0\]/);
  assert.match(
    stickerSend,
    /children\.find\(\(c\) => c\.user_id === selectedUserId\)[\s\S]{0,180}children\.find\(\(c\) => c\.id === activeChild\?\.id\)/,
  );
  assert.match(stickerSend, /user_id: targetChild\.user_id/);
  assert.match(stickerSend, /useReceivedStickers\(targetChild\?\.user_id \?\? null\)/);
  assert.match(stickerSend, /buildStickerBook\(receivedQuery\.data \?\? \[\], nowMs/);
  assert.match(stickerSend, /children\.length > 1 \|\| !targetChild/);
  assert.doesNotMatch(stickerSend, /children\[0\]/);
});
