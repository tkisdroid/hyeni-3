// 등록장소 도착·출발 중복 알림 회귀 (2026-07-24 TK 제보 실사고).
//
// 실사고 재현 데이터 — 자녀 혜니(bdf4d72e…)의 "집"(saved_place e716b5d9…)에 대해
// 부모가 같은 아침에 도착 2건·출발 2건을 받았다. 네이티브와 서버 cron 이 같은 방문을
// 각자 평가했고 episode 시각이 10분 버킷 경계를 사이에 두고 갈려 멱등키가 달라졌다.
// 아래 event_id 는 프로덕션 D1 push_idempotency 에서 그대로 가져온 실제 값이다.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  buildRegisteredPlacePresenceKeyIndex,
  findDuplicatePresenceAlert,
  readPresenceScopeFromMetadata,
  registeredPlacePresenceKind,
  registeredPlacePresenceMetadata,
  resolveRegisteredPlacePresenceDedupe,
  REGISTERED_PLACE_PRESENCE_DEDUPE_WINDOW_MS,
} from "../lib/registeredPlacePresenceDedupe.ts";

const FAMILY_ID = "f9a75cb4-07e5-4597-b090-526e9ea4ab4e";
const CHILD_ID = "bdf4d72e-4463-4202-b7d7-41b031187579";
const HOME_ID = "e716b5d9-3789-4e78-9081-d15316f2800e";
const SCHOOL_ID = "ed4ddc7b-66a7-4fd0-8817-4080c12381b4";
const HOME_KEY = `registered:saved_place:${HOME_ID}`;
const SCHOOL_KEY = `registered:saved_place:${SCHOOL_ID}`;

// 프로덕션 실제 값 — 같은 방문인데 버킷이 갈린 두 멱등키.
const ARRIVED_NATIVE = "dad31855-41b4-4e62-be47-97f4800b84c7"; // episode 07:20~07:30 KST
const ARRIVED_CRON = "0112ea55-3262-400e-8d24-7bf5bd65cdaf"; // episode 07:10~07:20 KST
const LEFT_NATIVE = "a7cdd084-2e1b-4b46-a3f7-53a64ca0a580"; // episode 08:20~08:30 KST
const LEFT_CRON = "5bbca6b6-1368-4d52-8186-ec871ea59ed4"; // episode 08:30~08:40 KST
const SCHOOL_ARRIVED = "cdbfbb06-2df4-42d0-a03d-40857a51bc7a";

const ARRIVED_NATIVE_AT = Date.parse("2026-07-23T22:24:04.246Z");
const ARRIVED_CRON_AT = Date.parse("2026-07-23T22:26:18.233Z");
const LEFT_NATIVE_AT = Date.parse("2026-07-23T23:30:19.314Z");
const LEFT_CRON_AT = Date.parse("2026-07-23T23:32:55.012Z");

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

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE parent_alerts(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      title TEXT,
      message TEXT,
      severity TEXT,
      event_id TEXT,
      child_user_id TEXT,
      metadata TEXT,
      created_at TEXT
    );
    CREATE TABLE saved_places(id TEXT PRIMARY KEY, family_id TEXT NOT NULL, name TEXT, location TEXT);
    CREATE TABLE academies(id TEXT PRIMARY KEY, family_id TEXT NOT NULL, name TEXT, location TEXT);
  `);
  sqlite.prepare("INSERT INTO saved_places(id,family_id,name,location) VALUES (?,?,?,?)")
    .run(HOME_ID, FAMILY_ID, "집", "{}");
  sqlite.prepare("INSERT INTO saved_places(id,family_id,name,location) VALUES (?,?,?,?)")
    .run(SCHOOL_ID, FAMILY_ID, "학교", "{}");
  return { sqlite, db: new D1Adapter(sqlite) };
}

function insertAlert(sqlite, { id, alertType, eventId, atMs, metadata = null }) {
  sqlite.prepare(
    `INSERT INTO parent_alerts(id,family_id,alert_type,title,message,severity,event_id,child_user_id,metadata,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, FAMILY_ID, alertType, "제목", "내용", "info", eventId, CHILD_ID,
    metadata ? JSON.stringify(metadata) : null, pgTs(atMs),
  );
}

test("place_arrived/place_left 만 장소 쿨다운 dedup 대상이다", () => {
  assert.equal(registeredPlacePresenceKind("place_arrived"), "arrived");
  assert.equal(registeredPlacePresenceKind("place_left"), "left");
  // 일정 도착은 occurrence id 로 이미 정확히 dedup 되므로 이 경로가 건드리면 안 된다.
  assert.equal(registeredPlacePresenceKind("arrived"), null);
  assert.equal(registeredPlacePresenceKind("not_arrived"), null);
  assert.equal(registeredPlacePresenceKind("sos"), null);
});

test("실사고 재현: 버킷이 갈린 네이티브·cron 도착 알림을 한 건으로 합친다", async () => {
  const { sqlite, db } = createDb();
  // 네이티브가 먼저 발사한 실제 알림(구버전이라 metadata 없음).
  insertAlert(sqlite, {
    id: "alert-native-arrived",
    alertType: "place_arrived",
    eventId: ARRIVED_NATIVE,
    atMs: ARRIVED_NATIVE_AT,
  });

  // 2분 뒤 서버 cron 이 같은 방문을 다른 episode 버킷으로 판정해 들어온다.
  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_arrived",
    eventId: ARRIVED_CRON,
    placeKey: HOME_KEY,
    nowMs: ARRIVED_CRON_AT,
  });

  assert.equal(decision?.placeKey, HOME_KEY);
  assert.equal(decision?.kind, "arrived");
  assert.equal(
    decision?.duplicateAlertId,
    "alert-native-arrived",
    "같은 방문의 두 번째 도착 알림은 기존 알림으로 합쳐져야 합니다",
  );
  sqlite.close();
});

test("실사고 재현: 출발 알림도 버킷이 갈려도 한 건으로 합친다", async () => {
  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-native-left",
    alertType: "place_left",
    eventId: LEFT_NATIVE,
    atMs: LEFT_NATIVE_AT,
  });

  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_left",
    eventId: LEFT_CRON,
    placeKey: HOME_KEY,
    nowMs: LEFT_CRON_AT,
  });

  assert.equal(decision?.duplicateAlertId, "alert-native-left");
  sqlite.close();
});

test("place_key 를 안 보내는 구버전 앱도 event_id 역산으로 dedup 된다", async () => {
  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-native-arrived",
    alertType: "place_arrived",
    eventId: ARRIVED_NATIVE,
    atMs: ARRIVED_NATIVE_AT,
  });

  // placeKey 미전달 — 서버가 event_id 를 (placeKey, bucket) 후보와 대조해 역산해야 한다.
  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_arrived",
    eventId: ARRIVED_CRON,
    placeKey: null,
    nowMs: ARRIVED_CRON_AT,
  });

  assert.equal(decision?.placeKey, HOME_KEY, "event_id 로 장소를 역산해야 합니다");
  assert.equal(decision?.duplicateAlertId, "alert-native-arrived");
  sqlite.close();
});

test("다른 장소 도착은 중복이 아니다", async () => {
  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-home-arrived",
    alertType: "place_arrived",
    eventId: ARRIVED_NATIVE,
    atMs: ARRIVED_NATIVE_AT,
  });

  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_arrived",
    eventId: SCHOOL_ARRIVED,
    placeKey: SCHOOL_KEY,
    nowMs: ARRIVED_CRON_AT,
  });

  assert.equal(decision?.placeKey, SCHOOL_KEY);
  assert.equal(decision?.duplicateAlertId, null, "학교 도착은 집 도착과 별개 알림입니다");
  sqlite.close();
});

test("같은 장소라도 도착 직후 출발은 중복이 아니다", async () => {
  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-home-arrived",
    alertType: "place_arrived",
    eventId: ARRIVED_NATIVE,
    atMs: ARRIVED_NATIVE_AT,
  });

  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_left",
    eventId: LEFT_NATIVE,
    placeKey: HOME_KEY,
    nowMs: ARRIVED_NATIVE_AT + 60_000,
  });

  assert.equal(decision?.duplicateAlertId, null, "도착과 출발은 서로를 억제하면 안 됩니다");
  sqlite.close();
});

test("쿨다운 창을 넘긴 진짜 재방문은 다시 알린다", async () => {
  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-home-arrived",
    alertType: "place_arrived",
    eventId: ARRIVED_NATIVE,
    atMs: ARRIVED_NATIVE_AT,
  });

  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_arrived",
    eventId: SCHOOL_ARRIVED, // 역산 실패해도 명시 placeKey 로 판정
    placeKey: HOME_KEY,
    nowMs: ARRIVED_NATIVE_AT + REGISTERED_PLACE_PRESENCE_DEDUPE_WINDOW_MS + 1_000,
  });

  assert.equal(decision?.duplicateAlertId, null, "10분 창 밖 재도착은 정상 알림입니다");
  sqlite.close();
});

test("신규 알림 metadata 는 역산 없이 장소 스코프를 알려준다", async () => {
  const scope = readPresenceScopeFromMetadata(
    JSON.stringify(registeredPlacePresenceMetadata(HOME_KEY, "left")),
  );
  assert.deepEqual(scope, { placeKey: HOME_KEY, kind: "left" });
  assert.equal(readPresenceScopeFromMetadata(null), null);
  assert.equal(readPresenceScopeFromMetadata("{"), null);
  assert.equal(readPresenceScopeFromMetadata({ placeKey: HOME_KEY }), null, "kind 없는 metadata 는 무시합니다");

  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-native-left",
    alertType: "place_left",
    eventId: "not-a-geofence-key",
    atMs: LEFT_NATIVE_AT,
    metadata: registeredPlacePresenceMetadata(HOME_KEY, "left"),
  });

  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_left",
    eventId: LEFT_CRON,
    placeKey: HOME_KEY,
    nowMs: LEFT_CRON_AT,
  });
  assert.equal(decision?.duplicateAlertId, "alert-native-left");
  sqlite.close();
});

test("장소를 특정할 수 없으면 알림을 막지 않는다(fail-open)", async () => {
  const { sqlite, db } = createDb();
  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_arrived",
    eventId: "00000000-0000-4000-8000-000000000000",
    placeKey: null,
    nowMs: ARRIVED_CRON_AT,
  });
  assert.equal(decision, null, "장소 미상은 dedup 을 건너뛰고 기존 경로로 보내야 합니다");
  sqlite.close();
});

test("역산 인덱스는 두 평가자의 서로 다른 episode 버킷을 모두 같은 장소로 되돌린다", () => {
  // 인덱스는 판정 시각 기준 최근 창만 덮는다(비용 상한). dedup 창이 10분이고 그 안의
  // 행이 갖는 episode 는 길어야 그보다 10여 분 이르므로 기본 lookback 45분이면 넉넉하다.
  const atArrival = buildRegisteredPlacePresenceKeyIndex({
    childUserId: CHILD_ID,
    placeKeys: [HOME_KEY, SCHOOL_KEY],
    nowMs: ARRIVED_CRON_AT,
  });
  assert.deepEqual(atArrival.get(ARRIVED_NATIVE), { placeKey: HOME_KEY, kind: "arrived" });
  assert.deepEqual(atArrival.get(ARRIVED_CRON), { placeKey: HOME_KEY, kind: "arrived" });

  const atDeparture = buildRegisteredPlacePresenceKeyIndex({
    childUserId: CHILD_ID,
    placeKeys: [HOME_KEY, SCHOOL_KEY],
    nowMs: LEFT_CRON_AT,
  });
  assert.deepEqual(atDeparture.get(LEFT_NATIVE), { placeKey: HOME_KEY, kind: "left" });
  assert.deepEqual(atDeparture.get(LEFT_CRON), { placeKey: HOME_KEY, kind: "left" });
  assert.deepEqual(atDeparture.get(SCHOOL_ARRIVED), { placeKey: SCHOOL_KEY, kind: "arrived" });

  // 창 밖의 오래된 episode 는 인덱스에 없다 — 그 경우 metadata 또는 명시 place_key 로 판정한다.
  assert.equal(atDeparture.get(ARRIVED_NATIVE), undefined);
});

test("alert_type 과 metadata kind 가 어긋난 행은 중복 판정에 쓰지 않는다", () => {
  const duplicate = findDuplicatePresenceAlert({
    rows: [{
      id: "corrupt",
      alert_type: "place_arrived",
      event_id: null,
      metadata: JSON.stringify(registeredPlacePresenceMetadata(HOME_KEY, "left")),
    }],
    placeKey: HOME_KEY,
    kind: "left",
    keyIndex: new Map(),
  });
  assert.equal(duplicate, null);
});

test("자녀 기기가 보낸 place_key 는 이 가족의 실제 등록장소일 때만 신뢰한다", async () => {
  const { sqlite, db } = createDb();
  insertAlert(sqlite, {
    id: "alert-native-arrived",
    alertType: "place_arrived",
    eventId: ARRIVED_NATIVE,
    atMs: ARRIVED_NATIVE_AT,
  });

  // 이 가족에 없는 장소 키를 보냈다 — 그대로 스코프로 쓰면 엉뚱한 dedup 이 된다.
  // 무시하고 event_id 역산으로 되돌아가 정상 판정해야 한다.
  const decision = await resolveRegisteredPlacePresenceDedupe(db, {
    familyId: FAMILY_ID,
    childUserId: CHILD_ID,
    alertType: "place_arrived",
    eventId: ARRIVED_CRON,
    placeKey: "registered:saved_place:99999999-9999-4999-8999-999999999999",
    nowMs: ARRIVED_CRON_AT,
  });

  assert.equal(decision?.placeKey, HOME_KEY, "위조된 place_key 대신 역산 결과를 써야 합니다");
  assert.equal(decision?.duplicateAlertId, "alert-native-arrived");
  sqlite.close();
});
