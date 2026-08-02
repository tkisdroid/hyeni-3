import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
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

const pushModule = await import(pathToFileURL(resolve(workerDir, "routes/push-notify.ts")).href);
const aiModule = await import(pathToFileURL(resolve(workerDir, "routes/ai-proactive.ts")).href);
const stickerRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/stickers.ts")).href)).default;
const teacherNoticeRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/teacher-notices.ts")).href)).default;

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function assertQuietPartitionBeforeDelivery({ relativePath, scopeMarker, deliveryMarker }) {
  const source = read(relativePath);
  const scopeIndex = source.indexOf(scopeMarker);
  assert.ok(scopeIndex >= 0, `${relativePath}: scope marker 없음 (${scopeMarker})`);
  const deliveryIndex = source.indexOf(deliveryMarker, scopeIndex);
  assert.ok(deliveryIndex > scopeIndex, `${relativePath}: delivery marker 없음 (${deliveryMarker})`);
  const guardedBlock = source.slice(scopeIndex, deliveryIndex);
  assert.match(
    guardedBlock,
    /partitionNotificationRecipients\s*\(/,
    `${relativePath}: quiet 분할이 ${deliveryMarker}보다 먼저 실행되어야 합니다`,
  );
}

test("일반 instant 수신자는 pending과 claim 전에 quiet 분할을 통과한다", () => {
  assertQuietPartitionBeforeDelivery({
    relativePath: "routes/push-notify.ts",
    scopeMarker: "let hadExplicitGenericRecipients",
    deliveryMarker: "prequeuedGenericPending = await prequeueGenericRecipientPending",
  });
});

test("일정 부모·아이 수신자는 pending 전에 각각 quiet 분할을 통과한다", () => {
  const source = read("routes/push-notify.ts");
  const scopeIndex = source.indexOf("const sendGroups = [");
  const deliveryIndex = source.indexOf("const schedulePendingId", scopeIndex);
  assert.ok(scopeIndex >= 0 && deliveryIndex > scopeIndex, "schedule 전달 블록을 찾을 수 없습니다");
  const guardedBlock = source.slice(scopeIndex, deliveryIndex);
  assert.ok(
    (guardedBlock.match(/partitionNotificationRecipients\s*\(/g) ?? []).length >= 2,
    "schedule parent/child를 각각 quiet 분할해야 합니다",
  );
});

test("친구놀이 시작·종료 수신자는 FCM token 조회 전에 quiet 분할을 통과한다", () => {
  for (const scopeMarker of ["async function handlePlaydateStarted", "async function handlePlaydateEnded"]) {
    assertQuietPartitionBeforeDelivery({
      relativePath: "routes/push-notify.ts",
      scopeMarker,
      deliveryMarker: "fetchFcmTokensForUsers",
    });
  }
});

test("스티커 수신자는 FCM 전에 quiet 분할을 통과한다", () => {
  assertQuietPartitionBeforeDelivery({
    relativePath: "routes/stickers.ts",
    scopeMarker: "stickers.post(\"/\"",
    deliveryMarker: "sendFcmToFamily",
  });
});

test("AI 선제 메시지 수신자는 pending 전에 quiet 분할을 통과한다", () => {
  assertQuietPartitionBeforeDelivery({
    relativePath: "routes/ai-proactive.ts",
    scopeMarker: "async function processCandidate",
    deliveryMarker: "INSERT INTO pending_notifications",
  });
});

test("선생님 알림 수신자는 idempotency claim과 FCM 전에 quiet 분할을 통과한다", () => {
  const source = read("routes/push-notify.ts");
  const scopeIndex = source.indexOf("export async function handleTeacherNotice");
  const claimIndex = source.indexOf("claimTeacherNoticeTerminalSuppression", scopeIndex);
  const fcmIndex = source.indexOf("fetchFcmTokensForUsers", scopeIndex);
  assert.ok(scopeIndex >= 0 && claimIndex > scopeIndex && fcmIndex > claimIndex, "teacher notice 전달 블록을 찾을 수 없습니다");
  const quietIndex = source.indexOf("partitionNotificationRecipients", scopeIndex);
  assert.ok(quietIndex > scopeIndex, "teacher notice quiet 분할이 필요합니다");
  assert.ok(quietIndex < claimIndex, "teacher notice quiet 분할은 idempotency claim보다 먼저 실행되어야 합니다");
  assert.ok(quietIndex < fcmIndex, "teacher notice quiet 분할은 FCM token 조회보다 먼저 실행되어야 합니다");
});

test("선생님 알림장 발행 경로는 비동기 전달을 맡기기 전에 quiet 수신자를 확인한다", () => {
  assertQuietPartitionBeforeDelivery({
    relativePath: "routes/teacher-notices.ts",
    scopeMarker: "let quietAllowedRecipientCount",
    deliveryMarker: "await handleTeacherNotice",
  });
});

test("메모 outbox는 quiet 0건 성공을 재시도하지 않고 완료 처리한다", () => {
  const source = read("lib/memoNotificationOutbox.ts");
  const responseIndex = source.indexOf("const response = await handleInstantNotification");
  const okIndex = source.indexOf("if (!response.ok)", responseIndex);
  const totalIndex = source.indexOf("const total =", okIndex);
  const pendingGuardIndex = source.indexOf("if (total !== 0 && pendingCount === 0)", totalIndex);
  const deliveredIndex = source.indexOf('return "delivered"', pendingGuardIndex);
  const completeIndex = source.indexOf("completeMemoNotificationOutbox(db, claim)", deliveredIndex);
  assert.ok(responseIndex >= 0 && okIndex > responseIndex, "outbox 응답 성공 판정이 필요합니다");
  assert.ok(totalIndex > okIndex && pendingGuardIndex > totalIndex, "total=0은 pending 누락 실패에서 제외해야 합니다");
  assert.ok(deliveredIndex > pendingGuardIndex && completeIndex > deliveredIndex, "quiet 성공은 outbox 완료로 닫혀야 합니다");
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

function createDispatchDb({ quietUserIds = [], failQuietLookup = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(workerDir, "../cloudflare/schema_d1.sql"), "utf8"));
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)")
    .run("family-a", "parent-a", "PAIR-A");
  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  );
  insertMember.run("member-parent-b", "family-a", "parent-b", "parent", "공동 보호자");
  insertMember.run("member-child-a", "family-a", "child-a", "child", "아이");
  const insertToken = sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')",
  );
  insertToken.run("token-parent-b", "parent-b", "family-a", "fcm-parent-b");
  insertToken.run("token-child-a", "child-a", "family-a", "fcm-child-a");
  const insertQuiet = sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,1320,420)`,
  );
  for (const userId of quietUserIds) insertQuiet.run(userId, "family-a");

  const db = {
    prepare(sql) {
      if (failQuietLookup && String(sql).includes("quiet_hours_enabled")) {
        throw new Error("injected quiet-hours DB failure");
      }
      return new Statement(sqlite, sql);
    },
  };
  return { sqlite, db };
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function createDeliveryFixture(sqlite) {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const fcmPrivateKey = await exportPKCS8(privateKey);

  const vapidKeys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey("raw", vapidKeys.publicKey));
  const vapidPrivate = await crypto.subtle.exportKey("jwk", vapidKeys.privateKey);
  assert.equal(typeof vapidPrivate.d, "string");

  const subscriberKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const p256dh = base64Url(new Uint8Array(await crypto.subtle.exportKey("raw", subscriberKeys.publicKey)));
  const auth = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const insertSubscription = sqlite.prepare(
    "INSERT INTO push_subscriptions(id,user_id,family_id,endpoint,subscription) VALUES (?,?,?,?,?)",
  );
  for (const userId of ["parent-b", "child-a"]) {
    const endpoint = `https://push.example.test/${userId}`;
    insertSubscription.run(
      `sub-${userId}`,
      userId,
      "family-a",
      endpoint,
      JSON.stringify({ endpoint, keys: { p256dh, auth } }),
    );
  }

  return {
    env: {
      PUSH_INTERNAL_SECRET: "test-push-internal-secret-not-for-production",
      FCM_PROJECT_ID: "test-project",
      FCM_CLIENT_EMAIL: "fcm@example.test",
      FCM_PRIVATE_KEY: fcmPrivateKey,
      VAPID_PUBLIC_KEY: base64Url(vapidPublic),
      VAPID_PRIVATE_KEY: vapidPrivate.d,
    },
  };
}

async function dispatchMemo({ quietUserIds = [], failQuietLookup = false }) {
  const { sqlite, db } = createDispatchDb({ quietUserIds, failQuietLookup });
  const { env } = await createDeliveryFixture(sqlite);
  const fcmRecipients = [];
  const webRecipients = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      fcmRecipients.push(String(payload.message?.data?.targetUserId ?? ""));
      return Response.json({ name: `messages/${fcmRecipients.length}` });
    }
    if (url.startsWith("https://push.example.test/")) {
      webRecipients.push(url.slice(url.lastIndexOf("/") + 1));
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    const response = await pushModule.handleInstantNotification(
      env,
      db,
      {
        action: "new_memo",
        familyId: "family-a",
        senderUserId: "parent-a",
        targetChildUserId: "child-a",
        title: "새 메시지",
        message: "안전하게 도착했어요",
        idempotency_key: "memo:quiet-runtime",
      },
      "parent-a",
      "service_role",
      "memo:quiet-runtime",
      { atMs: Date.parse("2026-07-18T13:30:00.000Z") },
    );
    return { sqlite, response, fcmRecipients, webRecipients };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("메모 quiet 수신자는 pending·claim·Web·FCM에서 빠지고 허용 공동수신자는 전달된다", async () => {
  const result = await dispatchMemo({ quietUserIds: ["child-a"] });
  try {
    assert.equal(result.response.status, 200, await result.response.clone().text());
    assert.deepEqual(await result.response.json(), {
      webSent: 1,
      fcmSent: 1,
      total: 1,
      key: "memo:quiet-runtime",
      suppressedQuietHours: ["child-a"],
    });
    assert.deepEqual(result.fcmRecipients, ["parent-b"]);
    assert.deepEqual(result.webRecipients, ["parent-b"]);
    assert.deepEqual(
      result.sqlite.prepare(
        "SELECT json_extract(data,'$.targetUserId') AS user_id FROM pending_notifications ORDER BY user_id",
      ).all().map((row) => row.user_id),
      ["parent-b"],
    );
    assert.deepEqual(
      result.sqlite.prepare("SELECT key FROM push_idempotency ORDER BY key").all().map((row) => row.key),
      ["family-a:memo:quiet-runtime:recipient:parent-b"],
    );
  } finally {
    result.sqlite.close();
  }
});

test("메모 수신자가 모두 quiet이면 200과 0건 통계만 반환하고 전달 단위를 만들지 않는다", async () => {
  const result = await dispatchMemo({ quietUserIds: ["child-a", "parent-b"] });
  try {
    assert.equal(result.response.status, 200, await result.response.clone().text());
    assert.deepEqual(await result.response.json(), {
      webSent: 0,
      fcmSent: 0,
      total: 0,
      key: "memo:quiet-runtime",
      suppressedQuietHours: ["child-a", "parent-b"],
    });
    assert.deepEqual(result.fcmRecipients, []);
    assert.deepEqual(result.webRecipients, []);
    assert.equal(result.sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(result.sqlite.prepare("SELECT COUNT(*) AS count FROM push_idempotency").get().count, 0);
  } finally {
    result.sqlite.close();
  }
});

test("메모 quiet 설정 조회 오류는 pending·claim·Web·FCM 전에 fail-closed한다", async () => {
  const result = await dispatchMemo({ failQuietLookup: true });
  try {
    assert.equal(result.response.status, 503, await result.response.clone().text());
    assert.deepEqual(await result.response.json(), { error: "quiet_hours_routing_failed" });
    assert.deepEqual(result.fcmRecipients, []);
    assert.deepEqual(result.webRecipients, []);
    assert.equal(result.sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(result.sqlite.prepare("SELECT COUNT(*) AS count FROM push_idempotency").get().count, 0);
  } finally {
    result.sqlite.close();
  }
});

function installMutableClock(initialMs) {
  const RealDate = globalThis.Date;
  let nowMs = initialMs;
  class MutableDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }

    static now() {
      return nowMs;
    }
  }
  globalThis.Date = MutableDate;
  return {
    set(value) {
      nowMs = value;
    },
    restore() {
      globalThis.Date = RealDate;
    },
  };
}

function installPushCapture() {
  const originalFetch = globalThis.fetch;
  const fcmTokens = [];
  const webEndpoints = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      fcmTokens.push(String(payload.message?.token ?? ""));
      return Response.json({ name: `messages/${fcmTokens.length}` });
    }
    if (url.startsWith("https://push.example.test/")) {
      webEndpoints.push(url);
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };
  return {
    fcmTokens,
    webEndpoints,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function seedScheduleRuntime(sqlite, { eventId, quietUserIds }) {
  const insertUser = sqlite.prepare("INSERT OR IGNORE INTO users(id,is_anonymous) VALUES (?,0)");
  for (const userId of ["parent-a", "parent-b", "child-a"]) insertUser.run(userId);
  const insertSetting = sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,parent_enabled,child_enabled,minutes_before,
        quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,1,'{5}',?,1320,420)`,
  );
  for (const userId of ["parent-a", "parent-b", "child-a"]) {
    insertSetting.run(userId, "family-a", quietUserIds.includes(userId) ? 1 : 0);
  }
  sqlite.prepare(
    `INSERT INTO events
       (id,family_id,date_key,title,time,category,emoji,color,bg,memo,created_by,updated_at,is_family_event)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
  ).run(
    eventId,
    "family-a",
    "2026-6-18",
    "조용한 시간 일정",
    "22:35",
    "etc",
    "📅",
    "#000",
    "#fff",
    "",
    "parent-a",
    "2026-07-18 12:00:00.000+00",
  );
}

test("일정 quiet suppression은 다음 2분 grace tick에서 quiet가 끝나도 같은 수신자를 재생하지 않는다", async () => {
  const firstTickMs = Date.parse("2026-07-18T13:30:00.000Z");
  const secondTickMs = firstTickMs + 60_000;
  const clock = installMutableClock(firstTickMs);
  const { sqlite, db } = createDispatchDb();
  const { env } = await createDeliveryFixture(sqlite);
  const insertUser = sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)");
  for (const userId of ["parent-a", "parent-b", "child-a"]) insertUser.run(userId);
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,parent_enabled,child_enabled,minutes_before,
        quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,0,'{5}',1,1320,1351)`,
  ).run("parent-b", "family-a");
  sqlite.prepare(
    `INSERT INTO events
       (id,family_id,date_key,title,time,category,emoji,color,bg,memo,created_by,updated_at,is_family_event)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
  ).run(
    "event-quiet-grace",
    "family-a",
    "2026-6-18",
    "조용한 시간 일정",
    "22:35",
    "etc",
    "📅",
    "#000",
    "#fff",
    "",
    "parent-a",
    "2026-07-18 12:00:00.000+00",
  );

  const fcmTokens = [];
  const webEndpoints = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      fcmTokens.push(String(payload.message?.token ?? ""));
      return Response.json({ name: `messages/${fcmTokens.length}` });
    }
    if (url.startsWith("https://push.example.test/")) {
      webEndpoints.push(url);
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    const first = await pushModule.handleCronNotification(env, db);
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    clock.set(secondTickMs);
    const second = await pushModule.handleCronNotification(env, db);
    assert.equal(second.status, 200, await second.clone().text());
    const secondBody = await second.json();

    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM push_idempotency WHERE action='schedule_quiet_suppression'",
      ).get().count,
      1,
      `첫 quiet tick이 terminal suppression receipt를 남겨야 합니다: ${JSON.stringify({ firstBody, secondBody, fcmTokens, webEndpoints })}`,
    );
    assert.equal(
      sqlite.prepare(
        `SELECT COUNT(*) AS count FROM pending_notifications
          WHERE json_extract(data,'$.targetUserId')='parent-b'`,
      ).get().count,
      0,
    );
    assert.equal(fcmTokens.includes("fcm-parent-b"), false);
    assert.equal(webEndpoints.some((endpoint) => endpoint.endsWith("/parent-b")), false);
  } finally {
    globalThis.fetch = originalFetch;
    clock.restore();
    sqlite.close();
  }
});

test("선생님 알림 all-quiet 성공은 notice terminal claim을 남겨 quiet 종료 후 재호출도 전달하지 않는다", async () => {
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb({ quietUserIds: ["parent-b", "child-a"] });
  const { env } = await createDeliveryFixture(sqlite);
  sqlite.prepare("INSERT INTO teacher_profiles(id,user_id,display_name) VALUES (?,?,?)")
    .run("teacher-1", "teacher-user", "담임");
  sqlite.prepare("INSERT INTO teacher_classes(id,teacher_id,class_name) VALUES (?,?,?)")
    .run("class-1", "teacher-1", "햇살반");
  sqlite.prepare(
    "INSERT INTO teacher_notices(id,teacher_id,class_id,title,body,source_type,has_schedule) VALUES (?,?,?,?,?,'text',0)",
  ).run("notice-all-quiet", "teacher-1", "class-1", "가정통신문", "내용");
  sqlite.prepare(
    "INSERT INTO teacher_notice_recipients(id,notice_id,child_member_id,family_id) VALUES (?,?,?,?)",
  ).run("notice-recipient-a", "notice-all-quiet", "member-child-a", "family-a");

  const fcmTokens = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      fcmTokens.push(String(payload.message?.token ?? ""));
      return Response.json({ name: `messages/${fcmTokens.length}` });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    const first = await pushModule.handleTeacherNotice(
      env,
      db,
      { notice_id: "notice-all-quiet" },
      "teacher-user",
      "authenticated",
    );
    assert.equal(first.status, 200, await first.clone().text());
    sqlite.prepare(
      "UPDATE notification_settings SET quiet_hours_enabled=0 WHERE user_id IN ('parent-b','child-a')",
    ).run();
    const second = await pushModule.handleTeacherNotice(
      env,
      db,
      { notice_id: "notice-all-quiet" },
      "teacher-user",
      "authenticated",
    );
    assert.equal(second.status, 200, await second.clone().text());

    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM push_idempotency WHERE key='notice-all-quiet' AND action='teacher_notice'",
      ).get().count,
      1,
      "all-quiet 첫 호출도 notice terminal claim을 남겨야 합니다",
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM parent_alerts").get().count, 0);
    assert.deepEqual(fcmTokens, []);
  } finally {
    globalThis.fetch = originalFetch;
    clock.restore();
    sqlite.close();
  }
});

test("선생님 알림 mixed-family는 allowed 부모가 있는 가족에만 parent_alert와 realtime을 만든다", async () => {
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb();
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)")
    .run("family-b", "parent-c", "PAIR-B");
  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  );
  insertMember.run("member-parent-c", "family-b", "parent-c", "parent", "B 보호자");
  insertMember.run("member-child-b", "family-b", "child-b", "child", "B 아이");
  const insertToken = sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')",
  );
  insertToken.run("token-parent-c", "parent-c", "family-b", "fcm-parent-c");
  insertToken.run("token-child-b", "child-b", "family-b", "fcm-child-b");
  const insertQuiet = sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,1320,420)`,
  );
  insertQuiet.run("parent-c", "family-b");
  insertQuiet.run("child-b", "family-b");

  sqlite.prepare("INSERT INTO teacher_profiles(id,user_id,display_name) VALUES (?,?,?)")
    .run("teacher-mixed", "teacher-user", "담임");
  sqlite.prepare("INSERT INTO teacher_classes(id,teacher_id,class_name) VALUES (?,?,?)")
    .run("class-mixed", "teacher-mixed", "햇살반");
  sqlite.prepare(
    "INSERT INTO teacher_notices(id,teacher_id,class_id,title,body,source_type,has_schedule) VALUES (?,?,?,?,?,'text',0)",
  ).run("notice-mixed", "teacher-mixed", "class-mixed", "혼합 공지", "내용");
  const insertRecipient = sqlite.prepare(
    "INSERT INTO teacher_notice_recipients(id,notice_id,child_member_id,family_id) VALUES (?,?,?,?)",
  );
  insertRecipient.run("notice-mixed-a", "notice-mixed", "member-child-a", "family-a");
  insertRecipient.run("notice-mixed-b", "notice-mixed", "member-child-b", "family-b");

  const { env } = await createDeliveryFixture(sqlite);
  const realtimeFamilies = [];
  env.DB = db;
  env.FAMILY_ROOM = {
    idFromName(familyId) {
      return familyId;
    },
    get(familyId) {
      return {
        async fetch() {
          realtimeFamilies.push(String(familyId));
          return new Response(null, { status: 200 });
        },
      };
    },
  };

  const fcmTokens = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      fcmTokens.push(String(payload.message?.token ?? ""));
      return Response.json({ name: `messages/${fcmTokens.length}` });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    const response = await pushModule.handleTeacherNotice(
      env,
      db,
      { notice_id: "notice-mixed" },
      "teacher-user",
      "authenticated",
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(
      sqlite.prepare("SELECT family_id FROM parent_alerts ORDER BY family_id").all().map((row) => row.family_id),
      ["family-a"],
    );
    assert.deepEqual(realtimeFamilies, ["family-a"]);
    assert.deepEqual(fcmTokens.sort(), ["fcm-child-a", "fcm-parent-b"]);
  } finally {
    globalThis.fetch = originalFetch;
    clock.restore();
    sqlite.close();
  }
});

test("일정 all-quiet는 recipient별 terminal receipt만 남기고 pending·claim·Web·FCM을 만들지 않는다", async () => {
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb();
  seedScheduleRuntime(sqlite, {
    eventId: "event-all-quiet",
    quietUserIds: ["parent-a", "parent-b", "child-a"],
  });
  const { env } = await createDeliveryFixture(sqlite);
  const capture = installPushCapture();
  try {
    const response = await pushModule.handleCronNotification(env, db);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM push_idempotency WHERE action='schedule_quiet_suppression'",
      ).get().count,
      3,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM push_idempotency WHERE action='schedule_reminder'",
      ).get().count,
      0,
    );
    assert.deepEqual(capture.fcmTokens, []);
    assert.deepEqual(capture.webEndpoints, []);
  } finally {
    capture.restore();
    clock.restore();
    sqlite.close();
  }
});

test("일정 quiet 설정 DB 오류는 receipt·pending·claim·Web·FCM 전에 fail-closed한다", async () => {
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb({ failQuietLookup: true });
  seedScheduleRuntime(sqlite, {
    eventId: "event-quiet-db-error",
    quietUserIds: ["parent-b"],
  });
  const { env } = await createDeliveryFixture(sqlite);
  const capture = installPushCapture();
  try {
    const response = await pushModule.handleCronNotification(env, db);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_idempotency").get().count, 0);
    assert.deepEqual(capture.fcmTokens, []);
    assert.deepEqual(capture.webEndpoints, []);
  } finally {
    capture.restore();
    clock.restore();
    sqlite.close();
  }
});

test("not_arrived 안전 알림은 quiet 부모도 pending·Web·FCM 대상으로 유지한다", async () => {
  const atMs = Date.parse("2026-07-18T13:30:00.000Z");
  const { sqlite, db } = createDispatchDb({ quietUserIds: ["parent-b"] });
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  ).run("member-parent-a", "family-a", "parent-a", "parent", "주 보호자");
  sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')",
  ).run("token-parent-a", "parent-a", "family-a", "fcm-parent-a");
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,1320,420)`,
  ).run("parent-a", "family-a");
  const { env } = await createDeliveryFixture(sqlite);
  const capture = installPushCapture();
  try {
    const response = await pushModule.handleInstantNotification(
      env,
      db,
      {
        action: "parent_alert",
        familyId: "family-a",
        senderUserId: "child-a",
        title: "아직 도착하지 않았어요",
        message: "도착 여부를 확인해 주세요",
        alertType: "not_arrived",
        idempotency_key: "not-arrived-bypass-runtime",
      },
      "child-a",
      "service_role",
      "not-arrived-bypass-runtime",
      { atMs },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(capture.fcmTokens.sort(), ["fcm-parent-a", "fcm-parent-b"]);
    assert.deepEqual(capture.webEndpoints, ["https://push.example.test/parent-b"]);
    assert.deepEqual(
      sqlite.prepare(
        "SELECT json_extract(data,'$.targetUserId') AS user_id FROM pending_notifications ORDER BY user_id",
      ).all().map((row) => row.user_id),
      ["parent-a", "parent-b"],
    );
  } finally {
    capture.restore();
    sqlite.close();
  }
});

test("kkuk은 urgent·critical·긴급 channel이어도 quiet를 우회하지 않고 해제 뒤에만 전달한다", async () => {
  const atMs = Date.parse("2026-07-18T13:30:00.000Z");
  const { sqlite, db } = createDispatchDb();
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  ).run("member-parent-a", "family-a", "parent-a", "parent", "주 보호자");
  sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')",
  ).run("token-parent-a", "parent-a", "family-a", "fcm-parent-a");
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,1320,420)`,
  ).run("parent-a", "family-a");
  const { env } = await createDeliveryFixture(sqlite);
  const capture = installPushCapture();
  try {
    const quietResponse = await pushModule.handleInstantNotification(
      env,
      db,
      {
        action: "kkuk",
        familyId: "family-a",
        senderUserId: "child-a",
        title: "꾹",
        message: "확인해 주세요",
        alertType: "kkuk",
        severity: "critical",
        urgent: true,
        channel: "emergency",
        idempotency_key: "kkuk-quiet-runtime",
      },
      "child-a",
      "service_role",
      "kkuk-quiet-runtime",
      { atMs },
    );
    assert.equal(quietResponse.status, 200, await quietResponse.clone().text());
    assert.deepEqual(await quietResponse.json(), {
      webSent: 0,
      fcmSent: 0,
      total: 0,
      key: "kkuk-quiet-runtime",
      suppressedQuietHours: ["parent-a"],
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_idempotency").get().count, 0);
    assert.deepEqual(capture.fcmTokens, []);

    sqlite.prepare("UPDATE notification_settings SET quiet_hours_enabled=0 WHERE user_id='parent-a'").run();
    const allowedResponse = await pushModule.handleInstantNotification(
      env,
      db,
      {
        action: "kkuk",
        familyId: "family-a",
        senderUserId: "child-a",
        title: "꾹",
        message: "확인해 주세요",
        alertType: "kkuk",
        severity: "critical",
        urgent: true,
        channel: "emergency",
        idempotency_key: "kkuk-allowed-runtime",
      },
      "child-a",
      "service_role",
      "kkuk-allowed-runtime",
      { atMs },
    );
    assert.equal(allowedResponse.status, 200, await allowedResponse.clone().text());
    assert.deepEqual(capture.fcmTokens, ["fcm-parent-a"]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 1);
  } finally {
    capture.restore();
    sqlite.close();
  }
});

test("친구놀이는 양쪽 가족 중 quiet 보호자를 제외하고 시작·종료를 허용 가족에만 보낸다", async () => {
  assert.equal(typeof pushModule.handlePlaydateStarted, "function");
  assert.equal(typeof pushModule.handlePlaydateEnded, "function");
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb({ quietUserIds: ["parent-b"] });
  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  );
  insertMember.run("member-parent-a", "family-a", "parent-a", "parent", "주 보호자");
  sqlite.prepare("INSERT INTO notification_settings(user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute) VALUES (?,?,1,1320,420)")
    .run("parent-a", "family-a");
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)")
    .run("family-b", "parent-c", "PAIR-B");
  insertMember.run("member-parent-c", "family-b", "parent-c", "parent", "친구 보호자");
  insertMember.run("member-child-b", "family-b", "child-b", "child", "친구");
  sqlite.prepare("INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')")
    .run("token-parent-c", "parent-c", "family-b", "fcm-parent-c");
  sqlite.prepare("INSERT INTO public_places(id,name,lat,lng) VALUES (?,?,?,?)")
    .run("place-playdate", "어린이공원", 37.5, 127.0);
  sqlite.prepare(
    `INSERT INTO friend_playdate_sessions
       (id,public_place_id,family_a_id,family_b_id,child_a_id,child_b_id,initiator_user_id,started_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "session-quiet-mixed",
    "place-playdate",
    "family-a",
    "family-b",
    "child-a",
    "child-b",
    "child-a",
    "2026-07-18 13:29:00.000+00",
  );
  const { env } = await createDeliveryFixture(sqlite);
  const capture = installPushCapture();
  try {
    const started = await pushModule.handlePlaydateStarted(
      env,
      db,
      { session_id: "session-quiet-mixed" },
      "system",
      "service_role",
    );
    assert.equal(started.status, 200, await started.clone().text());
    assert.deepEqual(capture.fcmTokens, ["fcm-parent-c"]);
    assert.deepEqual((await started.json()).suppressedQuietHours, ["parent-a", "parent-b"]);

    sqlite.prepare(
      "UPDATE friend_playdate_sessions SET stopped_at=?, stop_reason=? WHERE id=?",
    ).run("2026-07-18 13:31:00.000+00", "child_end", "session-quiet-mixed");
    const ended = await pushModule.handlePlaydateEnded(
      env,
      db,
      { session_id: "session-quiet-mixed" },
      "system",
      "service_role",
    );
    assert.equal(ended.status, 200, await ended.clone().text());
    assert.deepEqual(capture.fcmTokens, ["fcm-parent-c", "fcm-parent-c"]);
    assert.deepEqual((await ended.json()).suppressedQuietHours, ["parent-a", "parent-b"]);
  } finally {
    capture.restore();
    clock.restore();
    sqlite.close();
  }
});

test("부모 스티커는 quiet 아이에게 저장만 하고 해제 뒤 새 스티커만 전달한다", async () => {
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb({ quietUserIds: ["child-a"] });
  for (const userId of ["parent-a", "parent-b", "child-a"]) {
    sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
  }
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const token = await new SignJWT({ role: "parent", family_id: "family-a", is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("parent-a")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  const { env: deliveryEnv } = await createDeliveryFixture(sqlite);
  const env = {
    ...deliveryEnv,
    DB: db,
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
  const app = new Hono();
  app.route("/api/stickers", stickerRoutes);
  const capture = installPushCapture();
  const requestSticker = async (eventId) => {
    const waits = [];
    const executionCtx = {
      waitUntil(promise) { waits.push(promise); },
      passThroughOnException() {},
      props: {},
    };
    const response = await app.request(
      "http://test.local/api/stickers",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          family_id: "family-a",
          user_id: "child-a",
          event_id: eventId,
          date_key: "2026-6-18",
          sticker_type: "praise",
          emoji: "⭐",
          title: "참 잘했어",
        }),
      },
      env,
      executionCtx,
    );
    await Promise.all(waits);
    return response;
  };
  try {
    const quietResponse = await requestSticker("event-sticker-quiet");
    assert.equal(quietResponse.status, 200, await quietResponse.clone().text());
    assert.deepEqual(await quietResponse.json(), {
      ok: true,
      webSent: 0,
      fcmSent: 0,
      total: 0,
      suppressedQuietHours: ["child-a"],
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM stickers").get().count, 1);
    assert.deepEqual(capture.fcmTokens, []);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_idempotency").get().count, 0);

    sqlite.prepare("UPDATE notification_settings SET quiet_hours_enabled=0 WHERE user_id='child-a'").run();
    const allowedResponse = await requestSticker("event-sticker-allowed");
    assert.equal(allowedResponse.status, 200, await allowedResponse.clone().text());
    assert.deepEqual(capture.fcmTokens, ["fcm-child-a"]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM stickers").get().count, 2);
  } finally {
    capture.restore();
    clock.restore();
    sqlite.close();
  }
});

test("AI 선제 메시지는 quiet 아이의 pending·크레딧·원장을 전혀 변경하지 않는다", async () => {
  const childUserId = "00000000-0000-4000-8000-000000000001";
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb();
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  ).run("member-ai-child", "family-a", childUserId, "child", "혜니");
  sqlite.prepare("INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')")
    .run("token-ai-child", childUserId, "family-a", "fcm-ai-child");
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,1,1320,420)`,
  ).run(childUserId, "family-a");
  sqlite.prepare(
    `INSERT INTO ai_parent_settings
       (id,family_id,child_user_id,ai_enabled,ai_friend_name,proactive_enabled,
        proactive_start_time,proactive_end_time,quiet_hours_start,quiet_hours_end,daily_limit)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "settings-ai-quiet",
    "family-a",
    childUserId,
    1,
    "AI 친구",
    1,
    "00:00:00",
    "23:59:00",
    "23:00:00",
    "23:01:00",
    5,
  );
  sqlite.prepare(
    `INSERT INTO ai_credit_balances
       (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
        daily_included_used,daily_reset_date,purchased_credits)
     VALUES (?,?,?,?,0,5,0,?,1)`,
  ).run("credits-ai-quiet", "family-a", childUserId, "parent-a", "2026-07-18");
  const env = {
    DB: db,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
  try {
    const result = await aiModule.runSingleProactive(env, db, {
      familyId: "family-a",
      childUserId,
      usageDate: "2026-07-18",
      nowHHMM: "22:30",
      trigger: "place_arrival",
      placeName: "우리 집",
    });
    assert.equal(result.generated, 0);
    assert.equal(result.checked, 1);
    assert.deepEqual(result.results[0], {
      childUserId,
      queued: false,
      reason: "quiet_hours_suppressed",
      suppressedQuietHours: [childUserId],
      webSent: 0,
      fcmSent: 0,
      total: 0,
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ai_credit_ledger").get().count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ai_chat_messages").get().count, 0);
    const balance = sqlite.prepare(
      "SELECT daily_included_used,purchased_credits FROM ai_credit_balances WHERE id='credits-ai-quiet'",
    ).get();
    assert.equal(balance.daily_included_used, 0);
    assert.equal(balance.purchased_credits, 1);
  } finally {
    clock.restore();
    sqlite.close();
  }
});

async function createOwnerOnlyTeacherNoticeFixture({ ownerQuiet, childQuiet }) {
  const clock = installMutableClock(Date.parse("2026-07-18T13:30:00.000Z"));
  const { sqlite, db } = createDispatchDb();
  sqlite.prepare("DELETE FROM family_members WHERE family_id='family-a' AND role='parent'").run();
  sqlite.prepare("DELETE FROM fcm_tokens WHERE user_id='parent-b'").run();
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS parent_alert_idempotency (
      dedupe_key TEXT NOT NULL PRIMARY KEY,
      family_id TEXT NOT NULL,
      alert_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`,
  );
  for (const userId of ["teacher-user", "parent-a", "child-a"]) {
    sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
  }
  sqlite.prepare("INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,'android')")
    .run("token-parent-a", "parent-a", "family-a", "fcm-parent-a");
  const insertSetting = sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute)
     VALUES (?,?,?,?,?)`,
  );
  insertSetting.run("parent-a", "family-a", ownerQuiet ? 1 : 0, 1320, 420);
  insertSetting.run("child-a", "family-a", childQuiet ? 1 : 0, 1320, 420);
  sqlite.prepare("INSERT INTO teacher_profiles(id,user_id,display_name) VALUES (?,?,?)")
    .run("teacher-owner-only", "teacher-user", "담임");
  sqlite.prepare("INSERT INTO teacher_classes(id,teacher_id,class_name) VALUES (?,?,?)")
    .run("class-owner-only", "teacher-owner-only", "햇살반");
  sqlite.prepare(
    `INSERT INTO teacher_child_pairings
       (id,teacher_id,class_id,child_member_id,family_id,pairing_status)
     VALUES (?,?,?,?,?,'approved')`,
  ).run(
    "pairing-owner-only",
    "teacher-owner-only",
    "class-owner-only",
    "member-child-a",
    "family-a",
  );

  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const token = await new SignJWT({ role: "teacher", family_id: null, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("teacher-user")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  const { env: deliveryEnv } = await createDeliveryFixture(sqlite);
  const realtimeFamilies = [];
  const env = {
    ...deliveryEnv,
    DB: db,
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
    PHOTOS: { head: async () => null },
    FAMILY_ROOM: {
      idFromName: (familyId) => familyId,
      get: (familyId) => ({
        fetch: async () => {
          realtimeFamilies.push(String(familyId));
          return new Response(null, { status: 204 });
        },
      }),
    },
  };
  const app = new Hono();
  app.route("/api/teacher", teacherNoticeRoutes);
  const waits = [];
  const executionCtx = {
    waitUntil(promise) { waits.push(promise); },
    passThroughOnException() {},
    props: {},
  };
  const capture = installPushCapture();

  return {
    sqlite,
    db,
    env,
    waits,
    capture,
    realtimeFamilies,
    async postNotice() {
      return app.request(
        "http://test.local/api/teacher/notices",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            class_id: "class-owner-only",
            title: "가정통신문",
            body: "확인해 주세요",
            source_type: "text",
            events: [],
          }),
        },
        env,
        executionCtx,
      );
    },
    cleanup() {
      capture.restore();
      clock.restore();
      sqlite.close();
    },
  };
}

test("선생님 POST owner-only all-quiet는 응답 전에 terminal claim을 확정하고 재호출을 막는다", async () => {
  const fixture = await createOwnerOnlyTeacherNoticeFixture({ ownerQuiet: true, childQuiet: true });
  try {
    const response = await fixture.postNotice();
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(fixture.waits.length, 0);
    assert.deepEqual(body.suppressedQuietHours, ["child-a", "parent-a"]);
    const claim = fixture.sqlite.prepare(
      `SELECT action,first_sent_at FROM push_idempotency
        WHERE key=? AND action='teacher_notice'`,
    ).get(body.noticeId);
    assert.equal(claim?.action, "teacher_notice");
    assert.ok(claim?.first_sent_at);
    assert.deepEqual(fixture.capture.fcmTokens, []);

    fixture.sqlite.prepare(
      "UPDATE notification_settings SET quiet_hours_enabled=0 WHERE user_id IN ('parent-a','child-a')",
    ).run();
    const retry = await pushModule.handleTeacherNotice(
      fixture.env,
      fixture.db,
      { notice_id: body.noticeId },
      "teacher-user",
      "authenticated",
    );
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM parent_alerts").get().count, 0);
    assert.deepEqual(fixture.capture.fcmTokens, []);
  } finally {
    fixture.cleanup();
  }
});

test("선생님 POST는 parent member가 없는 가족의 primary owner를 수신자로 포함한다", async () => {
  const fixture = await createOwnerOnlyTeacherNoticeFixture({ ownerQuiet: false, childQuiet: true });
  try {
    const response = await fixture.postNotice();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(fixture.waits.length, 1);
    await Promise.all(fixture.waits);
    assert.deepEqual(fixture.capture.fcmTokens, ["fcm-parent-a"]);
    assert.deepEqual(
      fixture.sqlite.prepare("SELECT family_id FROM parent_alerts ORDER BY family_id").all().map((row) => row.family_id),
      ["family-a"],
    );
    assert.deepEqual(fixture.realtimeFamilies, ["family-a"]);
  } finally {
    fixture.cleanup();
  }
});

test("일정 quiet suppression key는 콜론이 든 서로 다른 tuple도 충돌하지 않는다", () => {
  assert.equal(typeof pushModule.scheduleQuietSuppressionKey, "function");
  const left = pushModule.scheduleQuietSuppressionKey({
    familyId: "family:a",
    eventId: "event",
    dateKey: "2026-6-18",
    revision: "revision",
    windowKey: "5m",
  }, "recipient");
  const right = pushModule.scheduleQuietSuppressionKey({
    familyId: "family",
    eventId: "a:event",
    dateKey: "2026-6-18",
    revision: "revision",
    windowKey: "5m",
  }, "recipient");
  assert.notEqual(left, right);
  assert.match(left, /^quiet:schedule:/);
  assert.match(right, /^quiet:schedule:/);
});
