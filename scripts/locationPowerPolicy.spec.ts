import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("android/app/src/main/java/com/hyeni/calendar/LocationService.java", "utf8");

function constantMs(name: string): number {
  const match = source.match(new RegExp(`private static final long ${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `${name} 상수가 있어야 합니다`);
  const expr = match[1].replace(/[ _L]/g, "");
  assert.match(expr, /^[0-9+*()]+$/, `${name} 상수는 숫자 식이어야 합니다`);
  return Function(`"use strict"; return (${expr});`)() as number;
}

function modeBlock(mode: "live" | "saver" | "balanced"): string {
  const label = mode === "balanced" ? "case \"balanced\":" : `case "${mode}":`;
  const start = source.indexOf(label);
  assert.ok(start >= 0, `${mode} 위치 모드 분기가 있어야 합니다`);
  const end = source.indexOf("break;", start);
  assert.ok(end > start, `${mode} 위치 모드 분기는 break로 끝나야 합니다`);
  return source.slice(start, end);
}

function modeAssignmentMs(mode: "live" | "saver" | "balanced", field: string): number {
  const block = modeBlock(mode);
  const match = block.match(new RegExp(`${field}\\s*=\\s*([^;]+);`));
  assert.ok(match, `${mode}.${field} 할당이 있어야 합니다`);
  const expr = match[1].trim();
  if (/^[A-Z][A-Z0-9_]+$/.test(expr)) return constantMs(expr);
  const normalized = expr.replace(/[ _L]/g, "");
  assert.match(normalized, /^[0-9+*()]+$/, `${mode}.${field} 값은 숫자 식 또는 상수여야 합니다`);
  return Function(`"use strict"; return (${normalized});`)() as number;
}

assert.ok(
  constantMs("NOTIF_POLL_INTERVAL_MS") >= 60_000,
  "백그라운드 pending 알림 폴링은 FCM fallback이므로 최소 60초 이상이어야 합니다",
);
assert.ok(
  constantMs("EVENT_CHECK_INTERVAL_MS") >= 60_000,
  "일정 로컬 평가는 서버 cron/캐시와 병행하므로 최소 60초 이상이어야 합니다",
);
assert.ok(
  constantMs("PLACE_EVAL_INTERVAL_MS") >= 60_000,
  "등록 장소 평가는 GPS fix마다가 아니라 절전형 주기로 평가해야 합니다",
);
assert.ok(
  constantMs("LOCATION_FIX_WATCHDOG_INTERVAL_MS") >= 120_000,
  "watchdog 단발 고정밀 fix는 최소 2분 이상 간격이어야 합니다",
);
assert.ok(
  constantMs("LOCATION_FIX_STALE_MS") >= 120_000,
  "balanced 기본 stale 판정이 45초처럼 짧으면 고정밀 fix가 과도하게 반복됩니다",
);

assert.ok(modeAssignmentMs("balanced", "moving") >= 15_000, "balanced 이동 측위는 최소 15초 간격이어야 합니다");
assert.ok(modeAssignmentMs("balanced", "stationary") >= 120_000, "balanced 정지 측위는 최소 2분 간격이어야 합니다");
assert.ok(modeAssignmentMs("live", "moving") >= 8_000, "live 모드도 상시 3초 GPS는 금지합니다");
assert.ok(modeAssignmentMs("live", "stationary") >= 45_000, "live 정지 측위는 최소 45초 간격이어야 합니다");
assert.ok(modeAssignmentMs("saver", "moving") >= 60_000, "절약 모드 이동 측위는 최소 1분 간격이어야 합니다");
assert.ok(
  source.includes("stopForInvalidSession"),
  "refresh token이 무효인 위치 서비스는 배터리 좀비가 되지 않도록 스스로 종료해야 합니다",
);
assert.ok(
  /code\s*==\s*401\s*\|\|\s*code\s*==\s*403/.test(source),
  "네이티브 refresh 401/403은 명시적 세션 무효로 처리해야 합니다",
);

console.log("locationPowerPolicy contract ok");
