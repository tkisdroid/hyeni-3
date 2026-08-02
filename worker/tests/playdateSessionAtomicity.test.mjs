import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

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

const playdateRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/playdate.ts")).href)
).default;

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
    await this.db.beforeFirst(this.sql);
    return this.db.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    await this.db.beforeRun(this.sql);
    const result = this.db.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class D1DatabaseAdapter {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.activeCheckTarget = 0;
    this.activeCheckCount = 0;
    this.activeCheckRelease = null;
    this.activeCheckBarrier = null;
    this.batchTail = Promise.resolve();
    this.inviteInsertHook = null;
    this.inviteAcceptHook = null;
  }

  prepare(sql) {
    return new D1StatementAdapter(this, sql);
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  armActiveCheckBarrier(target) {
    this.activeCheckTarget = target;
    this.activeCheckCount = 0;
    this.activeCheckBarrier = new Promise((resolveBarrier) => {
      this.activeCheckRelease = resolveBarrier;
    });
  }

  async beforeFirst(sql) {
    if (
      this.activeCheckTarget < 1
      || !/SELECT id FROM friend_playdate_sessions\s+WHERE stopped_at IS NULL/.test(sql)
    ) {
      return;
    }
    this.activeCheckCount += 1;
    if (this.activeCheckCount >= this.activeCheckTarget) {
      this.activeCheckRelease?.();
    }
    await this.activeCheckBarrier;
  }

  async beforeRun(sql) {
    if (this.inviteInsertHook && /INSERT INTO friend_playdate_invites/.test(sql)) {
      const hook = this.inviteInsertHook;
      this.inviteInsertHook = null;
      await hook();
    }
    if (
      this.inviteAcceptHook
      && /UPDATE friend_playdate_invites\s+SET status = 'accepted'/.test(sql)
    ) {
      const hook = this.inviteAcceptHook;
      this.inviteAcceptHook = null;
      await hook();
    }
  }

  armInviteInsertHook(hook) {
    this.inviteInsertHook = hook;
  }

  armInviteAcceptHook(hook) {
    this.inviteAcceptHook = hook;
  }

  async batch(statements) {
    const previous = this.batchTail;
    let release;
    this.batchTail = new Promise((resolveBatch) => {
      release = resolveBatch;
    });
    await previous;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }

  scalar(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings)?.value ?? null;
  }

  row(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings) ?? null;
  }

  close() {
    this.sqlite.close();
  }
}

function createDb() {
  const db = new D1DatabaseAdapter();
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      playdate_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      name TEXT,
      phone TEXT,
      gender TEXT,
      created_at TEXT,
      last_selected_at TEXT
    );
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id)
    );
    CREATE TABLE family_unpair_cleanup_jobs(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE public_places(
      id TEXT PRIMARY KEY,
      kakao_place_id TEXT,
      name TEXT,
      lat REAL,
      lng REAL,
      created_at TEXT
    );
    CREATE TABLE child_locations(
      user_id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE danger_zones(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius_m INTEGER NOT NULL DEFAULT 200
    );
    CREATE TABLE location_confirmation_records(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      subject_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      requester_kind TEXT NOT NULL,
      requester_user_id TEXT,
      recipient_kind TEXT NOT NULL,
      recipient_user_id TEXT,
      collection_method TEXT NOT NULL,
      acquisition_path TEXT NOT NULL,
      service_code TEXT NOT NULL,
      delivery_method TEXT NOT NULL,
      purpose_code TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE friend_playdate_sessions(
      id TEXT PRIMARY KEY,
      public_place_id TEXT NOT NULL,
      family_a_id TEXT NOT NULL,
      family_b_id TEXT NOT NULL,
      child_a_id TEXT,
      child_b_id TEXT,
      initiator_user_id TEXT,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      stop_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE friend_playdate_invites(
      id TEXT PRIMARY KEY,
      public_place_id TEXT NOT NULL,
      requester_family_id TEXT NOT NULL,
      receiver_family_id TEXT NOT NULL,
      requester_child_id TEXT NOT NULL,
      receiver_child_id TEXT NOT NULL,
      requester_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT,
      requested_at TEXT NOT NULL,
      responded_at TEXT,
      responded_by TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const createdAt = "2026-08-01 00:00:00.000+00";
  for (const [familyId, parentId, childId] of [
    ["family-a", "parent-a", "child-a"],
    ["family-b", "parent-b", "child-b"],
  ]) {
    db.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?)").run(parentId, childId);
    db.sqlite.prepare("INSERT INTO families(id,parent_id,created_at) VALUES (?,?,?)")
      .run(familyId, parentId, createdAt);
    db.sqlite.prepare(
      `INSERT INTO family_members
         (id,family_id,user_id,role,is_active,name,created_at)
       VALUES (?,?,?,?,1,?,?)`,
    ).run(`member-${parentId}`, familyId, parentId, "parent", parentId, createdAt);
    db.sqlite.prepare(
      `INSERT INTO family_members
         (id,family_id,user_id,role,is_active,name,created_at)
       VALUES (?,?,?,?,1,?,?)`,
    ).run(`member-${childId}`, familyId, childId, "child", childId, createdAt);
  }
  db.sqlite.prepare(
    "INSERT INTO public_places(id,kakao_place_id,name,lat,lng,created_at) VALUES (?,?,?,?,?,?)",
  ).run("place-1", "place-1", "놀이터", 37.5, 127.0, createdAt);
  const freshAt = new Date().toISOString().replace("T", " ").replace("Z", "+00");
  db.sqlite.prepare(
    "INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at) VALUES (?,?,?,?,?)",
  ).run("child-a", "family-a", 37.5, 127.0, freshAt);
  db.sqlite.prepare(
    "INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at) VALUES (?,?,?,?,?)",
  ).run("child-b", "family-b", 37.5005, 127.0, freshAt);
  return db;
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function bearer(sub, familyId) {
  const token = await new SignJWT({ role: "child", family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function env(db) {
  return {
    DB: db,
    JWT_PUBLIC_KEY: jwtPublicKey,
    FAMILY_ROOM: {
      idFromName(value) {
        return value;
      },
      get() {
        return { async fetch() { return new Response(null, { status: 204 }); } };
      },
    },
  };
}

async function request(db, path, caller, body = {}, method = "POST") {
  const app = new Hono();
  app.route("/api/playdate", playdateRoutes);
  return app.request(
    `http://test.local/api/playdate${path}`,
    {
      method,
      headers: {
        Authorization: await bearer(caller.sub, caller.familyId),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env(db),
  );
}

function inviteBody(overrides = {}) {
  return {
    public_place_id: "place-1",
    requester_family_id: "family-a",
    receiver_family_id: "family-b",
    requester_child_id: "child-a",
    receiver_child_id: "child-b",
    requester_user_id: "child-a",
    ...overrides,
  };
}

function seedPendingInvite(db, overrides = {}) {
  const now = new Date();
  const requestedAt = new Date(now.getTime() - 60_000)
    .toISOString().replace("T", " ").replace("Z", "+00");
  const expiresAt = new Date(now.getTime() + 10 * 60_000)
    .toISOString().replace("T", " ").replace("Z", "+00");
  const invite = {
    id: "invite-safety",
    publicPlaceId: "place-1",
    requesterFamilyId: "family-a",
    receiverFamilyId: "family-b",
    requesterChildId: "child-a",
    receiverChildId: "child-b",
    requesterUserId: "child-a",
    ...overrides,
  };
  db.sqlite.prepare(
    `INSERT INTO friend_playdate_invites
       (id,public_place_id,requester_family_id,receiver_family_id,
        requester_child_id,receiver_child_id,requester_user_id,status,
        requested_at,expires_at,created_at)
     VALUES (?,?,?,?,?,?,?,'pending',?,?,?)`,
  ).run(
    invite.id,
    invite.publicPlaceId,
    invite.requesterFamilyId,
    invite.receiverFamilyId,
    invite.requesterChildId,
    invite.receiverChildId,
    invite.requesterUserId,
    requestedAt,
    expiresAt,
    requestedAt,
  );
  return invite;
}

test("직접 sessions POST는 초대 없이 다른 가족 자녀를 지정해 세션을 만들지 못한다", async () => {
  const db = createDb();
  try {
    const response = await request(db, "/sessions", {
      sub: "child-a",
      familyId: "family-a",
    }, {
      public_place_id: "place-1",
      family_a_id: "family-a",
      family_b_id: "family-b",
      child_a_id: "child-a",
      child_b_id: "child-b",
      initiator_user_id: "child-a",
    });

    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: "playdate_invite_accept_required" });
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_sessions"), 0);
  } finally {
    db.close();
  }
});

test("같은 초대를 동시에 수락해도 연결된 세션 하나만 남고 고아 세션이 생기지 않는다", async () => {
  const db = createDb();
  try {
    const now = new Date();
    const requestedAt = new Date(now.getTime() - 60_000).toISOString().replace("T", " ").replace("Z", "+00");
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString().replace("T", " ").replace("Z", "+00");
    db.sqlite.prepare(
      `INSERT INTO friend_playdate_invites
         (id,public_place_id,requester_family_id,receiver_family_id,
          requester_child_id,receiver_child_id,requester_user_id,status,
          requested_at,expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,'pending',?,?,?)`,
    ).run(
      "invite-1",
      "place-1",
      "family-a",
      "family-b",
      "child-a",
      "child-b",
      "child-a",
      requestedAt,
      expiresAt,
      requestedAt,
    );

    db.armActiveCheckBarrier(2);
    const responses = await Promise.all([
      request(db, "/invites/invite-1/accept", { sub: "child-b", familyId: "family-b" }),
      request(db, "/invites/invite-1/accept", { sub: "child-b", familyId: "family-b" }),
    ]);
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);

    assert.deepEqual(statuses, [200, 409]);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_sessions"), 1);
    assert.equal(
      db.scalar(
        `SELECT COUNT(*) AS value
           FROM friend_playdate_sessions s
           LEFT JOIN friend_playdate_invites i ON i.session_id = s.id
          WHERE i.id IS NULL`,
      ),
      0,
    );
    const accepted = db.row(
      "SELECT status,session_id FROM friend_playdate_invites WHERE id='invite-1'",
    );
    const session = db.row("SELECT id FROM friend_playdate_sessions LIMIT 1");
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.session_id, session.id);
  } finally {
    db.close();
  }
});

test("기존 pending 초대도 현재 양가족 동의가 꺼졌으면 정상 초대로 반환하지 않는다", async () => {
  const db = createDb();
  try {
    seedPendingInvite(db);
    db.sqlite.prepare("UPDATE families SET playdate_enabled=0 WHERE id='family-b'").run();
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "playdate_not_enabled");
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_sessions"), 0);
  } finally {
    db.close();
  }
});

test("기존 pending 초대의 저장 장소가 현재 위치와 어긋나면 새 요청이 안전해도 재사용하지 않는다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare(
      "INSERT INTO public_places(id,kakao_place_id,name,lat,lng,created_at) VALUES (?,?,?,?,?,?)",
    ).run("old-place", "old-place", "예전 장소", 0, 0, "2026-08-01 00:00:00.000+00");
    seedPendingInvite(db, { publicPlaceId: "old-place" });
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "invalid_public_place");
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_sessions"), 0);
  } finally {
    db.close();
  }
});

for (const scenario of [
  {
    name: "양가족 동의가 꺼진 경우",
    expectedStatus: 403,
    expectedError: "playdate_not_enabled",
    mutate(db) {
      db.sqlite.prepare("UPDATE families SET playdate_enabled=0 WHERE id='family-b'").run();
    },
  },
  {
    name: "한 아이 위치가 10분보다 오래된 경우",
    expectedStatus: 409,
    expectedError: "current_location_unavailable",
    mutate(db) {
      const staleAt = new Date(Date.now() - 11 * 60_000)
        .toISOString().replace("T", " ").replace("Z", "+00");
      db.sqlite.prepare("UPDATE child_locations SET updated_at=? WHERE user_id='child-b'").run(staleAt);
    },
  },
  {
    name: "두 아이가 150m 밖으로 멀어진 경우",
    expectedStatus: 409,
    expectedError: "not_nearby",
    mutate(db) {
      db.sqlite.prepare("UPDATE child_locations SET lat=37.51 WHERE user_id='child-b'").run();
    },
  },
  {
    name: "한 아이가 자기 가족 위험구역에 들어간 경우",
    expectedStatus: 409,
    expectedError: "in_danger_zone",
    mutate(db) {
      db.sqlite.prepare(
        "INSERT INTO danger_zones(id,family_id,name,lat,lng,radius_m) VALUES (?,?,?,?,?,?)",
      ).run("accept-danger", "family-b", "위험", 37.5005, 127.0, 200);
    },
  },
  {
    name: "초대 장소가 현재 위치에서 벗어난 경우",
    expectedStatus: 409,
    expectedError: "invalid_public_place",
    mutate(db) {
      db.sqlite.prepare("UPDATE public_places SET lat=0,lng=0 WHERE id='place-1'").run();
    },
  },
]) {
  test(`초대 수락은 ${scenario.name} 세션을 시작하지 않는다`, async () => {
    const db = createDb();
    try {
      seedPendingInvite(db);
      scenario.mutate(db);
      const response = await request(
        db,
        "/invites/invite-safety/accept",
        { sub: "child-b", familyId: "family-b" },
      );
      assert.equal(response.status, scenario.expectedStatus);
      assert.equal((await response.json()).error, scenario.expectedError);
      assert.equal(db.row("SELECT status FROM friend_playdate_invites WHERE id='invite-safety'").status, "pending");
      assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_sessions"), 0);
    } finally {
      db.close();
    }
  });
}

for (const scenario of [
  {
    name: "양가족 동의 OFF",
    expectedStatus: 403,
    expectedError: "playdate_not_enabled",
    mutate(db) {
      db.sqlite.prepare("UPDATE families SET playdate_enabled=0 WHERE id='family-b'").run();
    },
  },
  {
    name: "위험구역 진입",
    expectedStatus: 409,
    expectedError: "in_danger_zone",
    mutate(db) {
      db.sqlite.prepare(
        "INSERT INTO danger_zones(id,family_id,name,lat,lng,radius_m) VALUES (?,?,?,?,?,?)",
      ).run("race-danger", "family-b", "위험", 37.5005, 127.0, 200);
    },
  },
  {
    name: "위치 이탈",
    expectedStatus: 409,
    expectedError: "not_nearby",
    mutate(db) {
      db.sqlite.prepare("UPDATE child_locations SET lat=37.51 WHERE user_id='child-b'").run();
    },
  },
  {
    name: "장소 좌표 변경",
    expectedStatus: 409,
    expectedError: "invalid_public_place",
    mutate(db) {
      db.sqlite.prepare("UPDATE public_places SET lat=0,lng=0 WHERE id='place-1'").run();
    },
  },
]) {
  test(`수락 검증 직후 ${scenario.name} 경합도 원자적으로 세션 생성을 막는다`, async () => {
    const db = createDb();
    try {
      seedPendingInvite(db);
      db.armInviteAcceptHook(() => scenario.mutate(db));
      const response = await request(
        db,
        "/invites/invite-safety/accept",
        { sub: "child-b", familyId: "family-b" },
      );
      assert.equal(response.status, scenario.expectedStatus);
      assert.equal((await response.json()).error, scenario.expectedError);
      assert.equal(db.row("SELECT status FROM friend_playdate_invites WHERE id='invite-safety'").status, "pending");
      assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_sessions"), 0);
    } finally {
      db.close();
    }
  });
}

test("초대 생성은 상대 가족이 친구놀이 동의를 끄면 거부한다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare("UPDATE families SET playdate_enabled=0 WHERE id='family-b'").run();
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 403);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 0);
  } finally {
    db.close();
  }
});

test("양가족 동의·최신 위치·150m·위험구역·장소 조건이 모두 맞으면 초대를 한 건 만든다", async () => {
  const db = createDb();
  try {
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.requester_child_id, "child-a");
    assert.equal(body.receiver_child_id, "child-b");
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 1);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM location_confirmation_records"), 2);
  } finally {
    db.close();
  }
});

test("초대 검증 직후 상대 가족이 동의를 끄는 경합에서도 INSERT를 원자 거부한다", async () => {
  const db = createDb();
  try {
    db.armInviteInsertHook(() => {
      db.sqlite.prepare("UPDATE families SET playdate_enabled=0 WHERE id='family-b'").run();
    });
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 409);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 0);
  } finally {
    db.close();
  }
});

test("초대 생성은 두 아이의 최신 위치가 150m 밖이면 거부한다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare("UPDATE child_locations SET lat=37.51 WHERE user_id='child-b'").run();
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 409);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 0);
  } finally {
    db.close();
  }
});

test("초대 생성은 어느 한 아이의 위치가 10분보다 오래되면 거부한다", async () => {
  const db = createDb();
  try {
    const staleAt = new Date(Date.now() - 11 * 60_000).toISOString().replace("T", " ").replace("Z", "+00");
    db.sqlite.prepare("UPDATE child_locations SET updated_at=? WHERE user_id='child-b'").run(staleAt);
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 409);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 0);
  } finally {
    db.close();
  }
});

test("초대 생성은 어느 한 아이가 자기 가족 위험구역 안이면 거부한다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare(
      "INSERT INTO danger_zones(id,family_id,name,lat,lng,radius_m) VALUES (?,?,?,?,?,?)",
    ).run("danger-b", "family-b", "위험", 37.5005, 127.0, 200);
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody(),
    );
    assert.equal(response.status, 409);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 0);
  } finally {
    db.close();
  }
});

test("초대 생성은 현재 신청 위치와 연결되지 않은 public place를 거부한다", async () => {
  const db = createDb();
  try {
    const response = await request(
      db,
      "/invites",
      { sub: "child-a", familyId: "family-a" },
      inviteBody({ public_place_id: "forged-place" }),
    );
    assert.equal(response.status, 409);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM friend_playdate_invites"), 0);
  } finally {
    db.close();
  }
});

test("진행 중 세션은 참여 아이 또는 양가족 부모만 역할에 맞는 사유로 종료한다", async () => {
  const db = createDb();
  try {
    const createdAt = new Date().toISOString().replace("T", " ").replace("Z", "+00");
    db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run("child-sibling");
    db.sqlite.prepare(
      `INSERT INTO family_members
         (id,family_id,user_id,role,is_active,name,created_at)
       VALUES (?,?,?,?,1,?,?)`,
    ).run("member-child-sibling", "family-a", "child-sibling", "child", "형제", createdAt);
    db.sqlite.prepare(
      `INSERT INTO friend_playdate_sessions
         (id,public_place_id,family_a_id,family_b_id,child_a_id,child_b_id,
          initiator_user_id,started_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      "session-1",
      "place-1",
      "family-a",
      "family-b",
      "child-a",
      "child-b",
      "child-a",
      createdAt,
      createdAt,
    );

    const sibling = await request(
      db,
      "/sessions/session-1",
      { sub: "child-sibling", familyId: "family-a" },
      { stop_reason: "child_end" },
      "PATCH",
    );
    assert.equal(sibling.status, 403);
    assert.equal(db.row("SELECT stopped_at FROM friend_playdate_sessions WHERE id='session-1'").stopped_at, null);

    const wrongParentReason = await request(
      db,
      "/sessions/session-1",
      { sub: "parent-a", familyId: "family-a" },
      { stop_reason: "child_end" },
      "PATCH",
    );
    assert.equal(wrongParentReason.status, 403);

    const participant = await request(
      db,
      "/sessions/session-1",
      { sub: "child-a", familyId: "family-a" },
      { stop_reason: "child_end" },
      "PATCH",
    );
    assert.equal(participant.status, 200);
    assert.equal((await participant.json()).updated, true);
  } finally {
    db.close();
  }
});

test("양가족의 검증된 부모는 parent_end로 진행 중 세션을 종료한다", async () => {
  const db = createDb();
  try {
    const createdAt = new Date().toISOString().replace("T", " ").replace("Z", "+00");
    db.sqlite.prepare(
      `INSERT INTO friend_playdate_sessions
         (id,public_place_id,family_a_id,family_b_id,child_a_id,child_b_id,
          initiator_user_id,started_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      "session-parent",
      "place-1",
      "family-a",
      "family-b",
      "child-a",
      "child-b",
      "child-a",
      createdAt,
      createdAt,
    );
    const response = await request(
      db,
      "/sessions/session-parent",
      { sub: "parent-b", familyId: "family-b" },
      { stop_reason: "parent_end" },
      "PATCH",
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updated, true);
    assert.equal(
      db.row("SELECT stop_reason FROM friend_playdate_sessions WHERE id='session-parent'").stop_reason,
      "parent_end",
    );
  } finally {
    db.close();
  }
});

test("미사용 legacy public-places 직접 쓰기는 폐쇄한다", async () => {
  const db = createDb();
  try {
    const response = await request(
      db,
      "/public-places",
      { sub: "child-a", familyId: "family-a" },
      { kakao_place_id: "poison", name: "오염", lat: 0, lng: 0 },
    );
    assert.equal(response.status, 410);
    assert.equal(db.scalar("SELECT COUNT(*) AS value FROM public_places WHERE kakao_place_id='poison'"), 0);
  } finally {
    db.close();
  }
});
