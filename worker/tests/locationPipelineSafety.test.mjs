import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_LOCATION_UPSERT_SQL,
  LOCATION_FIX_MAX_AGE_MS,
  normalizeCurrentLocationFixTime,
  shouldReplaceCurrentLocation,
} from "../shared/currentLocation.js";
import { DatabaseSync } from "node:sqlite";
import {
  STALENESS_THRESHOLD_MS,
  episodeIdempotencyKey,
  shouldAutoWakeForStaleAge,
} from "../shared/locationStaleness.js";
import {
  buildUnregisteredStayLeftAlert,
  findConfirmedDepartureFix,
} from "../shared/unregisteredStay.js";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return readFileSync(resolve(workerDir, relativePath), "utf8");
}

test("현재 위치는 서버 수신 시각이 아니라 검증된 실제 fix 시각을 사용한다", () => {
  const nowMs = Date.parse("2026-07-12T14:20:00.000Z");
  const fix = normalizeCurrentLocationFixTime("2026-07-12T13:45:18.844Z", nowMs);

  assert.deepEqual(fix, {
    atMs: Date.parse("2026-07-12T13:45:18.844Z"),
    timestamp: "2026-07-12 13:45:18.844+00",
    explicit: true,
  });
  assert.equal(normalizeCurrentLocationFixTime("not-a-time", nowMs), null);
  assert.equal(normalizeCurrentLocationFixTime("2026-07-12T14:22:00.000Z", nowMs), null);
});

test("단말 wall-clock이 미래로 틀리면 경과시간으로 실제 fix 시각을 복구한다", () => {
  const nowMs = Date.parse("2026-07-12T14:20:00.000Z");
  assert.deepEqual(
    normalizeCurrentLocationFixTime("2026-07-12T17:20:00.000Z", nowMs, 2_300),
    {
      atMs: nowMs - 2_300,
      timestamp: "2026-07-12 14:19:57.700+00",
      explicit: true,
    },
  );
  assert.equal(normalizeCurrentLocationFixTime(null, nowMs, -1), null);
  assert.equal(normalizeCurrentLocationFixTime(null, nowMs, LOCATION_FIX_MAX_AGE_MS + 1), null);
});

test("정상 provider 시각은 느린 전송의 network delay로 앞으로 밀지 않는다", () => {
  const nowMs = Date.parse("2026-07-12T14:20:15.000Z");
  const fixAt = "2026-07-12T14:20:00.000Z";

  assert.deepEqual(normalizeCurrentLocationFixTime(fixAt, nowMs, 2_300), {
    atMs: Date.parse(fixAt),
    timestamp: "2026-07-12 14:20:00.000+00",
    explicit: true,
  });
});

test("늦게 끝난 오래된 업로드는 최신 현재 위치를 덮지 않는다", () => {
  assert.equal(
    shouldReplaceCurrentLocation(
      "2026-07-12 14:20:01.100+00",
      Date.parse("2026-07-12T14:20:00.900Z"),
    ),
    false,
  );
  assert.equal(
    shouldReplaceCurrentLocation(
      "2026-07-12 14:20:01.100+00",
      Date.parse("2026-07-12T14:20:01.101Z"),
    ),
    true,
  );
});

test("D1 단조 upsert SQL은 동시 지연을 가정해도 과거 좌표를 거부한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE child_locations(user_id TEXT PRIMARY KEY, family_id TEXT, lat REAL, lng REAL, updated_at TEXT, accuracy_m REAL)");
  const upsert = db.prepare(CURRENT_LOCATION_UPSERT_SQL);
  const write = (lat, at, accuracyM) => upsert.run(
    "child-1",
    "family-1",
    lat,
    127,
    at,
    accuracyM,
    at.slice(0, 23),
  );

  write(37.2, "2026-07-12 14:20:01.100+00", 18.5);
  write(36.9, "2026-07-12 14:20:00.900+00", 4.2);
  const preserved = db.prepare("SELECT lat,updated_at,accuracy_m FROM child_locations").get();
  assert.equal(preserved.lat, 37.2);
  assert.equal(preserved.updated_at, "2026-07-12 14:20:01.100+00");
  assert.equal(preserved.accuracy_m, 18.5);

  write(37.3, "2026-07-12 14:20:01.101+00", 7.25);
  const updated = db.prepare("SELECT lat,accuracy_m FROM child_locations").get();
  assert.equal(updated.lat, 37.3);
  assert.equal(updated.accuracy_m, 7.25);
  db.close();
});

test("자동 위치 깨우기는 초기에만 빠르게 시도하고 장기 무진전에는 15·30·60분으로 백오프한다", () => {
  const tickMs = 5 * 60_000;
  const sentAtMinutes = [];
  for (let ageMs = STALENESS_THRESHOLD_MS + tickMs; ageMs <= 6 * 60 * 60_000; ageMs += tickMs) {
    if (shouldAutoWakeForStaleAge(ageMs, tickMs)) sentAtMinutes.push(ageMs / 60_000);
  }

  assert.deepEqual(sentAtMinutes.slice(0, 3), [15, 20, 25]);
  assert.ok(sentAtMinutes.includes(30));
  assert.ok(sentAtMinutes.includes(90));
  assert.ok(sentAtMinutes.includes(240));
  assert.ok(sentAtMinutes.length <= 14, `6시간 자동 wake가 ${sentAtMinutes.length}회입니다`);
});

test("지연 출발은 마지막 체류 뒤 첫 실측 이탈 시각을 보존하고 늦은 알림임을 밝힌다", () => {
  const center = { lat: 37.5229, lng: 127.0238 };
  const points = [
    { lat: 37.5229, lng: 127.0238, recordedMs: Date.parse("2026-07-12T07:18:27Z"), isEstimated: false },
    { lat: 37.5150, lng: 127.0200, recordedMs: Date.parse("2026-07-12T07:24:00Z"), isEstimated: true },
    { lat: 37.5079, lng: 127.0162, recordedMs: Date.parse("2026-07-12T07:30:34Z"), isEstimated: false },
    { lat: 37.3322, lng: 127.1140, recordedMs: Date.parse("2026-07-12T13:45:18Z"), isEstimated: false },
  ];
  const confirmedAtMs = findConfirmedDepartureFix(points, center, 120)?.recordedMs ?? null;
  assert.equal(confirmedAtMs, Date.parse("2026-07-12T07:30:34Z"));

  const alert = buildUnregisteredStayLeftAlert("혜니", "신사동", {
    confirmedAtMs,
    detectedAtMs: Date.parse("2026-07-12T14:20:15Z"),
  });
  assert.match(alert.message, /오후 4시 30분경/);
  assert.match(alert.message, /늦게 확인/);
  assert.match(alert.title, /이전 출발 기록/);
  assert.doesNotMatch(alert.title, /^🚶/);
  assert.equal(alert.metadata?.delayed, true);
  assert.equal(alert.metadata?.event_at, "2026-07-12 07:30:34.000+00");
});

test("현재 위치·오늘 경로 서버 계약은 단조 시각, rowid 자동할당, 추정점 반환을 강제한다", () => {
  const rpc = source("routes/rest-shim-rpc.ts");
  const location = source("routes/location.ts");
  const current = source("shared/currentLocation.js");
  const accuracyMigration = source("db/child-locations-accuracy.sql");
  const historyAccuracyMigration = source("db/location-history-accuracy.sql");

  assert.match(rpc, /p_recorded_at/);
  assert.match(rpc, /p_fix_age_ms/);
  assert.match(rpc, /CURRENT_LOCATION_UPSERT_SQL/);
  assert.match(rpc, /accuracy_m: accuracyM/);
  assert.match(current, /ON CONFLICT\(user_id\) DO UPDATE/);
  assert.match(rpc, /shouldReplaceCurrentLocation/);
  assert.doesNotMatch(current, /strftime\('%s'/, "+00 timestamp를 strftime으로 파싱하면 NULL입니다");
  assert.doesNotMatch(rpc, /SELECT COALESCE\(MAX\(id\),0\) AS m FROM location_history/);
  assert.match(
    rpc,
    /INSERT INTO location_history \(user_id, family_id, lat, lng, accuracy_m, recorded_at, is_estimated\)/,
  );
  assert.match(rpc, /const accuracyRaw = r\.accuracy_m \?\? r\.accuracy/);
  assert.match(rpc, /n\.accuracyM,/);
  assert.match(rpc, /isReliableArrivalAccuracy\(accuracyM\)/);
  assert.match(
    rpc,
    /WHERE NOT EXISTS \([\s\S]*existing\.user_id = incoming\.user_id[\s\S]*existing\.recorded_at = incoming\.recorded_at/,
  );
  assert.match(location, /SELECT user_id, lat, lng, recorded_at, is_estimated/);
  assert.match(location, /SELECT cl\.user_id, cl\.lat, cl\.lng, cl\.updated_at, cl\.accuracy_m/);
  assert.match(current, /accuracy_m/);
  assert.match(accuracyMigration, /ALTER TABLE child_locations ADD COLUMN accuracy_m REAL/);
  assert.match(historyAccuracyMigration, /ALTER TABLE location_history ADD COLUMN accuracy_m REAL/);

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE child_locations(user_id TEXT PRIMARY KEY, family_id TEXT, lat REAL, lng REAL, updated_at TEXT)");
  db.prepare("INSERT INTO child_locations VALUES (?,?,?,?,?)").run(
    "child-1",
    "family-1",
    37.2,
    127.1,
    "2026-07-12 14:20:00.000+00",
  );
  db.exec(accuracyMigration);
  const migrated = db.prepare("SELECT user_id,accuracy_m FROM child_locations").get();
  assert.equal(migrated.user_id, "child-1");
  assert.equal(migrated.accuracy_m, null);
  db.close();

  const historyDb = new DatabaseSync(":memory:");
  historyDb.exec(
    "CREATE TABLE location_history(id INTEGER PRIMARY KEY, user_id TEXT, family_id TEXT, lat REAL, lng REAL, recorded_at TEXT, is_estimated INTEGER)",
  );
  historyDb.exec(historyAccuracyMigration);
  historyDb.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,accuracy_m,recorded_at,is_estimated) VALUES (?,?,?,?,?,?,?)",
  ).run("child-1", "family-1", 37.2, 127.1, 12.5, "2026-07-12 14:20:00.000+00", 0);
  const history = historyDb.prepare("SELECT accuracy_m FROM location_history").get();
  assert.equal(history.accuracy_m, 12.5);
  historyDb.close();
});

test("출발 근거 조회는 복합 인덱스 범위를 사용하고 추정점·고정 LIMIT 절단을 만들지 않는다", () => {
  const stayCron = source("cron/unregistered-stay-check.ts");
  const evidenceStart = stayCron.indexOf("async function loadDepartureEvidence");
  const evidenceEnd = stayCron.indexOf("// 진입 알림 후", evidenceStart);
  const evidence = stayCron.slice(evidenceStart, evidenceEnd);

  assert.match(evidence, /recorded_at >= \?/);
  assert.match(evidence, /recorded_at <= \?/);
  assert.match(evidence, /is_estimated = 0/);
  assert.match(evidence, /accuracy_m IS NOT NULL/);
  assert.match(evidence, /accuracy_m >= 0 AND accuracy_m <= \?/);
  assert.match(evidence, /LOCATION_EVIDENCE_MAX_ACCURACY_M/);
  assert.match(evidence, /ORDER BY recorded_at ASC, id ASC/);
  assert.doesNotMatch(evidence, /substr\(recorded_at/);
  assert.doesNotMatch(evidence, /LIMIT 5000/);
});

test("미등록 체류·출발은 등록장소와 같은 75m 이내 실측점만 근거로 사용한다", () => {
  const stayCron = source("cron/unregistered-stay-check.ts");
  const historyStart = stayCron.indexOf("async function loadHistory");
  const historyEnd = stayCron.indexOf("async function loadPresence", historyStart);
  const history = stayCron.slice(historyStart, historyEnd);
  const repeatedStart = stayCron.indexOf("async function repeatedDwellWeeks");
  const repeatedEnd = stayCron.indexOf("async function maybeDeliverScheduleSuggestion", repeatedStart);
  const repeated = stayCron.slice(repeatedStart, repeatedEnd);

  assert.match(stayCron, /SERVER_GEOFENCE_CONFIG/);
  assert.match(
    stayCron,
    /const LOCATION_EVIDENCE_MAX_ACCURACY_M = Number\(SERVER_GEOFENCE_CONFIG\.maxAccuracyM\)/,
  );
  assert.match(history, /SELECT user_id, family_id, lat, lng, recorded_at, accuracy_m FROM location_history/);
  assert.match(history, /is_estimated = 0/);
  assert.match(history, /accuracy_m IS NOT NULL/);
  assert.match(history, /accuracy_m >= 0 AND accuracy_m <= \?/);
  assert.match(history, /LOCATION_EVIDENCE_MAX_ACCURACY_M/);
  assert.match(repeated, /SELECT lat, lng, recorded_at, accuracy_m/);
  assert.match(repeated, /is_estimated = 0/);
  assert.match(repeated, /accuracy_m IS NOT NULL/);
  assert.match(repeated, /accuracy_m >= 0 AND accuracy_m <= \?/);
  assert.match(repeated, /LOCATION_EVIDENCE_MAX_ACCURACY_M/);
});

test("임의 장소 도착은 episode lease와 공통 durable 전달 경로로 중복·유실을 막는다", () => {
  const arrival = source("lib/arrivalDetect.ts");

  assert.match(arrival, /episodeIdempotencyKey/);
  assert.match(arrival, /INSERT OR IGNORE INTO push_idempotency/);
  assert.match(arrival, /idempotencyKey/);
  assert.match(arrival, /eventId: scheduleAssociation\?\.occurrenceId \?\? idempotencyKey/);
  assert.match(arrival, /first_sent_at IS NULL/);
  assert.match(arrival, /handleInstantNotification\(/);
  assert.match(arrival, /action: "parent_alert"/);
  assert.match(arrival, /idempotency_key: deliveryKey/);
  assert.match(arrival, /if \(!delivery\.ok\) return/);
  assert.match(arrival, /UPDATE push_idempotency SET first_sent_at=/);

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE push_idempotency(
    key TEXT PRIMARY KEY,
    created_at TEXT,
    first_sent_at TEXT,
    family_id TEXT,
    action TEXT
  )`);
  const key = episodeIdempotencyKey(
    "arbitrary_arrival",
    "child-1",
    "2026-07-12T06:11:04.000Z|first",
  );
  const claim = db.prepare(
    "INSERT OR IGNORE INTO push_idempotency(key,created_at,first_sent_at,family_id,action) VALUES (?,?,?,?,?)",
  );
  assert.equal(claim.run(key, "2026-07-12 06:16:11.450+00", null, "family-1", "arbitrary_arrival").changes, 1);
  assert.equal(claim.run(key, "2026-07-12 06:16:12.091+00", null, "family-1", "arbitrary_arrival").changes, 0);
  const retry = db.prepare(
    "UPDATE push_idempotency SET created_at=? WHERE key=? AND action='arbitrary_arrival' AND first_sent_at IS NULL AND created_at < ?",
  );
  assert.equal(retry.run("2026-07-12 06:17:00.000+00", key, "2026-07-12 06:14:00.000+00").changes, 0);
  db.prepare("UPDATE push_idempotency SET created_at='2026-07-12 06:10:00.000+00' WHERE key=?").run(key);
  assert.equal(retry.run("2026-07-12 06:17:00.000+00", key, "2026-07-12 06:15:00.000+00").changes, 1);
  db.prepare("UPDATE push_idempotency SET first_sent_at='2026-07-12 06:17:01.000+00' WHERE key=?").run(key);
  assert.equal(retry.run("2026-07-12 06:20:00.000+00", key, "2026-07-12 06:18:00.000+00").changes, 0);
  db.close();
});
