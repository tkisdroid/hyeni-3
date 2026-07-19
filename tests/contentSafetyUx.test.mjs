import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ai = await read("src/screens/child/AiFriendChat.tsx");
const memo = await read("src/screens/shared/MemoChat.tsx");
const dialog = await read("src/components/MessageSafetyDialog.tsx");
const dialogFocusLifecycle = await read("src/components/useDialogFocusLifecycle.ts");
const dialogFocusStack = await read("src/components/dialogFocusStack.ts");
const endpoint = await read("src/lib/api/endpoints/contentSafety.ts");
const queries = await read("src/queries/useContentSafety.ts");
const childHome = await read("src/screens/child/ChildHome.tsx");

test("저장된 AI assistant 메시지는 즉시 신고할 수 있고 로컬 인사·오류는 신고하지 않는다", () => {
  assert.match(ai, /assistantMessageId/);
  assert.match(ai, /reportable:\s*!!res\.assistantMessageId/);
  assert.match(ai, /이 답변 신고/);
  assert.match(ai, /useReportAiMessage/);
  assert.match(endpoint, /\/api\/ai\/messages\/\$\{encodeURIComponent\(messageId\)\}\/report/);
  assert.match(ai, /알려줘서 고마워\. 이 답변은 다시 확인할게\./);
});

test("가족 메모 상대 메시지에는 앱 내 신고·차단 동선과 차단 해제가 있다", () => {
  assert.match(memo, /신고·차단/);
  assert.match(memo, /useReportMemoReply/);
  assert.match(memo, /useBlockMemoUser/);
  assert.match(memo, /useUnblockMemoUser/);
  assert.match(memo, /차단 해제/);
  assert.match(queries, /invalidateQueries/);
  assert.doesNotMatch(memo, /\.filter\(\(item\) => item\.member !== null\)/);
  assert.match(memo, /member\?\.name \?\? "보호자"/);
});

test("신고 dialog는 키보드·스크린리더·실패 재시도를 지원하고 아이 톤을 분리한다", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /useDialogFocusLifecycle/);
  assert.match(dialog, /canClose:\s*\(\) => !pending/);
  assert.match(dialogFocusLifecycle, /handleTopmostDialogKey/);
  assert.match(dialogFocusStack, /key === "Escape"/);
  assert.match(dialog, /disabled=\{pending/);
  assert.match(dialog, /textarea/);
  assert.match(dialog, /tone === "child"/);
  const blockFlow = dialog.slice(dialog.indexOf("const submitBlock"), dialog.indexOf("if (!open) return null"));
  assert.doesNotMatch(blockFlow, /onClose\(\)/);
  assert.match(queries, /meta:\s*\{\s*silentError:\s*true\s*\}/);
});

test("차단 API는 가족 연결이나 안전 알림 API를 변경하지 않고 메모 전용 계약만 사용한다", () => {
  assert.match(endpoint, /\/api\/memos\/blocks/);
  assert.doesNotMatch(endpoint, /\/api\/(?:family|parent-alerts|sos|danger-zones)/);
});

test("빠른 상태는 차단될 수 있는 가족 메시지 저장을 실제 수신처럼 단정하지 않는다", () => {
  assert.match(childHome, /가족 메시지에 남겼어/);
  assert.doesNotMatch(childHome, /부모님께 보냈어/);
});
