import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/FriendPlay.tsx"), "utf8");

test("부모 세션의 친구놀이 화면은 아이 요청 화면이 아니라 설정 화면을 보여준다", () => {
  assert.match(source, /role === "parent"/);
  assert.match(source, /친구놀이 설정/);
  assert.match(source, /아이 기기에서 친구놀이 요청을 보낼 수 있어요/);
  assert.match(source, /useSetPlaydateEnabled/);
});
