import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

test("부모 위치 화면은 서버의 GPS 오차를 숨기지 않고 낮은 정확도를 강등한다", () => {
  const endpoint = read("src/lib/api/endpoints/location.ts");
  const parent = read("src/screens/parent/ParentLocation.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  const status = read("src/screens/feature/LocationStatus.tsx");

  assert.match(endpoint, /accuracy_m\?: number \| null/);
  assert.match(parent, /const accuracyM =/);
  assert.match(koParent["parent.location.lowAccuracy"], /오차 약/);
  assert.match(parent, /parent\.location\.lowAccuracy/);
  assert.match(status, /정확도가 낮아요/);
});
