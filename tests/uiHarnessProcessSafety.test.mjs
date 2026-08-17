import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("브라우저 QA·UI 하니스는 shell 문자열 결합 없이 로컬 Vite를 직접 실행한다", () => {
  const source = [
    readFileSync(new URL("../scripts/final-browser-qa.mjs", import.meta.url), "utf8"),
    readFileSync(new URL("../scripts/verify-ui-harness.mjs", import.meta.url), "utf8"),
  ].join(String.fromCharCode(10));

  assert.match(source, /const VITE_BIN = resolve\(ROOT_DIR,\s*["']node_modules\/vite\/bin\/vite\.js["']\)/);
  assert.match(source, /spawn\(process\.execPath,\s*\[VITE_BIN/);
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /shell:\s*process\.platform/);
});
