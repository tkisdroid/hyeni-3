import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exportJWK, generateKeyPair } from "jose";

import {
  signAccessToken,
  signRealtimeTicket,
  verifyAccessToken,
  verifyRealtimeTicket,
} from "../lib/jwt.ts";
import {
  closeExpiredRealtimeSocketsAndCount,
  consumeRealtimeTicket,
  hashRealtimeTarget,
  isRealtimeTicketRequestBody,
  MAX_ACTIVE_REALTIME_TICKETS_PER_USER,
  MAX_ACTIVE_REALTIME_SOCKETS_PER_ROOM,
  MAX_ACTIVE_REALTIME_SOCKETS_PER_USER,
  REALTIME_SOCKET_RETRY_AFTER_SECONDS,
  realtimeTicketCapacityRetryAfter,
  realtimeSocketCapacityExceeded,
  resolveRealtimeTicketStoreFailure,
  storeRealtimeTicket,
} from "../lib/realtimeTicket.ts";

function socketWithTokenExp(tokenExp) {
  return {
    closed: null,
    deserializeAttachment() {
      return { tokenExp };
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

test("ticket 소비 반복으로 실제 realtime socket 상한을 우회할 수 없다", () => {
  assert.equal(realtimeSocketCapacityExceeded(0, 0), null);
  assert.equal(
    realtimeSocketCapacityExceeded(7, MAX_ACTIVE_REALTIME_SOCKETS_PER_USER),
    "user",
  );
  assert.equal(
    realtimeSocketCapacityExceeded(MAX_ACTIVE_REALTIME_SOCKETS_PER_ROOM, 0),
    "room",
  );
  assert.equal(realtimeSocketCapacityExceeded(-1, 0), "room");
});

test("Family/Teacher 공통 상한 계산은 만료·손상 hibernated socket을 먼저 닫고 제외한다", () => {
  const activeForUser = socketWithTokenExp(2_000);
  const activeForOther = socketWithTokenExp(2_001);
  const expiredForUser = socketWithTokenExp(1_000);
  const malformed = socketWithTokenExp("2000");
  const result = closeExpiredRealtimeSocketsAndCount(
    [activeForUser, activeForOther, expiredForUser, malformed],
    [activeForUser, expiredForUser],
    1_000,
  );
  assert.deepEqual(result, { activeRoomSockets: 2, activeUserSockets: 1 });
  assert.deepEqual(expiredForUser.closed, { code: 1008, reason: "token_expired" });
  assert.deepEqual(malformed.closed, { code: 1008, reason: "token_expired" });
  assert.equal(activeForUser.closed, null);
  assert.equal(activeForOther.closed, null);

  const family = readFileSync(new URL("../realtime/FamilyRoom.ts", import.meta.url), "utf8");
  const teacher = readFileSync(new URL("../realtime/TeacherRoom.ts", import.meta.url), "utf8");
  for (const source of [family, teacher]) {
    assert.match(source, /closeExpiredRealtimeSocketsAndCount\(/);
    assert.match(source, /realtimeSocketCapacityExceeded\(/);
    assert.match(source, /status:\s*429/);
    assert.match(source, /REALTIME_SOCKET_RETRY_AFTER_SECONDS/);
    assert.ok(
      source.indexOf("closeExpiredRealtimeSocketsAndCount(")
        < source.indexOf("realtimeSocketCapacityExceeded("),
    );
    assert.ok(
      source.indexOf("realtimeSocketCapacityExceeded(")
        < source.indexOf("this.state.acceptWebSocket(server"),
    );
  }
  assert.equal(REALTIME_SOCKET_RETRY_AFTER_SECONDS, 30);
});

async function jwtEnv() {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  return {
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
}

class MemoryTransaction {
  constructor(rows) {
    this.rows = rows;
  }

  async get(key) {
    return this.rows.get(key);
  }

  async put(key, value) {
    this.rows.set(key, structuredClone(value));
  }

  async delete(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    let deleted = 0;
    for (const key of list) deleted += this.rows.delete(key) ? 1 : 0;
    return deleted;
  }

  async list({ prefix = "", limit = Number.MAX_SAFE_INTEGER } = {}) {
    return new Map(
      [...this.rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit),
    );
  }
}

class MemoryStorage {
  constructor() {
    this.rows = new Map();
    this.queue = Promise.resolve();
  }

  transaction(callback) {
    const run = this.queue.then(() => callback(new MemoryTransaction(this.rows)));
    this.queue = run.catch(() => {});
    return run;
  }
}

test("realtime ticket은 목적·대상 hash·45초 이하 만료만 담고 access JWT와 구분된다", async () => {
  const env = await jwtEnv();
  const now = Math.floor(Date.now() / 1000);
  const ticketId = "123e4567-e89b-42d3-a456-426614174000";
  const targetHash = await hashRealtimeTarget("family", "family-1");
  const ticket = await signRealtimeTicket(env, {
    ticketId,
    targetKind: "family",
    targetHash,
    issuedAt: now,
    expiresAt: now + 45,
  });
  const claims = await verifyRealtimeTicket(env, ticket);
  assert.equal(claims.jti, ticketId);
  assert.equal(claims.target_kind, "family");
  assert.equal(claims.target_hash, targetHash);
  assert.equal(claims.exp - claims.iat, 45);
  assert.equal(claims.sub, undefined);
  await assert.rejects(() => verifyAccessToken(env, ticket), /invalid_access_token/);

  const access = await signAccessToken(env, {
    sub: "user-1",
    role: "child",
    family_id: "family-1",
    is_anonymous: false,
  });
  await assert.rejects(() => verifyRealtimeTicket(env, access), /invalid_realtime_ticket/);
});

test("access verifier는 필수 claim과 token purpose를 엄격히 분리한다", async () => {
  const env = await jwtEnv();
  const valid = await signAccessToken(env, {
    sub: "user-1",
    role: "parent",
    family_id: "family-1",
    is_anonymous: false,
  });
  const validClaims = await verifyAccessToken(env, valid);
  assert.equal(validClaims.sub, "user-1");
  assert.match(validClaims.jti, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const next = await signAccessToken(env, {
    sub: "user-1",
    role: "parent",
    family_id: "family-1",
    is_anonymous: false,
  });
  assert.notEqual((await verifyAccessToken(env, next)).jti, validClaims.jti);

  const now = Math.floor(Date.now() / 1000);
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const wrongEnv = {
    ...env,
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
  };
  const malformed = await signRealtimeTicket(wrongEnv, {
    ticketId: "123e4567-e89b-42d3-a456-426614174009",
    targetKind: "family",
    targetHash: await hashRealtimeTarget("family", "family-1"),
    issuedAt: now,
    expiresAt: now + 45,
  });
  await assert.rejects(() => verifyAccessToken(env, malformed), /invalid_access_token/);
});

test("realtime ticket 본문은 JSON object만 허용한다", () => {
  for (const invalid of [null, [], "family-1", 1, true]) {
    assert.equal(isRealtimeTicketRequestBody(invalid), false);
  }
  assert.equal(isRealtimeTicketRequestBody({ familyId: "family-1" }), true);
  assert.equal(isRealtimeTicketRequestBody({ familyId: "family-1", teacherId: "teacher-1" }), true);

  const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(index, /if \(!isRealtimeTicketRequestBody\(body\)\)/);
  assert.match(index, /return c\.json\(\{ error: "invalid_json" \}, 400\)/);
  assert.match(index, /\(familyId \? 1 : 0\) \+ \(teacherId \? 1 : 0\) !== 1/);
});

test("Durable Object ticket 저장소는 ticket을 원자적으로 한 번만 소비한다", async () => {
  const storage = new MemoryStorage();
  const ticketId = "123e4567-e89b-42d3-a456-426614174001";
  const stored = {
    userId: "user-1",
    role: "parent",
    tokenExp: 2_000,
    ticketExp: 1_045,
  };
  await storeRealtimeTicket(storage, ticketId, stored, 1_000);

  const [first, second] = await Promise.all([
    consumeRealtimeTicket(storage, ticketId, 1_001),
    consumeRealtimeTicket(storage, ticketId, 1_001),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.deepEqual(first ?? second, stored);
});

test("만료 ticket은 소비 시 폐기하고 연결 권한을 반환하지 않는다", async () => {
  const storage = new MemoryStorage();
  const ticketId = "123e4567-e89b-42d3-a456-426614174002";
  await storeRealtimeTicket(storage, ticketId, {
    userId: "user-1",
    role: "child",
    tokenExp: 2_000,
    ticketExp: 1_010,
  }, 1_000);
  assert.equal(await consumeRealtimeTicket(storage, ticketId, 1_011), null);
  assert.equal(await consumeRealtimeTicket(storage, ticketId, 1_001), null);
});

test("단일 사용자의 미소비 ticket은 사용자별 상한에서 막고 다른 사용자의 room 연결은 유지한다", async () => {
  const storage = new MemoryStorage();
  const now = 1_000;
  for (let index = 0; index < MAX_ACTIVE_REALTIME_TICKETS_PER_USER; index += 1) {
    await storeRealtimeTicket(storage, `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, {
      userId: "user-attacker",
      role: "parent",
      tokenExp: 2_000,
      ticketExp: now + 20 + index,
    }, now);
  }

  await assert.rejects(
    () => storeRealtimeTicket(storage, "00000000-0000-4000-8000-000000000099", {
      userId: "user-attacker",
      role: "parent",
      tokenExp: 2_000,
      ticketExp: now + 45,
    }, now),
    (error) => {
      assert.equal(error?.message, "realtime_ticket_capacity");
      assert.equal(realtimeTicketCapacityRetryAfter(error), 20);
      return true;
    },
  );

  await storeRealtimeTicket(storage, "00000000-0000-4000-8000-000000000100", {
    userId: "user-legitimate",
    role: "child",
    tokenExp: 2_000,
    ticketExp: now + 45,
  }, now);
  assert.equal((await consumeRealtimeTicket(
    storage,
    "00000000-0000-4000-8000-000000000100",
    now + 1,
  ))?.userId, "user-legitimate");
});

test("DO의 ticket 제한은 Worker 응답에서도 정확한 429와 Retry-After로 보존한다", () => {
  assert.deepEqual(
    resolveRealtimeTicketStoreFailure(new Response("realtime_ticket_capacity", {
      status: 429,
      headers: { "Retry-After": "17" },
    })),
    {
      status: 429,
      error: "realtime_ticket_rate_limited",
      retryAfterSeconds: 17,
    },
  );
  assert.deepEqual(
    resolveRealtimeTicketStoreFailure(new Response("ticket_store_failed", { status: 503 })),
    { status: 503, error: "realtime_ticket_unavailable" },
  );

  const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(index, /resolveRealtimeTicketStoreFailure\(storeResponse\)/);
  assert.match(index, /c\.header\("Retry-After", String\(storeFailure\.retryAfterSeconds\)\)/);
  assert.match(index, /realtime_ticket_rate_limited/);
});

test("Worker URL 인증은 full access JWT query fallback을 제공하지 않는다", () => {
  const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../routes/storage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /c\.req\.query\(["']token["']\)/);
  assert.doesNotMatch(storage, /c\.req\.query\(["']token["']\)/);
  assert.match(index, /searchParams\.delete\(["']ticket["']\)/);
  assert.match(index, /app\.post\(["']\/api\/realtime\/ticket["'],\s*requireAuth/);
  assert.match(index, /expires_in:\s*ticketExp - now/);
  assert.doesNotMatch(storage, /private, max-age=/);
  assert.equal((storage.match(/private, no-store/g) ?? []).length, 2);
});
