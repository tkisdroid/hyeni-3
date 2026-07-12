import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const refreshWaitSource = readFileSync(resolve(rootDir, "src/transform/locationRefreshWait.ts"), "utf8");

test("부모 위치 화면의 아이 표시 배지는 실시간 탭에서만 보인다", () => {
  assert.match(source, /!isLocked && activeView === "live" && selected && \(/);
  assert.doesNotMatch(source, /!isLocked && selected && \(/);
});

test("실시간 위치 요청 중에는 대기 상태를 화면에 표시하고 실제 갱신까지 폴링한다", () => {
  assert.match(source, /import \{ waitForNewChildLocation \} from "@\/transform\/locationRefreshWait"/);
  assert.match(source, /await waitForNewChildLocation\(\{/);
  assert.match(refreshWaitSource, /export const LOCATION_REFRESH_TIMEOUT_MS = 215_000/);
  assert.match(refreshWaitSource, /export const LOCATION_REFRESH_POLL_MS = 2_500/);
  assert.match(refreshWaitSource, /while \(now\(\) < deadline\)/);
  assert.match(source, /return \(\) => \{\s*refreshSeq\.current \+= 1;/s);
  assert.match(source, /className="pl-refreshing"/);
  assert.match(source, /지도와 장소명은 마지막으로 확인된 위치예요/);
});

test("오래된 위치는 현재 장소가 아니라 마지막 확인 장소로 표시한다", () => {
  assert.match(source, /fresh\?\.status === "stale"/);
  assert.match(source, /마지막 확인: \$\{curPlace\}/);
  assert.match(source, /pl-sheet__zone--stale/);
});
