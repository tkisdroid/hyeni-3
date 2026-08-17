import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const css = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.css"), "utf8");
const refreshWaitSource = readFileSync(resolve(rootDir, "src/transform/locationRefreshWait.ts"), "utf8");

test("부모 위치 화면의 아이 표시 배지는 조회 범위가 확정된 실시간 탭에서만 보인다", () => {
  assert.match(source, /!isLocked && !locationScopePending && activeView === "live" && selected && \(/);
  assert.doesNotMatch(source, /!isLocked && selected && \(/);
});

test("실시간 위치 요청 중에는 대기 상태를 화면에 표시하고 실제 갱신까지 폴링한다", () => {
  assert.match(source, /import \{ waitForNewChildLocation \} from "@\/transform\/locationRefreshWait"/);
  assert.match(source, /await waitForNewChildLocation\(\{/);
  assert.match(refreshWaitSource, /export const LOCATION_REFRESH_TIMEOUT_MS = 215_000/);
  assert.match(refreshWaitSource, /export const LOCATION_REFRESH_POLL_MS = 2_500/);
  assert.match(refreshWaitSource, /while \(now\(\) < deadline\)/);
  assert.match(source, /return \(\) => \{\s*refreshSeq\.current \+= 1;/s);
  // 진행 안내는 간단한 한 줄만 쓴다 — 단계별 설명과 부제는 재도입 금지(2026-08-02 TK 지시).
  assert.match(source, /const refreshOverlayTitle = "위치 요청을 보냈어요"/);
  assert.doesNotMatch(source, /refreshOverlaySub|새 위치를 기다리는 중|위치 요청을 보내는 중/);
  // 새로고침 버튼은 자체 회전 아이콘이 있으므로 전역 aria-busy 스피너를 끈다(아이콘 2개 방지).
  assert.match(source, /className=\{`pl-refresh hy-busy-quiet\$\{/);
});

test("위치 요청 안내는 아이 프로필 칩 안에 표시해 프로필을 가리지 않는다", () => {
  assert.match(source, /data-refreshing=\{isRefreshingLocation \? "true" : "false"\}/);
  assert.match(source, /className="pl-chip__status"/);
  assert.match(source, /className="pl-chip__spinner"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.doesNotMatch(source, /className="pl-refreshing"/);
  assert.doesNotMatch(css, /\.pl-refreshing\s*\{/);
  assert.match(css, /\.pl-chip\[data-refreshing="true"\]/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.pl-chip__spinner[^}]*animation: none;/s,
  );
});

test("부모 위치 화면 자동 요청은 Premium에서만 실행해 Free 수동 5회를 소모하지 않는다", () => {
  assert.match(source, /isFetched/);
  assert.match(source, /const autoRefreshKeyRef = useRef<string \| null>\(null\)/);
  assert.match(
    source,
    /if \(\s*activeView !== "live"\s*\|\|\s*!canShowLocation\s*\|\|\s*!premiumOpen\s*\|\|\s*!refreshTargetKey\s*\|\|\s*!isFetched\s*\|\|\s*isFetching\s*\|\|\s*isRefreshingLocation\s*\)\s*return;/s,
  );
  assert.match(source, /autoRefreshKeyRef\.current = refreshTargetKey/);
  assert.match(source, /void refreshLocation\(false\)/);
});

test("오래된 위치는 현재 장소가 아니라 마지막 확인 장소로 표시한다", () => {
  assert.match(source, /fresh\?\.status === "stale"/);
  assert.match(source, /마지막 확인: \$\{curPlace\}/);
  assert.match(source, /pl-sheet__zone--stale/);
});
