import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/shared/MemoChat.tsx"), "utf8");

test("대화 사진 미리보기는 공통 dialog 초점 생명주기를 사용한다", () => {
  assert.match(source, /useDialogFocusLifecycle/);
  assert.match(source, /const previewDialogRef = useDialogFocusLifecycle<HTMLDivElement>/);
  assert.match(source, /ref=\{previewDialogRef\}[\s\S]*role="dialog"/);
  assert.match(source, /aria-labelledby="mc-photo-preview-title"/);
  assert.doesNotMatch(source, /const closeOnEscape = \(event: KeyboardEvent\)/);
});
