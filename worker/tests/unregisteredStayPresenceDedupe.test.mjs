// 미등록 체류 출발 중복 알림 회귀 (2026-07-29 TK 제보 실사고).
//
// 실사고 재현 — 부모가 "🚶 과천동 국립과천과학관 근처 출발"을 4건 받았다(11:45:55·11:46:00·
// 11:46:04·11:46:09 UTC). 원인은 child_stay_presence 의 grid_key 가 소수 4자리(≈11m)라
// 한 체류가 "37.2146,127.1007" / "37.2147,127.1007" 처럼 여러 행으로 갈렸고, 각 행이
// 자기 에피소드로 출발 알림을 발사한 것이다(멱등키에 gridKey 가 들어가 전부 통과).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  coarseStayAreaKey,
  findDuplicateStayAlert,
  readStayScopeFromMetadata,
  resolveUnregisteredStayDedupe,
  unregisteredStayKind,
  unregisteredStayMetadata,
  UNREGISTERED_STAY_DEDUPE_WINDOW_MS,
} from "../lib/unregisteredStayPresenceDedupe.ts";

const FAMILY_ID = "f9a75cb4-07e5-4597-b090-526e9ea4ab4e";
const CHILD_ID = "bdf4d72e-4463-4202-b7d7-41b031187579";
const TITLE = "🚶 과천동 국립과천과학관 근처 출발";
// 프로덕션 D1 child_stay_presence 실제 값 — 11m 차이로 갈린 같은 체류.
const GRID_A = "37.2146,127.1007";
const GRID_B = "37.2147,127.1007";
const NOW = Date.parse("2026-07-29T11:46:09Z");

function pgTs(ms) {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00");
}

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1Adapter {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}

function createDb(rows) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE parent_alerts(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT,
      alert_type TEXT NOT NULL,
      title TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO parent_alerts(id, family_id, child_user_id, alert_type, title, metadata, created_at) VALUES (?,?,?,?,?,?,?)",
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.familyId ?? FAMILY_ID,
      row.childUserId ?? CHILD_ID,
      row.alertType,
      row.title ?? TITLE,
      row.metadata == null ? null : JSON.stringify(row.metadata),
      pgTs(row.createdAtMs),
    );
  }
  return new D1Adapter(sqlite);
}

test("11m 갈린 grid_key 는 같은 거친 지역키로 접힌다", () => {
  assert.equal(coarseStayAreaKey(GRID_A), "37.215,127.101");
  assert.equal(coarseStayAreaKey(GRID_B), "37.215,127.101");
  assert.equal(coarseStayAreaKey(GRID_A), coarseStayAreaKey(GRID_B));
  // 110m 이상 떨어진 다른 장소는 접히지 않는다.
  assert.notEqual(coarseStayAreaKey("37.2304,127.0682"), coarseStayAreaKey(GRID_A));
  assert.equal(coarseStayAreaKey("bad"), null);
  assert.equal(coarseStayAreaKey(""), null);
});

test("체류 알림 종류와 metadata 스코프를 정확히 읽는다", () => {
  assert.equal(unregisteredStayKind("unregistered_stay"), "arrived");
  assert.equal(unregisteredStayKind("unregistered_stay_left"), "left");
  assert.equal(unregisteredStayKind("place_left"), null);
  const meta = unregisteredStayMetadata("37.215,127.101", "left");
  assert.deepEqual(readStayScopeFromMetadata(meta), { areaKey: "37.215,127.101", kind: "left" });
  assert.deepEqual(readStayScopeFromMetadata(JSON.stringify(meta)), { areaKey: "37.215,127.101", kind: "left" });
  assert.equal(readStayScopeFromMetadata(null), null);
  assert.equal(readStayScopeFromMetadata("{"), null);
  assert.equal(readStayScopeFromMetadata({ stayAreaKey: "x" }), null);
});

test("같은 지역·같은 종류의 창 안 알림을 중복으로 판정한다", () => {
  const rows = [
    { id: "a1", alert_type: "unregistered_stay_left", title: TITLE, metadata: unregisteredStayMetadata("37.215,127.101", "left") },
  ];
  assert.equal(findDuplicateStayAlert({ rows, areaKey: "37.215,127.101", kind: "left", title: TITLE }), "a1");
  // 다른 지역·다른 종류는 통과.
  assert.equal(findDuplicateStayAlert({ rows, areaKey: "37.230,127.068", kind: "left", title: TITLE }), null);
  assert.equal(findDuplicateStayAlert({ rows, areaKey: "37.215,127.101", kind: "arrived", title: TITLE }), null);
});

test("metadata 없는 구버전 행은 같은 제목으로 역산한다(앱 재배포 없이 중복 차단)", () => {
  const rows = [{ id: "legacy", alert_type: "unregistered_stay_left", title: TITLE, metadata: null }];
  assert.equal(findDuplicateStayAlert({ rows, areaKey: "37.215,127.101", kind: "left", title: TITLE }), "legacy");
  assert.equal(findDuplicateStayAlert({ rows, areaKey: "37.215,127.101", kind: "left", title: "🚶 다른 곳 출발" }), null);
});

test("프로덕션 실사고 재생: 두 번째 grid 의 출발 알림은 만들지 않는다", async () => {
  const db = createDb([
    {
      id: "cbdd1426-58db-434b-8d9e-49f96aa32777",
      alertType: "unregistered_stay_left",
      title: TITLE,
      metadata: { event_at: "2026-07-29 11:42:31.159+00", ...unregisteredStayMetadata("37.215,127.101", "left") },
      createdAtMs: Date.parse("2026-07-29T11:45:55Z"),
    },
  ]);
  const result = await resolveUnregisteredStayDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "unregistered_stay_left",
    gridKey: GRID_B,
    title: TITLE,
    nowMs: NOW,
  });
  assert.equal(result?.areaKey, "37.215,127.101");
  assert.equal(result?.kind, "left");
  assert.equal(result?.duplicateAlertId, "cbdd1426-58db-434b-8d9e-49f96aa32777");
});

test("쿨다운(10분)이 지난 뒤의 진짜 재출발은 다시 알린다", async () => {
  const db = createDb([
    {
      id: "old",
      alertType: "unregistered_stay_left",
      title: TITLE,
      metadata: unregisteredStayMetadata("37.215,127.101", "left"),
      createdAtMs: NOW - UNREGISTERED_STAY_DEDUPE_WINDOW_MS - 60_000,
    },
  ]);
  const result = await resolveUnregisteredStayDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "unregistered_stay_left",
    gridKey: GRID_A,
    title: TITLE,
    nowMs: NOW,
  });
  assert.equal(result?.duplicateAlertId, null);
});

test("체류 알림이 아니거나 지역을 특정할 수 없으면 fail-open 한다", async () => {
  const db = createDb([]);
  assert.equal(
    await resolveUnregisteredStayDedupe(db, {
      familyId: FAMILY_ID, childUserId: CHILD_ID, alertType: "place_left", gridKey: GRID_A, nowMs: NOW,
    }),
    null,
  );
  assert.equal(
    await resolveUnregisteredStayDedupe(db, {
      familyId: FAMILY_ID, childUserId: CHILD_ID, alertType: "unregistered_stay_left", gridKey: "", nowMs: NOW,
    }),
    null,
  );
});

test("cron 은 같은 패스에서 같은 지역의 출발을 한 번만 발사한다", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../cron/unregistered-stay-check.ts", import.meta.url), "utf8"));
  assert.match(source, /const firedDepartureAreas = new Set<string>\(\)/);
  assert.match(source, /if \(firedDepartureAreas\.has\(firedKey\)\)/);
  assert.match(source, /stayGridKey: state\.gridKey/);
  const deliver = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8"));
  assert.match(deliver, /resolveUnregisteredStayDedupe/);
  assert.match(deliver, /gridKey: args\.stayGridKey \?\? null/);
});
