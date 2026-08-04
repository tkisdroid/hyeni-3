import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("격리 UI 하니스는 shell 문자열 결합 없이 로컬 Vite를 직접 실행한다", () => {
  const source = readFileSync(new URL("../scripts/tmp-verify-ui.mjs", import.meta.url), "utf8");

  assert.match(source, /node_modules["'],\s*["']vite["'],\s*["']bin["'],\s*["']vite\.js/);
  assert.match(source, /spawn\(process\.execPath,\s*\[viteBin/);
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /shell:\s*process\.platform/);
});
