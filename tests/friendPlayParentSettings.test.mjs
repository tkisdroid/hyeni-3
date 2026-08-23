import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/FriendPlay.tsx"), "utf8");
const parentHomeSource = readFileSync(resolve(rootDir, "src/screens/parent/ParentHome.tsx"), "utf8");
const koShared = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/shared.json"), "utf8"));

test("부모 세션의 친구놀이 화면은 아이 요청 화면이 아니라 설정 화면을 보여준다", () => {
  assert.match(source, /role === "parent"/);
  assert.match(source, /shared\.friendPlay\.parent\.screenTitle/);
  assert.match(source, /shared\.friendPlay\.parent\.heroDescription/);
  assert.equal(koShared["shared.friendPlay.parent.screenTitle"], "친구놀이 설정");
  assert.match(koShared["shared.friendPlay.parent.heroDescription"], /아이 기기에서 친구놀이 요청을 보내요/);
  assert.match(source, /useSetPlaydateEnabled/);
});

test("부모 홈 친구놀이 바로가기는 놀이 요청 수락 화면이 아니라 부모 설정 화면으로 이동한다", () => {
  assert.match(parentHomeSource, /sc3: "\/friend-play"/);
  assert.doesNotMatch(parentHomeSource, /sc3: "\/playdate-accept"/);
});
