import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import "./helpers/tsModuleResolve.mjs";
import { decideLinkTransition, shouldAutoWakeForStaleAge } from "../shared/locationStaleness.js";
const { expireSupersededLocationLinkNotifications } = await import("../lib/locationLinkNotifications.ts");
const { parentAlertPendingTtlMs } = await import("../lib/notificationRouting.ts");

test("등록장소의 19분 끊김은 먼저 복구하고 20분 초과 지속할 때 경고한다", () => {
  const transition = (minutes) => decideLinkTransition({ ageMs: minutes * 60_000, reason: "power_save" });
  assert.equal(shouldAutoWakeForStaleAge(10.3 * 60_000), true);
  assert.equal(shouldAutoWakeForStaleAge(15.3 * 60_000), true);
  assert.equal(transition(19).action, "none");
  assert.equal(transition(20).action, "none");
  assert.equal(transition(20.1).action, "alert");
  assert.equal(transition(95).action, "alert");
});

test("전원·배터리·미등록 장소의 경고는 기존 10분을 유지한다", () => {
  for (const reason of ["power_off", "device_off", "unstable", "unknown"]) {
    assert.equal(decideLinkTransition({ ageMs: 10 * 60_000, reason }).action, "none");
    assert.equal(decideLinkTransition({ ageMs: 10.1 * 60_000, reason }).action, "alert");
  }
});

test("경고 이후 회복은 새 실측이 와야 판정하며 10~20분 된 fix로 회복을 꾸미지 않는다", () => {
  const state = { currentState: "stale", reason: "power_save" };
  assert.equal(decideLinkTransition({ ...state, ageMs: 19 * 60_000 }).action, "none");
  assert.equal(decideLinkTransition({ ...state, ageMs: 1 * 60_000 }).action, "recover");
});

test("반복 경고 유예도 30분 지속 또는 전원 이상이면 경고로 전환한다", () => {
  const state = { currentState: "stale", notified: false, reason: "power_save" };
  assert.equal(decideLinkTransition({ ...state, ageMs: 25 * 60_000 }).action, "none");
  assert.equal(decideLinkTransition({ ...state, ageMs: 30.1 * 60_000 }).action, "alert");
  assert.equal(decideLinkTransition({ ...state, reason: "power_off", ageMs: 25 * 60_000 }).action, "alert");
});

test("연결 상태 알림은 10분만 표시하고 다른 안전 알림의 TTL은 유지한다", () => {
  assert.equal(parentAlertPendingTtlMs("location_stale"), 10 * 60_000);
  assert.equal(parentAlertPendingTtlMs("location_recovered"), 10 * 60_000);
  assert.equal(parentAlertPendingTtlMs("sos"), 5 * 60_000);
  assert.equal(parentAlertPendingTtlMs("danger_zone"), 15 * 60_000);
  assert.equal(parentAlertPendingTtlMs("not_arrived"), 30 * 60_000);
  assert.equal(parentAlertPendingTtlMs("place_left"), 30 * 60_000);
});

test("회복 시 같은 아이의 미전달 끊김만 만료하고 이력·다른 아이·표시 ACK는 보존한다", async () => {
  const sql = new DatabaseSync(":memory:");
  try {
    sql.exec(`CREATE TABLE parent_alerts(id TEXT,family_id TEXT,child_user_id TEXT,alert_type TEXT);
      CREATE TABLE pending_notifications(id TEXT,family_id TEXT,delivered INTEGER,data TEXT,expires_at TEXT);`);
    const later = "2026-09-13T10:00:00.000Z";
    const rows = [
      ["stale", "family", "child", "location_stale", 0],
      ["sibling", "family", "sibling", "location_stale", 0],
      ["foreign", "another", "child", "location_stale", 0],
      ["shown", "family", "child", "location_stale", 1],
      ["sos", "family", "child", "sos", 0],
      ["recovered", "family", "child", "location_recovered", 0],
    ];
    for (const [id, family, child, type, delivered] of rows) {
      sql.prepare("INSERT INTO parent_alerts VALUES(?,?,?,?)").run(id, family, child, type);
      sql.prepare("INSERT INTO pending_notifications VALUES(?,?,?,?,?)").run(id, family, delivered, JSON.stringify({ alertId: id }), later);
    }
    sql.prepare("INSERT INTO pending_notifications VALUES(?,?,?,?,?)").run("invalid", "family", 0, "bad-json", later);
    const db = { prepare(query) { return { bind(...args) { return { async run() { return sql.prepare(query).run(...args); } }; } }; } };
    await expireSupersededLocationLinkNotifications(db, {
      familyId: "family", childUserId: "child", nextState: "connected", nowMs: Date.parse("2026-09-13T09:00:00Z"),
    });
    const pending = sql.prepare("SELECT id,expires_at,delivered FROM pending_notifications").all();
    assert.match(pending.find(row => row.id === "stale").expires_at, /^2026-09-13 09:00:00/);
    assert.equal(pending.find(row => row.id === "stale").delivered, 0);
    assert.ok(pending.filter(row => row.id !== "stale").every(row => row.expires_at === later));
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM parent_alerts").get().n, rows.length);
    await expireSupersededLocationLinkNotifications(db, {
      familyId: "family", childUserId: "child", nextState: "stale", nowMs: Date.parse("2026-09-13T09:05:00Z"),
    });
    assert.match(sql.prepare("SELECT expires_at FROM pending_notifications WHERE id='recovered'").get().expires_at, /^2026-09-13 09:05:00/);
  } finally { sql.close(); }
});
