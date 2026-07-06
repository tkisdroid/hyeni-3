import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const childHome = readFileSync("src/screens/child/ChildHome.tsx", "utf8");
const chat = readFileSync("src/screens/child/AiFriendChat.tsx", "utf8");
const setup = readFileSync("src/screens/child/AiFriendSetup.tsx", "utf8");

assert.ok(setup.includes('name: "통통이"'), "기본 토끼 페르소나 이름은 통통이여야 한다");
assert.ok(!childHome.includes('|| "혜니"'), "아이 홈 AI 친구 기본값은 혜니가 아니어야 한다");
assert.ok(
  childHome.includes("resolveAiFriendDisplayName"),
  "아이 홈은 서버에 저장된 아이 이름 오염값을 정규화한 AI 친구 이름을 써야 한다",
);
assert.ok(
  chat.includes("resolveAiFriendDisplayName"),
  "AI 채팅은 서버에 저장된 아이 이름 오염값을 정규화한 AI 친구 이름을 써야 한다",
);
assert.ok(
  !chat.includes("publicSettings?.ai_friend_name || persona.name"),
  "AI 채팅은 공개 설정 이름을 그대로 기본값으로 쓰면 안 된다",
);

console.log("aiFriendDefault contract ok");
