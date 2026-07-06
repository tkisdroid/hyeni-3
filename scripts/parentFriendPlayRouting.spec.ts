import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const parentHome = readFileSync("src/screens/parent/ParentHome.tsx", "utf8");
const childHome = readFileSync("src/screens/child/ChildHome.tsx", "utf8");
const app = readFileSync("src/app/App.tsx", "utf8");

assert.match(
  parentHome,
  /"친구놀이":\s*"\/playdate-accept"/,
  "부모 홈의 친구놀이는 아이 발신 화면이 아니라 부모의 놀이 요청 확인 화면으로 가야 합니다",
);
assert.match(
  childHome,
  /navigate\("\/friend-play"\)/,
  "아이 홈의 친구랑 놀기는 아이 발신 화면으로 유지되어야 합니다",
);
assert.match(app, /path:\s*"friend-play"/);
assert.match(app, /path:\s*"playdate-accept"/);

console.log("parentFriendPlayRouting contract ok");
