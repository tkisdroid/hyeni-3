import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

after(() => typeScriptResolutionHook.deregister());

const { loadRegisteredPlaceFamilyPolicies } = await import(
  pathToFileURL(resolve(workerDir, "cron/_geo.ts")).href
);
const { loadFamilyPlaces } = await import(
  pathToFileURL(resolve(workerDir, "cron/registered-place-geofence-check.ts")).href
);

class D1StatementAdapter {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free',
      registered_place_alerts_enabled INTEGER DEFAULT 1 NOT NULL
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      trial_ends_at TEXT,
      current_period_end TEXT
    );
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY,
      granted_at TEXT NOT NULL
    );
    CREATE TABLE saved_places(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE academies(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT,
      created_at TEXT NOT NULL
    );
  `);

  for (const [familyId, legacyTier, enabled] of [
    ["family-free", "free", 1],
    ["family-reviewed", "free", 1],
    ["family-premium", "free", 1],
    ["family-expired", "premium", 1],
    ["family-disabled", "premium", 0],
  ]) {
    sqlite.prepare(
      "INSERT INTO families(id,user_tier,subscription_tier,registered_place_alerts_enabled) VALUES (?,?,?,?)",
    ).run(familyId, legacyTier, legacyTier, enabled);
  }
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-07-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?)")
    .run("family-premium", "active", null, "2099-01-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?)")
    .run("family-expired", "expired", null, "2020-01-01T00:00:00.000Z");

  for (const familyId of [
    "family-free",
    "family-reviewed",
    "family-premium",
    "family-expired",
    "family-disabled",
  ]) {
    for (let index = 1; index <= 4; index += 1) {
      sqlite.prepare("INSERT INTO saved_places VALUES (?,?,?,?,?)").run(
        `${familyId}-saved-${index}`,
        familyId,
        `저장 ${index}`,
        JSON.stringify({ lat: 37 + index / 100, lng: 127 + index / 100 }),
        `2026-07-0${index}T00:00:00.000Z`,
      );
    }
    sqlite.prepare("INSERT INTO academies VALUES (?,?,?,?,?)").run(
      `${familyId}-academy`,
      familyId,
      "학원",
      JSON.stringify({ lat: 37.5, lng: 127.5 }),
      "2026-07-05T00:00:00.000Z",
    );
  }

  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

test("등록장소 가족 정책은 Free 2개·review grandfather 3개·Premium 무제한으로 판정한다", async () => {
  const { sqlite, db } = createDb();
  const policies = await loadRegisteredPlaceFamilyPolicies(db);
  assert.deepEqual(policies, [
    { familyId: "family-expired", isPremium: false, savedPlaceLimit: 2 },
    { familyId: "family-free", isPremium: false, savedPlaceLimit: 2 },
    { familyId: "family-premium", isPremium: true, savedPlaceLimit: null },
    { familyId: "family-reviewed", isPremium: false, savedPlaceLimit: 3 },
  ]);
  sqlite.close();
});

test("Free는 저장 장소 한도까지만, Premium은 저장 장소와 학원을 모두 평가한다", async () => {
  const { sqlite, db } = createDb();
  const policies = await loadRegisteredPlaceFamilyPolicies(db);
  const places = await loadFamilyPlaces(db, policies);

  assert.deepEqual(
    places.get("family-free")?.map((place) => place.placeKey),
    [
      "registered:saved_place:family-free-saved-1",
      "registered:saved_place:family-free-saved-2",
    ],
  );
  assert.deepEqual(
    places.get("family-reviewed")?.map((place) => place.placeKey),
    [
      "registered:saved_place:family-reviewed-saved-1",
      "registered:saved_place:family-reviewed-saved-2",
      "registered:saved_place:family-reviewed-saved-3",
    ],
  );
  assert.deepEqual(
    places.get("family-expired")?.map((place) => place.placeKey),
    [
      "registered:saved_place:family-expired-saved-1",
      "registered:saved_place:family-expired-saved-2",
    ],
  );
  assert.deepEqual(
    places.get("family-premium")?.map((place) => place.source),
    ["saved_place", "saved_place", "saved_place", "saved_place", "academy"],
  );
  assert.equal(places.has("family-disabled"), false);
  sqlite.close();
});

