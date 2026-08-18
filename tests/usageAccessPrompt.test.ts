/**
 * 아이 기기 "사용 정보 접근"을 처음 설정에서 함께 받고, 꺼져 있으면 아이 기기가 다시 묻는 계약
 * (2026-08-18 TK 지시 — 부모는 아이 기기를 만질 수 없으니 안내만 남기고 끝내지 않는다).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  shouldPromptUsageAccess,
  usageAccessPromptStorageKey,
  readUsageAccessPromptedAt,
  writeUsageAccessPromptedAt,
  USAGE_ACCESS_PROMPT_INTERVAL_MS,
} from "../src/transform/usageAccessPrompt.ts";
import { advanceLocationPermissionStage } from "../src/transform/locationPermissionFlow.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.UTC(2026, 7, 18, 3, 0, 0);

test("위치 권한을 다 받으면 사용 정보 접근 단계로 이어진다", () => {
  assert.equal(
    advanceLocationPermissionStage("backgroundEducation", {
      type: "backgroundResult",
      granted: true,
      supported: true,
      usageAccessGranted: false,
    }),
    "usageAccess",
  );
  // 이미 켜져 있거나 확인할 수 없으면 한 단계를 더 보여 주지 않는다.
  assert.equal(
    advanceLocationPermissionStage("backgroundEducation", {
      type: "backgroundResult",
      granted: true,
      supported: true,
      usageAccessGranted: true,
    }),
    "closed",
  );
  assert.equal(
    advanceLocationPermissionStage("backgroundEducation", {
      type: "backgroundResult",
      granted: true,
      supported: true,
    }),
    "closed",
  );
  // 켠 것을 확인해야 닫힌다 — 말만 듣고 넘어가지 않는다.
  assert.equal(advanceLocationPermissionStage("usageAccess", { type: "usageAccessResult", granted: false }), "usageAccess");
  assert.equal(advanceLocationPermissionStage("usageAccess", { type: "usageAccessResult", granted: true }), "closed");
});

test("꺼져 있으면 다시 묻되 매번 묻지는 않는다", () => {
  const base = { native: true, supported: true, granted: false, nowMs: NOW };
  assert.equal(shouldPromptUsageAccess({ ...base, lastPromptedAtMs: null }), true);
  assert.equal(
    shouldPromptUsageAccess({ ...base, lastPromptedAtMs: NOW - USAGE_ACCESS_PROMPT_INTERVAL_MS + 1 }),
    false,
  );
  assert.equal(
    shouldPromptUsageAccess({ ...base, lastPromptedAtMs: NOW - USAGE_ACCESS_PROMPT_INTERVAL_MS }),
    true,
  );
  // 기기 시계가 앞서 있어도 영원히 침묵하지 않는다.
  assert.equal(shouldPromptUsageAccess({ ...base, lastPromptedAtMs: NOW + 86_400_000 }), true);
});

test("이미 켜졌거나 확인할 수 없는 환경에서는 묻지 않는다", () => {
  const base = { native: true, supported: true, granted: false, lastPromptedAtMs: null, nowMs: NOW };
  assert.equal(shouldPromptUsageAccess({ ...base, granted: true }), false);
  assert.equal(shouldPromptUsageAccess({ ...base, supported: false }), false);
  assert.equal(shouldPromptUsageAccess({ ...base, native: false }), false);
});

test("물어본 시각은 가족·아이별로 따로 남는다", () => {
  assert.notEqual(usageAccessPromptStorageKey("f1", "c1"), usageAccessPromptStorageKey("f1", "c2"));
  assert.notEqual(usageAccessPromptStorageKey("f1", "c1"), usageAccessPromptStorageKey("f2", "c1"));
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  const key = usageAccessPromptStorageKey("f1", "c1");
  assert.equal(readUsageAccessPromptedAt(storage, key), null);
  writeUsageAccessPromptedAt(storage, key, NOW);
  assert.equal(readUsageAccessPromptedAt(storage, key), NOW);
});

test("아이 기기가 실제로 물어보도록 배선돼 있다", () => {
  const dialog = read("src/components/ChildLocationPermissionDialog.tsx");
  // 설정 화면을 열고, 돌아오면 실제 상태를 다시 읽어 확인한다.
  assert.match(dialog, /openUsageAccessSettings\(\)/);
  assert.match(dialog, /const usage = await readUsageAccessState\(\);/);
  assert.match(dialog, /type: "usageAccessResult", granted/);
  // 아이 홈은 꺼져 있을 때만, 주기 안에서만 다시 묻는다.
  const childHome = read("src/screens/child/ChildHome.tsx");
  assert.match(childHome, /shouldPromptUsageAccess\(\{/);
  assert.match(childHome, /initialStage="usageAccess"/);
  // 온보딩에서 물어본 기록을 남겨 홈이 곧바로 또 묻지 않는다.
  assert.match(read("src/screens/onboarding/Onboarding.tsx"), /usagePromptStorageKey=\{usageAccessPromptKey\}/);
});

test("부모 화면 안내는 아이 기기에서 켜면 보인다는 한 줄로 줄인다", () => {
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  const koReports = JSON.parse(read("locales/ko/reports.json"));
  assert.equal(koParent["parent.parentHome.copy047"], "아이 기기에서 사용 정보 접근을 켜면 보여요");
  assert.equal(koReports["reports.daily.appPermission"], "아이 기기에서 사용 정보 접근을 켜면 보여요.");
  for (const value of [koParent["parent.parentHome.copy047"], koReports["reports.daily.appPermission"]]) {
    assert.ok(value.length <= 30, `안내가 깁니다: ${value}`);
    assert.doesNotMatch(value, />/, "부모에게 설정 경로를 시키지 않는다");
  }
});
