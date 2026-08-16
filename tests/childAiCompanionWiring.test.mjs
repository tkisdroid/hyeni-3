import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("아이 셸에는 감정 플로팅 AI 버튼이 항상 떠 있다", () => {
  const shell = read("src/app/AppShell.tsx");
  const fab = read("src/components/child/ChildAiFab.tsx");
  assert.match(shell, /<ChildAiFab \/>/);
  assert.match(fab, /role !== "child"/);
  assert.match(fab, /\/child\/sos/);
  assert.match(fab, /childAiEmotionAsset/);
  assert.match(fab, /navigate\("\/child\/ai-friend"\)/);
});

test("아이 채팅은 음성 주고받기와 크레딧 소모 전송을 유지한다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /captureSpeech/);
  assert.match(chat, /speakChildAiReply/);
  assert.match(chat, /useSendChildChat/);
  assert.match(chat, /confirmedTool/);
  assert.match(chat, /childAiChatFriendlyError/);
  const errors = read("src/transform/childAiChatError.ts");
  assert.match(errors, /case "ai_failure"/);
  assert.match(errors, /case "schedule_delete_parent_only"/);
  assert.match(errors, /생각이 잘 안 나/);
  assert.doesNotMatch(chat, /deleteSchedule/);
  const help = read("src/transform/childAiHelp.ts");
  assert.match(help, /toolName === "updateSchedule"/);
  assert.match(help, /toolName === "createMessageToParent"/);
  assert.doesNotMatch(help, /deleteSchedule/);
});

test("플로팅 버튼은 3D 감정 이미지를 쓰고 독·SOS 를 가리지 않는다", () => {
  const css = read("src/components/child/ChildAiFab.css");
  assert.match(css, /bottom: calc\(92px \+ env\(safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /var\(--radius-pill\)/);
});
