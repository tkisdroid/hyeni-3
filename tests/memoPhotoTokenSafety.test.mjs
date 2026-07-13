import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/screens/shared/MemoChat.tsx", import.meta.url),
  "utf8",
);

test("메모 사진은 JWT query URL을 시스템 브라우저로 전달하지 않는다", () => {
  assert.doesNotMatch(source, /openExternal\s*\(\s*childPhotoProxyUrl/);
  assert.doesNotMatch(source, /const\s+u\s*=\s*childPhotoProxyUrl[\s\S]{0,160}openExternal\s*\(\s*u\s*\)/);
  assert.match(source, /setPreviewImagePath\(m\.imagePath\)/);
});

test("사진 확대는 앱 내부 접근 가능한 dialog에서 닫을 수 있다", () => {
  assert.match(source, /className="mc-photo-preview"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /setPreviewImagePath\(null\)/);
});
