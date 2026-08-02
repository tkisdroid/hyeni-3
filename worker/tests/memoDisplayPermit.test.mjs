import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportPKCS8, generateKeyPair } from "jose";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(workerDir, "lib/memoDisplayPermit.ts");
const pushPath = resolve(workerDir, "routes/push-notify.ts");

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

const permitModule = existsSync(helperPath)
  ? await import(pathToFileURL(helperPath).href)
  : null;
const pushModule = permitModule
  ? await import(pathToFileURL(pushPath).href)
  : null;
const pushRoutes = pushModule?.default ?? null;
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

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

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE user_interaction_blocks(
      family_id TEXT NOT NULL,
      blocker_user_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(family_id, blocker_user_id, blocked_user_id)
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-a", "parent-a");
  const insertMember = sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)");
  insertMember.run("member-parent-b", "family-a", "parent-b", "parent", 1);
  insertMember.run("member-child-a", "family-a", "child-a", "child", 1);
  insertMember.run("member-child-b", "family-a", "child-b", "child", 1);
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

function createDispatchDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(workerDir, "../cloudflare/schema_d1.sql"), "utf8"));
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)")
    .run("family-a", "parent-a", "PAIR-A");
  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  );
  insertMember.run("member-parent-b", "family-a", "parent-b", "parent", "공동 보호자");
  insertMember.run("member-child-a", "family-a", "child-a", "child", "아이");
  insertMember.run("member-child-b", "family-a", "child-b", "child", "다른 아이");
  const insertToken = sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')",
  );
  insertToken.run("token-row-parent-b", "parent-b", "family-a", "fcm-parent-b");
  insertToken.run("token-row-child-a", "child-a", "family-a", "fcm-child-a");
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

function api() {
  assert.ok(permitModule, "memoDisplayPermit helper가 필요합니다");
  return permitModule;
}

const secret = "test-push-internal-secret-not-for-production";
const issuedAtMs = Date.parse("2026-07-14T08:00:00.000Z");
const baseInput = {
  familyId: "family-a",
  senderUserId: "parent-a",
  recipientUserId: "child-a",
  pushId: "memo:reply-a",
  targetChildUserId: "child-a",
};

test("memo display permit은 수신자·메모 scope를 HMAC으로 결합하고 재검증해도 소비되지 않는다", async () => {
  const { createMemoDisplayPermit, verifyMemoDisplayPermit } = api();
  const permit = await createMemoDisplayPermit(secret, baseInput, issuedAtMs);
  assert.equal(typeof permit, "string");
  assert.ok(permit.length > 40);

  const first = await verifyMemoDisplayPermit(secret, permit, issuedAtMs + 1_000);
  const second = await verifyMemoDisplayPermit(secret, permit, issuedAtMs + 2_000);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    version: 1,
    ...baseInput,
    exp: Math.floor(issuedAtMs / 1000) + 300,
  });
});

test("변조·만료·과대 또는 허용되지 않은 payload는 permit 검증에서 fail-closed한다", async () => {
  const { createMemoDisplayPermit, verifyMemoDisplayPermit } = api();
  const permit = await createMemoDisplayPermit(secret, baseInput, issuedAtMs);
  assert.equal(typeof permit, "string");
  const last = permit.at(-1);
  const tampered = `${permit.slice(0, -1)}${last === "A" ? "B" : "A"}`;
  assert.equal(await verifyMemoDisplayPermit(secret, tampered, issuedAtMs + 1_000), null);
  assert.equal(await verifyMemoDisplayPermit(secret, permit, issuedAtMs + 300_000), null);
  assert.equal(await verifyMemoDisplayPermit("", permit, issuedAtMs + 1_000), null);
  assert.equal(await verifyMemoDisplayPermit(secret, "x".repeat(5_000), issuedAtMs + 1_000), null);
  assert.equal(await createMemoDisplayPermit(secret, {
    ...baseInput,
    pushId: "x".repeat(201),
  }, issuedAtMs), null);
  assert.equal(await createMemoDisplayPermit(secret, {
    ...baseInput,
    recipientUserId: baseInput.senderUserId,
  }, issuedAtMs), null);
});

test("현재 활성 가족·대상 아이·양방향 차단을 한 D1 read에서 다시 확인한다", async () => {
  const { isMemoDisplayPermitAllowed } = api();
  const { sqlite, db } = createDb();
  const payload = {
    version: 1,
    ...baseInput,
    exp: Math.floor(issuedAtMs / 1000) + 300,
  };
  assert.equal(await isMemoDisplayPermitAllowed(db, payload), true);

  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "child-a", "parent-a", "2026-07-14");
  assert.equal(await isMemoDisplayPermitAllowed(db, payload), false);
  sqlite.prepare("DELETE FROM user_interaction_blocks").run();

  sqlite.prepare("UPDATE family_members SET is_active=0 WHERE user_id='child-a'").run();
  assert.equal(await isMemoDisplayPermitAllowed(db, payload), false);
  sqlite.prepare("UPDATE family_members SET is_active=1 WHERE user_id='child-a'").run();

  assert.equal(await isMemoDisplayPermitAllowed(db, {
    ...payload,
    senderUserId: "child-b",
  }), false, "다른 아이가 대상 아이의 스레드 발신자로 바뀌면 안 됩니다");
  sqlite.close();
});

test("공개 authorize endpoint는 서명과 현재 관계가 모두 유효할 때 allowed만 반환한다", async () => {
  const { createMemoDisplayPermit } = api();
  assert.ok(pushRoutes, "push-notify route가 필요합니다");
  const { sqlite, db } = createDb();
  const permit = await createMemoDisplayPermit(secret, baseInput);
  assert.equal(typeof permit, "string");
  const response = await pushRoutes.request(
    "http://test.local/memo-display-authorize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permit }),
    },
    { DB: db, PUSH_INTERNAL_SECRET: secret },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { allowed: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    null,
    "route가 wildcard CORS를 직접 붙이지 않고 index의 origin allowlist에 맡겨야 합니다",
  );

  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "child-a", "2026-07-14");
  const blocked = await pushRoutes.request(
    "http://test.local/memo-display-authorize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permit }),
    },
    { DB: db, PUSH_INTERNAL_SECRET: secret },
  );
  assert.equal(blocked.status, 200);
  assert.deepEqual(await blocked.json(), { allowed: false });
  sqlite.close();
});

test("실제 new_memo dispatcher는 FCM 두 수신자와 pending에 서로 다른 permit을 넣는다", async () => {
  assert.ok(pushModule?.handleInstantNotification, "new_memo 공통 dispatcher가 필요합니다");
  const { verifyMemoDisplayPermit } = api();
  const { sqlite, db } = createDispatchDb();
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  const sentPayloads = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      sentPayloads.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ name: `messages/${sentPayloads.length}` });
    }
    throw new Error("unexpected_fetch");
  };

  const response = await pushModule.handleInstantNotification(
    {
      PUSH_INTERNAL_SECRET: secret,
      FCM_PROJECT_ID: "test-project",
      FCM_CLIENT_EMAIL: "fcm@example.com",
      FCM_PRIVATE_KEY: privateKeyPem,
    },
    db,
    {
      action: "new_memo",
      familyId: "family-a",
      senderUserId: "parent-a",
      targetChildUserId: "child-a",
      title: "새 메시지",
      message: "안전하게 도착했어요",
      idempotency_key: "memo:reply-runtime",
    },
    "parent-a",
    "service_role",
    "memo:reply-runtime",
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(sentPayloads.length, 2);

  const fcmPermits = new Map();
  for (const sent of sentPayloads) {
    const data = sent.message?.data;
    assert.equal(sent.message?.notification, undefined, "FCM은 data-only여야 합니다");
    assert.equal(data?.type, "new_memo");
    assert.equal(typeof data?.memoDisplayPermit, "string");
    const verified = await verifyMemoDisplayPermit(secret, data.memoDisplayPermit);
    assert.equal(verified?.recipientUserId, data.targetUserId);
    assert.equal(verified?.pushId, "memo:reply-runtime");
    fcmPermits.set(data.targetUserId, data.memoDisplayPermit);
  }
  assert.deepEqual([...fcmPermits.keys()].sort(), ["child-a", "parent-b"]);
  assert.notEqual(fcmPermits.get("child-a"), fcmPermits.get("parent-b"));

  const pendingRows = sqlite.prepare(
    "SELECT data,expires_at FROM pending_notifications WHERE json_extract(data,'$.type')='new_memo' ORDER BY id",
  ).all();
  assert.equal(pendingRows.length, 2);
  for (const row of pendingRows) {
    const data = JSON.parse(String(row.data));
    assert.equal(data.memoDisplayPermit, fcmPermits.get(data.targetUserId));
    const remainingMs = Date.parse(String(row.expires_at)) - Date.now();
    assert.ok(remainingMs > 115_000 && remainingMs <= 120_000);
  }

  const crossChild = await pushModule.handleInstantNotification(
    { PUSH_INTERNAL_SECRET: secret },
    db,
    {
      action: "new_memo",
      familyId: "family-a",
      senderUserId: "child-b",
      targetChildUserId: "child-a",
      title: "잘못된 스레드",
      message: "표시되면 안 됩니다",
      idempotency_key: "memo:cross-child",
    },
    "child-b",
    "service_role",
    "memo:cross-child",
  );
  assert.equal(crossChild.status, 403);
  assert.deepEqual(await crossChild.json(), { error: "invalid_memo_target" });
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM pending_notifications WHERE json_extract(data,'$.pushId')='memo:cross-child'",
  ).get().count, 0);
  sqlite.close();
});

test("authorize endpoint는 형식·크기·시크릿 실패를 본문 유출 없이 닫는다", async () => {
  assert.ok(pushRoutes, "push-notify route가 필요합니다");
  const { sqlite, db } = createDb();
  const malformed = await pushRoutes.request(
    "http://test.local/memo-display-authorize",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
    { DB: db, PUSH_INTERNAL_SECRET: secret },
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { allowed: false });

  const oversized = await pushRoutes.request(
    "http://test.local/memo-display-authorize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permit: "x".repeat(5_000) }),
    },
    { DB: db, PUSH_INTERNAL_SECRET: secret },
  );
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { allowed: false });

  const noSecret = await pushRoutes.request(
    "http://test.local/memo-display-authorize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permit: "not-a-permit" }),
    },
    { DB: db },
  );
  assert.equal(noSecret.status, 503);
  assert.deepEqual(await noSecret.json(), { allowed: false });
  sqlite.close();
});

test("모든 new_memo Web/FCM/pending payload는 수신자별 memoDisplayPermit을 사용한다", () => {
  const source = readFileSync(pushPath, "utf8");
  const fcmSource = readFileSync(resolve(workerDir, "lib/fcm.ts"), "utf8");
  const fcmStart = fcmSource.indexOf("export async function sendFcmNotification");
  const fcmEnd = fcmSource.indexOf("export async function sendFcmDataOnly");
  const fcmNotificationSender = fcmSource.slice(fcmStart, fcmEnd);
  assert.match(source, /createMemoDisplayPermit/);
  assert.match(source, /memoDisplayPermit/);
  assert.match(source, /memoDisplayPermit[\s\S]{0,900}sendWebPush\(/);
  assert.match(source, /memoDisplayPermit[\s\S]{0,900}sendFcmToFamily\(/);
  assert.match(source, /prequeueGenericRecipientPending\([\s\S]{0,500}memoDisplayPermits/);
  assert.match(source, /post\("\/memo-display-authorize"/);
  assert.match(fcmNotificationSender, /message:\s*\{[\s\S]{0,120}token,[\s\S]{0,120}data:\s*stringData/);
  assert.doesNotMatch(fcmNotificationSender, /\bnotification\s*:/);
});
