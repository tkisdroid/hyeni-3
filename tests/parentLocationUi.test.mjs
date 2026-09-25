import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const css = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.css"), "utf8");
const refreshWaitSource = readFileSync(resolve(rootDir, "src/transform/locationRefreshWait.ts"), "utf8");
const koParent = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/parent.json"), "utf8"));

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
  // 새로고침 버튼은 자체 회전 아이콘이 있으므로 전역 aria-busy 스피너를 끈다(아이콘 2개 방지).
  assert.match(source, /className=\{`pl-refresh hy-busy-quiet\$\{/);
  assert.match(source, /aria-busy=\{isRefreshingLocation\}/);
  // 진행 중 버튼 라벨은 대상 아이를 밝힌다("혜니 위치 확인 중").
  assert.match(source, /aria-label=\{isRefreshingLocation \? refreshBusyLabel :/);
  assert.match(koParent["parent.location.refreshingForChild"], /\{childName\} 위치 확인 중/);
});

test("위치 갱신 진행은 새로고침 버튼 하나로만 알리고 아이 프로필을 건드리지 않는다", () => {
  // 2026-08-17 TK 제보: 아이 프로필 위에 "위치 요청을 보냈어요"가 겹쳐 보이고
  // 칩과 새로고침 버튼이 각각 움직여 디자인이 흐트러졌다. 문구·칩 변형은 재도입 금지.
  assert.doesNotMatch(source, /parent\.location\.requestSent/);
  assert.doesNotMatch(source, /parent\.parentLocation\.copy006/);
  assert.doesNotMatch(source, /pl-chip__status|pl-chip__spinner|data-refreshing/);
  assert.doesNotMatch(css, /\.pl-chip__status|\.pl-chip__spinner|\.pl-chip\[data-refreshing/);
  assert.doesNotMatch(source, /className="pl-refreshing"/);
  assert.doesNotMatch(css, /\.pl-refreshing\s*\{/);
  // 상세 카드는 진행 중에도 마지막 확인 정보를 그대로 보여준다(빈 문구로 바꾸지 않는다).
  assert.match(source, /pl-sheet__zone--loading/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.pl-sheet__zone--loading \.pl-sheet__zone-dot[^}]*animation: none;/s,
  );
});

test("부모 위치 화면 자동 요청은 Premium에서만 실행해 Free 수동 5회를 소모하지 않는다", () => {
  assert.match(source, /isFetched/);
  assert.match(source, /const autoRefreshKeyRef = useRef<string \| null>\(null\)/);
  assert.match(
    source,
    /if \(\s*activeView !== "live"\s*\|\|\s*!canShowLocation\s*\|\|\s*!premiumOpen\s*\|\|\s*!canAutoRequestLocation\s*\|\|\s*!refreshTargetKey\s*\|\|\s*!isFetched\s*\|\|\s*isFetching\s*\|\|\s*isRefreshingLocation\s*\)\s*return;/s,
  );
  assert.match(source, /autoRefreshKeyRef\.current = refreshTargetKey/);
  assert.match(source, /void refreshLocation\(false\)/);
});

// 2026-09-25 브라우저 QA — 공동 보호자가 위치 화면에 들어올 때마다 서버가 거절할 자동 요청을 보내
// "주 보호자만 할 수 있어요" 안내가 저절로 떴다. 자동 요청은 주 보호자만 보낸다.
test("부모 위치 화면 자동 요청은 주 보호자만 보낸다", () => {
  assert.match(source, /const canAutoRequestLocation = familyQuery\.data\?\.isPrimaryParent === true;/);
  assert.match(source, /requested\.error === "primary_parent_required"/);
});

test("오래된 위치는 현재 장소가 아니라 마지막 확인 장소로 표시한다", () => {
  assert.match(source, /fresh\?\.status === "stale"/);
  assert.match(koParent["parent.location.lastSeenAt"], /마지막 확인: \{place\}/);
  assert.match(source, /parent\.location\.lastSeenAt/);
  assert.match(source, /pl-sheet__zone--stale/);
});
