import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {
  annotateTierAlertActivation,
  annotateTierAlertActivationByFamily,
  annotateTierAlertActivationSelection,
} = await import(
  pathToFileURL(resolve(workerDir, "lib/tierAlertActivation.ts")).href
);

test("티어 알림 활성 항목은 생성시각·id의 안정적 순서로만 한도 안에 포함한다", () => {
  const rows = [
    { id: "zone-c", created_at: "2026-08-01T10:00:00.000Z" },
    { id: "zone-b", created_at: "2026-08-01T09:00:00.100Z" },
    { id: "zone-a", created_at: "2026-08-01T09:00:00.900Z" },
  ];

  assert.deepEqual(
    annotateTierAlertActivation(rows, 2).map((row) => ({
      id: row.id,
      active: row.tier_alert_active,
      reason: row.tier_alert_inactive_reason,
    })),
    [
      { id: "zone-a", active: true, reason: null },
      { id: "zone-b", active: true, reason: null },
      { id: "zone-c", active: false, reason: "premium_required" },
    ],
  );
});

test("Premium 무제한은 저장 항목을 삭제하거나 비활성화하지 않는다", () => {
  const rows = [
    { id: "place-2", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "place-1", created_at: "2026-08-01T00:00:00.000Z" },
  ];
  const annotated = annotateTierAlertActivation(rows, null);

  assert.deepEqual(annotated.map((row) => row.id), ["place-1", "place-2"]);
  assert.equal(annotated.every((row) => row.tier_alert_active), true);
  assert.equal(annotated.every((row) => row.tier_alert_inactive_reason === null), true);
});

test("REST 호환 조회는 반환 순서를 보존하면서 가족별 알림 대상을 서버에서 합친다", () => {
  const rows = [
    { id: "free-new", family_id: "free", created_at: "2026-08-01T10:00:00.000Z" },
    { id: "premium", family_id: "premium", created_at: "2026-08-01T11:00:00.000Z" },
    { id: "free-old", family_id: "free", created_at: "2026-08-01T09:00:00.000Z" },
  ];
  const annotated = annotateTierAlertActivationByFamily(
    rows,
    new Map([["free", 1], ["premium", null]]),
  );

  assert.deepEqual(annotated.map((row) => row.id), ["free-new", "premium", "free-old"]);
  assert.deepEqual(
    annotated.map((row) => [row.id, row.tier_alert_active]),
    [["free-new", false], ["premium", true], ["free-old", true]],
  );
});

test("부분 조회된 초과 항목도 가족 전체 정본 순서에서 비활성으로 유지한다", () => {
  const canonicalRows = [
    { id: "old", family_id: "free", created_at: "2026-08-01T09:00:00.000Z" },
    { id: "new", family_id: "free", created_at: "2026-08-01T10:00:00.000Z" },
  ];
  const selectedRows = [canonicalRows[1]];

  const annotated = annotateTierAlertActivationSelection(
    selectedRows,
    canonicalRows,
    new Map([["free", 1]]),
  );

  assert.equal(annotated[0].id, "new");
  assert.equal(annotated[0].tier_alert_active, false);
  assert.equal(annotated[0].tier_alert_inactive_reason, "premium_required");
});

test("장소·위험구역 조회와 위험구역 cron은 같은 서버 활성 상태를 사용한다", () => {
  const savedRoute = readFileSync(resolve(workerDir, "routes/saved-places.ts"), "utf8");
  const dangerRoute = readFileSync(resolve(workerDir, "routes/danger-zones.ts"), "utf8");
  const dangerCron = readFileSync(resolve(workerDir, "cron/danger-zone-geofence-check.ts"), "utf8");
  const restShim = readFileSync(resolve(workerDir, "routes/rest-shim-table.ts"), "utf8");

  assert.match(savedRoute, /annotateTierAlertActivation\(out, limit\)/);
  assert.match(dangerRoute, /annotateTierAlertActivation\(results \?\? \[\], limit\)/);
  assert.match(dangerCron, /loadPremiumFamilyIds/);
  assert.match(dangerCron, /annotateTierAlertActivation\(zones, limit\)/);
  assert.match(dangerCron, /filter\(\(zone\) => zone\.tier_alert_active\)/);
  assert.match(restShim, /table === "saved_places"/);
  assert.match(restShim, /serviceLimitForFamily/);
  assert.match(restShim, /annotateTierAlertActivationSelection/);
  assert.match(restShim, /SELECT id, family_id, created_at FROM saved_places WHERE family_id = \?/);
});
