import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const {
  createCalendarProfileService,
} = await import("../lib/studyCalendarProjection.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.sqlite, this.sql, bindings);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      photo_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

function imageObject(key, bytes, contentType, customMetadata = {}) {
  return {
    key,
    size: bytes.byteLength,
    body: new Blob([bytes]).stream(),
    httpMetadata: { contentType },
    customMetadata,
  };
}

class PhotosBucket {
  constructor(entries = []) {
    this.entries = new Map(entries.map((entry) => [entry.key, entry]));
  }

  async get(key) {
    const entry = this.entries.get(key);
    return entry
      ? imageObject(entry.key, entry.bytes, entry.contentType, entry.customMetadata)
      : null;
  }
}

test("Study projection은 정확히 일치하는 활성 자녀만 반환한다", async () => {
  const { sqlite, db } = createDb();
  const insert = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,role,name,photo_url,is_active) VALUES (?,?,?,?,?,?)",
  );
  insert.run("child-active", "family-a", "child", "혜니", null, 1);
  insert.run("child-ghost", "family-a", "child", "유령", null, 0);
  insert.run("child-other", "family-b", "child", "다른아이", null, 1);
  insert.run("parent-active", "family-a", "parent", "부모", null, 1);

  const service = createCalendarProfileService({ DB: db, PHOTOS: new PhotosBucket() });
  assert.deepEqual(await service.getActiveChildProjection("family-a", "child-active"), {
    apiVersion: "2026-08-24",
    status: "active",
    memberId: "child-active",
    displayName: "혜니",
    hasAvatar: false,
    avatarFingerprint: null,
  });
  assert.equal(
    (await service.getActiveChildProjection("family-a", "child-ghost")).status,
    "inactive_or_missing",
  );
  assert.equal(
    (await service.getActiveChildProjection("family-a", "child-other")).status,
    "inactive_or_missing",
  );
  assert.equal(
    (await service.getActiveChildProjection("family-a", "parent-active")).status,
    "inactive_or_missing",
  );
});

test("projection과 avatar 응답은 원본 R2 경로를 공개하지 않는다", async () => {
  const { sqlite, db } = createDb();
  const key = "family-a/uploads/parent-a/avatar.webp";
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,role,name,photo_url,is_active) VALUES (?,?,?,?,?,1)",
  ).run("child-active", "family-a", "child", "혜니", key);
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const service = createCalendarProfileService({
    DB: db,
    PHOTOS: new PhotosBucket([{
      key,
      bytes,
      contentType: "image/webp",
      customMetadata: {
        familyId: "family-a",
        ownerUserId: "parent-a",
        purpose: "profile",
        targetMemberId: "child-active",
      },
    }]),
  });

  const projection = await service.getActiveChildProjection("family-a", "child-active");
  assert.equal(projection.status, "active");
  assert.equal(projection.hasAvatar, true);
  assert.ok(projection.avatarFingerprint);
  assert.doesNotMatch(JSON.stringify(projection), /uploads|parent-a|avatar\.webp/);

  const response = await service.fetchActiveChildAvatar(
    "family-a",
    "child-active",
    "study-128",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    "cache-control": "private, no-store",
    "content-length": String(bytes.byteLength),
    "content-type": "image/webp",
    "x-content-type-options": "nosniff",
  });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.doesNotMatch(JSON.stringify(Object.fromEntries(response.headers)), /uploads|parent-a|avatar\.webp/);

  const source = readFileSync(new URL("../lib/studyCalendarProjection.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /photo_url\s*:/);
});

test("avatar는 비활성·다른 가족·잘못된 variant·과대 객체를 stable 404로 닫는다", async () => {
  const { sqlite, db } = createDb();
  const key = "family-a/uploads/parent-a/avatar.webp";
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,role,name,photo_url,is_active) VALUES (?,?,?,?,?,1)",
  ).run("child-active", "family-a", "child", "혜니", key);
  const service = createCalendarProfileService({
    DB: db,
    PHOTOS: new PhotosBucket([{
      key,
      bytes: new Uint8Array(512 * 1024 + 1),
      contentType: "image/webp",
      customMetadata: {
        familyId: "family-a",
        ownerUserId: "parent-a",
        purpose: "profile",
        targetMemberId: "child-active",
      },
    }]),
  });

  for (const response of [
    await service.fetchActiveChildAvatar("family-b", "child-active", "study-128"),
    await service.fetchActiveChildAvatar("family-a", "missing", "study-128"),
    await service.fetchActiveChildAvatar("family-a", "child-active", "original"),
    await service.fetchActiveChildAvatar("family-a", "child-active", "study-128"),
  ]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.doesNotMatch(await response.text(), /family-a|child-active|uploads/);
  }
});

test("Worker는 CalendarProfileService를 HTTP route 없이 named export한다", () => {
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(indexSource, /export\s*\{\s*CalendarProfileService\s*\}/);
  assert.doesNotMatch(indexSource, /app\.(?:get|post|put|patch|delete)\([^\n]*calendar-profile/i);
});
