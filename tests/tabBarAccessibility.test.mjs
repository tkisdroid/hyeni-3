import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/TabBar.tsx", import.meta.url), "utf8");

test("하단 탭 탐색 이름은 현재 언어의 탭 라벨에서 만들고 한국어로 고정하지 않는다", () => {
  assert.match(source, /const navigationLabel = tabs\.map\(\(tab\) => tab\.label\)\.join\(", "\)/);
  assert.match(source, /aria-label=\{navigationLabel\}/);
  assert.doesNotMatch(source, /aria-label="주 메뉴"/);
});
