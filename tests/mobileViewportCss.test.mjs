import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readCss(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("AI 친구 채팅은 앱 프레임 높이에 맞고 메시지 목록만 스크롤된다", () => {
  const css = readCss("src/screens/child/AiFriendChat.css");

  assert.doesNotMatch(css, /\.afc\s*\{[^}]*min-height:\s*848px/s);
  assert.match(css, /\.afc\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.afc\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.afc-msgs\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.afc-msgs\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.afc-input-wrap\s*\{[^}]*flex:\s*none/s);
  assert.match(css, /\.afc-input-wrap\s*\{[^}]*position:\s*relative/s);
});

test("스티커 전송 화면은 앱 프레임 안에서 본문만 스크롤된다", () => {
  const css = readCss("src/screens/feature/StickerSend.css");

  assert.match(css, /\.ss-wrap\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.ss-wrap\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.ss-body\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /\.ss-body\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.ss-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(css, /120px \+ env\(safe-area-inset-bottom/);
});
