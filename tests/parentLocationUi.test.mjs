import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");

test("부모 위치 화면의 아이 표시 배지는 실시간 탭에서만 보인다", () => {
  assert.match(source, /!isLocked && activeView === "live" && selected && \(/);
  assert.doesNotMatch(source, /!isLocked && selected && \(/);
});
