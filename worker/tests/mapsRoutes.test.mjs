import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const mapsRoutes = (await import("../routes/maps.ts")).default;
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
  return { sqlite, db: new Db(sqlite) };
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
    const response = await post(db, "reverse", {
      familyId: "family-a", source: { kind: "saved_place", savedPlaceId: "place-a" },
    }, auth);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { policyProvider: "kakao", label: "학교 · 서울시 길 1", measuredAt: null });
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
