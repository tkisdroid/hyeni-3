import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

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

const { partitionNotificationRecipients } = await import("../lib/notificationQuietHours.ts");
const { loadTeacherNoticeAudience } = await import("../lib/teacherNoticeDelivery.ts");

class BoundedD1Statement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    this.owner.bindingCounts.push(bindings.length);
    if (bindings.length > this.owner.maxBindings) {
      throw new Error(`statement_bind_limit_exceeded:${bindings.length}`);
    }
    return new BoundedD1Statement(this.owner, this.sql, bindings);
  }

  async all() {
    this.owner.allCount += 1;
    if (this.owner.failAllAt === this.owner.allCount) {
      throw new Error("injected_chunk_lookup_failure");
    }
    return {
      success: true,
      results: this.owner.sqlite.prepare(this.sql).all(...this.bindings),
    };
  }
}

class BoundedSqliteD1Adapter {
  constructor({ maxBindings = 100, failAllAt = 0 } = {}) {
    this.sqlite = new DatabaseSync(":memory:");
    this.maxBindings = maxBindings;
    this.failAllAt = failAllAt;
    this.allCount = 0;
    this.bindingCounts = [];
  }

  prepare(sql) {
    return new BoundedD1Statement(this, sql);
  }

  close() {
    this.sqlite.close();
  }
}

function createTeacherAudienceDb() {
  const db = new BoundedSqliteD1Adapter();
  db.sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE families (
      time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul',
      id TEXT PRIMARY KEY,
      parent_id TEXT NULL
    );
    CREATE TABLE family_members (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
  `);
  return db;
}

function createQuietHoursDb(options) {
  const db = new BoundedSqliteD1Adapter(options);
  db.sqlite.exec(`
    CREATE TABLE families (id TEXT PRIMARY KEY, time_zone TEXT DEFAULT 'Asia/Seoul');
    CREATE TABLE notification_settings (
      family_id TEXT,
      time_zone TEXT DEFAULT 'Asia/Seoul',
      user_id TEXT PRIMARY KEY,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320,
      quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420,
      quiet_hours_updated_at TEXT NULL
    );
  `);
  return db;
}

test("선생님 알림 40가족·40아이 대상은 100 bind 이하로 나눠 정본 수신자를 중복 없이 합친다", async () => {
  const db = createTeacherAudienceDb();
  const targets = [];
  const insertUser = db.sqlite.prepare("INSERT INTO users(id) VALUES (?)");
  const insertFamily = db.sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)");
  const insertMember = db.sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,1)",
  );

  for (let index = 0; index < 40; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const familyId = `family-${suffix}`;
    const parentUserId = `parent-${suffix}`;
    const childUserId = `child-${suffix}`;
    const childMemberId = `member-child-${suffix}`;
    insertUser.run(parentUserId);
    insertFamily.run(familyId, parentUserId);
    insertMember.run(`member-parent-${suffix}`, familyId, parentUserId, "parent");
    insertMember.run(childMemberId, familyId, childUserId, "child");
    targets.push({ familyId, childMemberId });
  }

  try {
    const audience = await loadTeacherNoticeAudience(db, targets);
    const identities = audience.map(
      ({ familyId, userId, role }) => `${familyId}\u0000${userId}\u0000${role}`,
    );

    assert.equal(audience.length, 80);
    assert.equal(new Set(identities).size, 80);
    assert.ok(db.bindingCounts.length >= 2);
    assert.ok(db.bindingCounts.every((count) => count <= 90), db.bindingCounts.join(","));
  } finally {
    db.close();
  }
});

test("조용한 시간 191명 수신자는 90 bind 이하로 나눠 allowed와 suppressed를 합친다", async () => {
  const db = createQuietHoursDb();
  const userIds = Array.from({ length: 191 }, (_, index) => `user-${String(index).padStart(3, "0")}`);
  const quietUserIds = userIds.filter((_, index) => index % 3 === 0);
  const insertQuiet = db.sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,1,1320,420)`,
  );
  for (const userId of quietUserIds) insertQuiet.run(userId);

  try {
    const result = await partitionNotificationRecipients(db, {
      userIds: [...userIds, userIds[0], userIds[190]],
      identity: { action: "teacher_notice" },
      atMs: Date.parse("2026-07-18T13:30:00.000Z"),
    });

    assert.deepEqual(result.suppressed, new Set(quietUserIds));
    assert.deepEqual(
      result.allowed,
      new Set(userIds.filter((userId) => !result.suppressed.has(userId))),
    );
    assert.ok(db.bindingCounts.length >= 3);
    assert.ok(db.bindingCounts.every((count) => count <= 90), db.bindingCounts.join(","));
  } finally {
    db.close();
  }
});

test("조용한 시간 분할 조회 중 하나라도 실패하면 부분 허용 결과를 반환하지 않는다", async () => {
  const db = createQuietHoursDb({ failAllAt: 2 });
  const userIds = Array.from({ length: 191 }, (_, index) => `user-${index}`);

  try {
    await assert.rejects(
      partitionNotificationRecipients(db, {
        userIds,
        identity: { action: "new_memo" },
        atMs: Date.parse("2026-07-18T13:30:00.000Z"),
      }),
      /injected_chunk_lookup_failure/,
    );
  } finally {
    db.close();
  }
});
