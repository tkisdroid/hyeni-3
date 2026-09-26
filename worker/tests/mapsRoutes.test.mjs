import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const mapsRoutes = (await import("../routes/maps.ts")).default;
const { standardLocationHistoryWindow } = await import("../routes/location.ts");
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO users(id,is_anonymous) VALUES ('parent-a',0),('child-a',0),('teacher-a',0),('parent-b',0),('child-b',0);
    INSERT INTO families(id,parent_id,pair_code,country_code) VALUES
      ('family-a','parent-a','KID-AAAA0000','KR'),('family-b','parent-b','KID-BBBB0000','KR');
    INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES
      ('member-parent-a','family-a','parent-a','parent','부모',1),
      ('member-child-a','family-a','child-a','child','아이',1),
      ('member-parent-b','family-b','parent-b','parent','다른 부모',1),
      ('member-child-b','family-b','child-b','child','다른 아이',1);
    INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at) VALUES
      ('child-a','family-a',37.5,127.0,'2020-09-01T00:00:00.000Z'),
      ('child-b','family-b',35.1,129.0,'2026-09-01T00:00:00.000Z');
    INSERT INTO saved_places(id,family_id,name,location) VALUES
      ('place-a','family-a','학교','{"lat":37.51,"lng":127.01}'),
      ('place-b','family-b','다른 학교','{"lat":35.2,"lng":129.1}');
  `);
  sqlite.prepare("INSERT INTO family_subscription(family_id,status,product_id,qonversion_user_id,current_period_end) VALUES (?,?,?,?,?)")
    .run("family-a", "active", "test-premium", "test-parent", new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString());
  return { sqlite, db: new Db(sqlite) };
}

function addHistory(sqlite, atMs, options = {}) {
  const recordedAt = new Date(atMs).toISOString().replace("T", " ").replace("Z", "+00");
  sqlite.prepare("INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,accuracy_m,is_estimated) VALUES(?,?,?,?,?,?,?)")
    .run(options.child ?? "child-a", "family-a", options.lat ?? 37.51, options.lng ?? 127.01, recordedAt, 12, options.estimated ?? 0);
  return recordedAt;
}

async function authorization(sub, familyId, role = "parent") {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function env(db, overrides = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    MAPS_SESSION_HMAC_SECRET: "maps-route-session-secret-with-32-bytes",
    KAKAO_REST_KEY: "kakao-key",
    ...overrides,
  };
}

const app = new Hono();
app.route("/api/maps", mapsRoutes);

async function post(db, path, body, auth, overrides) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return app.request(`http://test.local/api/maps/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, env(db, overrides));
}

test("지도 API는 인증·교사·가족 권한을 upstream보다 먼저 막고 no-store를 강제한다", async () => {
  const { sqlite, db } = fixture();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("호출되면 안 됨"); };
  try {
    const missing = await post(db, "reverse", { familyId: "family-a", source: { kind: "picker_pin", lat: 37.5, lng: 127 } });
    assert.equal(missing.status, 401);
    const teacher = await post(
      db,
      "reverse",
      { familyId: "family-a", source: { kind: "picker_pin", lat: 37.5, lng: 127 } },
      await authorization("teacher-a", null, "teacher"),
    );
    assert.equal(teacher.status, 403);
    const foreign = await post(
      db,
      "reverse",
      { familyId: "family-a", source: { kind: "child_location", childUserId: "child-b" } },
      await authorization("parent-a", "family-a"),
    );
    assert.equal(foreign.status, 404);
    assert.equal(foreign.headers.get("cache-control"), "private, no-store");
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("body country 위조를 무시하고 ZZ·저장 불가 지역은 upstream을 호출하지 않는다", async () => {
  const { sqlite, db } = fixture();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("호출되면 안 됨"); };
  try {
    for (const country of ["ZZ", "AC"]) {
      sqlite.prepare("UPDATE families SET country_code=? WHERE id='family-a'").run(country);
      const response = await post(
        db,
        "search",
        { familyId: "family-a", countryCode: "KR", action: "start" },
        await authorization("parent-a", "family-a"),
      );
      assert.equal(response.status, 409, country);
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("KR 검색 start→query→select는 공통 응답과 1회 handle 계약을 지킨다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /dapi\.kakao\.com\/v2\/local\/search\/keyword\.json/);
    return Response.json({ documents: [{ id: "place-1", place_name: "도서관", address_name: "서울", x: "127.02", y: "37.52" }] });
  };
  try {
    const auth = await authorization("parent-a", "family-a");
    const start = await post(db, "search", { familyId: "family-a", action: "start" }, auth);
    assert.equal(start.status, 200);
    const started = await start.json();
    assert.equal(started.provider, "kakao");
    const query = await post(db, "search", {
      familyId: "family-a", action: "query", sessionHandle: started.sessionHandle, query: "도서관", locale: "ko",
    }, auth);
    assert.equal(query.status, 200);
    assert.deepEqual((await query.json()).candidates[0], {
      provider: "kakao", providerPlaceId: "place-1", primaryText: "도서관", secondaryText: "서울",
    });
    const selected = await post(db, "search", {
      familyId: "family-a", action: "select", sessionHandle: started.sessionHandle, providerPlaceId: "place-1",
    }, auth);
    assert.equal(selected.status, 200);
    assert.deepEqual((await selected.json()).point, { lat: 37.52, lng: 127.02 });
    const reused = await post(db, "search", {
      familyId: "family-a", action: "select", sessionHandle: started.sessionHandle, providerPlaceId: "place-1",
    }, auth);
    assert.equal(reused.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("reverse raw 좌표 경계와 object ref 소유권을 검증한 뒤 Kakao 주소를 공통 응답으로 바꾼다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ documents: [{ road_address: { address_name: "서울시 길 1", building_name: "학교" }, address: null }] });
  try {
    const auth = await authorization("parent-a", "family-a");
    const invalid = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "picker_pin", lat: 37.12345678, lng: 127 },
    }, auth);
    assert.equal(invalid.status, 400);
    // 2026-09-26: `value*1e7` 오차로 경도 130대의 올바른 7자리 좌표(울릉도)까지 거부하던 회귀.
    const sevenDigits = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "picker_pin", lat: 37.4842, lng: 130.958332 },
    }, auth);
    assert.equal(sevenDigits.status, 200);
    const response = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "saved_place", savedPlaceId: "place-a" },
    }, auth);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { policyProvider: "kakao", label: "학교", measuredAt: null });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("directions는 object ref만 받고 실제 routeSource를 보존하며 stale 최신 위치를 거부한다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("kakaomobility")) {
      return Response.json({ routes: [{ summary: { distance: 1234, duration: 900 }, sections: [{ roads: [{ vertexes: [127, 37.5, 127.01, 37.51] }] }] }] });
    }
    return new Response(null, { status: 503 });
  };
  try {
    const auth = await authorization("parent-a", "family-a");
    const stale = await post(db, "directions", {
      familyId: "family-a",
      origin: { kind: "child_location", childUserId: "child-a" },
      destination: { kind: "saved_place", savedPlaceId: "place-a" },
    }, auth);
    assert.equal(stale.status, 409);

    sqlite.prepare("UPDATE child_locations SET updated_at=? WHERE user_id='child-a'").run(new Date().toISOString());
    const response = await post(db, "directions", {
      familyId: "family-a",
      origin: { kind: "child_location", childUserId: "child-a" },
      destination: { kind: "saved_place", savedPlaceId: "place-a" },
    }, auth);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.policyProvider, "kakao");
    assert.equal(body.routeSource, "kakao");
    assert.equal(body.distanceMeters, 1234);
    assert.deepEqual(body.points, [{ lat: 37.5, lng: 127 }, { lat: 37.51, lng: 127.01 }]);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("지도 전용 secret이나 quota DB가 없으면 provider fetch 전에 503으로 닫는다", async () => {
  const { sqlite, db } = fixture();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("호출되면 안 됨"); };
  try {
    const response = await post(
      db,
      "search",
      { familyId: "family-a", action: "start" },
      await authorization("parent-a", "family-a"),
      { MAPS_SESSION_HMAC_SECRET: "" },
    );
    assert.equal(response.status, 503);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("과거 도착지 라벨은 요청한 실측 시각으로 조회하고 누락된 과거 점을 최신 위치로 바꾸지 않는다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    calls.push(url);
    return Response.json({ documents: [{ road_address: { building_name: "당시 문화센터" } }] });
  };
  try {
    const now = Date.now();
    const recordedAt = addHistory(sqlite, now - 60 * 60_000);
    sqlite.prepare("UPDATE child_locations SET lat=37.6,lng=127.2,updated_at=? WHERE user_id='child-a'").run(new Date(now).toISOString());
    const auth = await authorization("parent-a", "family-a");
    const result = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "child_location", childUserId: "child-a", recordedAt }, locale: "ko",
    }, auth);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { policyProvider: "kakao", label: "당시 문화센터", measuredAt: recordedAt });
    assert.equal(calls[0].searchParams.get("x"), "127.01");
    assert.equal(calls[0].searchParams.get("y"), "37.51");
    const missing = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "child_location", childUserId: "child-a", recordedAt: new Date(now - 30 * 60_000).toISOString() },
    }, auth);
    assert.equal(missing.status, 404);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("현재 실측과 정확히 일치하면 이력 저장 전에도 해당 장소명을 반환한다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ documents: [{ road_address: { building_name: "지금 도서관" } }] });
  try {
    const at = new Date(Date.now() - 1_000).toISOString();
    sqlite.prepare("UPDATE child_locations SET updated_at=? WHERE user_id='child-a'").run(at);
    const result = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "child_location", childUserId: "child-a", recordedAt: at },
    }, await authorization("parent-a", "family-a"));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).measuredAt, at);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("지도 이름 조회에도 본인 아이 범위·프리미엄 30일·무료 오늘 이력 경계를 적용한다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ documents: [{ road_address: { building_name: "도서관" } }] }); };
  try {
    const now = Date.now();
    const ancient = addHistory(sqlite, now - 31 * 24 * 60 * 60_000);
    const yesterday = addHistory(sqlite, now - 2 * 24 * 60 * 60_000);
    // 무료 현재 위치가 이틀 전 점을 마지막 확인점으로 선택하지 않도록 최근 자동 스냅샷도 둔다.
    addHistory(sqlite, now - 15 * 60_000);
    const todayAt = Math.max(standardLocationHistoryWindow(now).startMs + 1, now - 1_000);
    const today = addHistory(sqlite, todayAt);
    const estimated = addHistory(sqlite, todayAt - 10, { estimated: 1 });
    const auth = await authorization("parent-a", "family-a");
    const reverse = (recordedAt, caller = auth) => post(db, "reverse", {
      familyId: "family-a", source: { kind: "child_location", childUserId: "child-a", recordedAt },
    }, caller);
    assert.equal((await reverse(ancient)).status, 404);
    assert.equal((await reverse(estimated)).status, 404);
    assert.equal((await reverse(today, await authorization("child-a", "family-a", "child"))).status, 404);
    sqlite.prepare("DELETE FROM family_subscription WHERE family_id='family-a'").run();
    assert.equal((await reverse(yesterday)).status, 404);
    assert.equal(calls, 0);
    assert.equal((await reverse(today)).status, 200);
    assert.equal(calls, 1);
    sqlite.exec("INSERT INTO users(id,is_anonymous) VALUES('sibling',0); INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES('sibling-member','family-a','sibling','child','다른 아이',1)");
    const forbidden = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "child_location", childUserId: "sibling" },
    }, await authorization("child-a", "family-a", "child"));
    assert.equal(forbidden.status, 404);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("위치 권한 DB 장애에서는 지도 제공자에 좌표를 보내지 않는다", async () => {
  const { sqlite, db } = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("호출 금지"); };
  try {
    const broken = { prepare(sql) {
      if (/family_subscription|subscriptions/.test(sql)) throw new Error("격리 DB 장애");
      return db.prepare(sql);
    } };
    const result = await post(broken, "reverse", {
      familyId: "family-a", source: { kind: "child_location", childUserId: "child-a" },
    }, await authorization("parent-a", "family-a"));
    assert.equal(result.status, 503);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});
