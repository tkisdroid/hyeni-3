import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

test("원격 울림의 네 조회는 실패를 데이터로 삼키지 않고 같은 query refetch로 복구한다", () => {
  const endpoint = read("src/lib/api/endpoints/remote.ts");
  const screen = read("src/screens/feature/RemoteRing.tsx");

  const activeBody = endpoint.match(/export async function fetchActiveForceRing[\s\S]*?\n}/)?.[0] ?? "";
  const historyBody = endpoint.match(/export async function fetchForceRingHistory[\s\S]*?\n}/)?.[0] ?? "";
  const quotaBody = endpoint.match(/export async function fetchForceRingQuota[\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(activeBody, /catch\s*{/);
  assert.doesNotMatch(historyBody, /catch\s*{/);
  assert.doesNotMatch(quotaBody, /catch\s*{/);
  assert.doesNotMatch(quotaBody, /Promise<ForceRingQuota\s*\|\s*null>/);

  assert.match(screen, /const familyQuery = useMyFamily\(\)/);
  assert.match(screen, /const ringQueryState = resolveQueryTruthState/);
  assert.match(screen, /ringQueryState === "loading"/);
  assert.match(screen, /ringQueryState === "error"/);
  assert.match(screen, /children\.length === 0/);
  assert.match(screen, /void retryRemoteRing\(\)/);
  assert.match(screen, /familyQuery\.refetch\(\)/);
  assert.match(screen, /activeQuery\.refetch\(\)/);
  assert.match(screen, /historyQuery\.refetch\(\)/);
  assert.match(screen, /quotaQuery\.refetch\(\)/);
  assert.match(screen, /quota\?\.allowed === true/);
  assert.doesNotMatch(screen, /quota \? quota\.allowed : true/);
});

test("계정의 중첩 SocialLinks 조회는 로딩·오류·빈값·성공과 같은 query 재시도를 모두 표시한다", () => {
  const source = read("src/screens/parent/SocialLinks.tsx");
  assert.match(source, /isError/);
  assert.match(source, /refetch/);
  assert.match(source, /native && isLoading/);
  assert.match(source, /native && isError/);
  assert.match(source, /native && !isLoading && !isError && links\.length === 0/);
  assert.match(source, /void refetch\(\)/);
  assert.match(source, /links\.map/);
});
