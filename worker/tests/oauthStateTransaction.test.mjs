import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { runInNewContext } from "node:vm";

const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${new URL(specifier, context.parentURL).href}${extension}`);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => typeScriptResolutionHook.deregister());

const {
  appendOAuthCallbackQuery,
  acknowledgeOAuthRecovery,
  cancelOAuthTransaction,
  consumeOAuthTransaction,
  createOAuthTransaction,
  markOAuthCallback,
  parseOAuthPrepareBody,
  readOAuthRecovery,
  resolveOAuthRedirectTarget,
} = await import("../lib/oauthState.ts");
const {
  createAndroidOAuthIntentUrl,
  oauthCallbackResponse,
} = await import("../lib/oauthCallbackPage.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE oauth_state_transactions (
      state_hash TEXT PRIMARY KEY,
      transaction_secret_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      client_kind TEXT NOT NULL CHECK (client_kind IN ('native', 'web')),
      redirect_target TEXT NOT NULL,
      flow_mode TEXT NOT NULL,
      user_id TEXT,
      authorization_code_hash TEXT,
      callback_received_at TEXT,
      consumed_at TEXT,
      recovery_id_hash TEXT,
      recovery_binding_hash TEXT,
      recovery_user_id TEXT,
      recovery_account_status TEXT,
      recovery_access_jti TEXT,
      recovery_refresh_token_hash TEXT,
      recovery_ready_at TEXT,
      recovery_expires_at TEXT,
      recovery_acknowledged_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

const NOW = new Date("2026-07-14T00:00:00.000Z");

test("OAuth 복귀 대상은 고정 앱 딥링크와 승인된 정확한 웹 origin만 허용한다", () => {
  assert.equal(
    resolveOAuthRedirectTarget("native", "https://evil.example"),
    "https://hyeni-calendar.pages.dev/oauth/callback",
  );
  assert.equal(
    resolveOAuthRedirectTarget("ios", "https://evil.example"),
    "com.hyeni.calendar.oauth://oauth/callback",
  );
  assert.equal(resolveOAuthRedirectTarget("web", "https://hyeni-calendar.pages.dev"), "https://hyeni-calendar.pages.dev");
  assert.equal(resolveOAuthRedirectTarget("web", "https://hyenicalendar.com"), "https://hyenicalendar.com");
  assert.equal(
    resolveOAuthRedirectTarget("web", "https://www.hyenicalendar.com"),
    "https://www.hyenicalendar.com",
  );
  for (const target of [
    "https://evil.example",
    "https://hyenicalendar.com.evil.example",
    "https://www.hyenicalendar.com/path",
    "https://hyeni-calendar.pages.dev.evil.example",
    "https://hyeni-calendar.pages.dev/path",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(resolveOAuthRedirectTarget("web", target), null, target);
  }
  assert.equal(parseOAuthPrepareBody({ client: "web", webOrigin: "https://evil.example" }), null);
  assert.deepEqual(parseOAuthPrepareBody({ client: "native", webOrigin: "https://evil.example" }), {
    clientKind: "native",
    webOrigin: "https://evil.example",
  });
  assert.deepEqual(parseOAuthPrepareBody({ client: "ios", webOrigin: "https://evil.example" }), {
    clientKind: "ios",
    webOrigin: "https://evil.example",
  });
});

test("iOS OAuth start는 기존 운영 client_kind CHECK와 호환하면서 iOS redirect를 보존한다", async () => {
  const { db, sqlite } = createDb();
  const transaction = await createOAuthTransaction(db, {
    provider: "google",
    clientKind: "ios",
    flowMode: "login",
  }, NOW);
  assert.equal(transaction.redirectTarget, "com.hyeni.calendar.oauth://oauth/callback");
  const stored = sqlite.prepare(
    "SELECT client_kind,redirect_target FROM oauth_state_transactions",
  ).get();
  assert.deepEqual({ ...stored }, {
    client_kind: "native",
    redirect_target: "com.hyeni.calendar.oauth://oauth/callback",
  });
});

test("콜백 code와 state를 서버 트랜잭션에 결합하고 정확히 한 번만 소비한다", async () => {
  const { db, sqlite } = createDb();
  const tx = await createOAuthTransaction(db, {
    provider: "google",
    clientKind: "web",
    webOrigin: "https://hyeni-calendar.pages.dev",
    flowMode: "login",
  }, NOW);
  assert.equal(tx.state.length >= 40, true);
  assert.equal(tx.transactionSecret.length >= 40, true);

  assert.equal(await markOAuthCallback(db, "kakao", tx.state, "code-1", NOW), null);
  assert.deepEqual(await markOAuthCallback(db, "google", tx.state, "code-1", NOW), {
    redirectTarget: "https://hyeni-calendar.pages.dev",
    flowMode: "login",
  });
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google", state: tx.state, code: "swapped-code", transactionSecret: tx.transactionSecret, flowMode: "login",
  }, NOW), false);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google", state: tx.state, code: "code-1", transactionSecret: tx.transactionSecret, flowMode: "link", userId: "user-1",
  }, NOW), false);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google", state: tx.state, code: "code-1", transactionSecret: "wrong-secret", flowMode: "login",
  }, NOW), false);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google", state: tx.state, code: "code-1", transactionSecret: tx.transactionSecret, flowMode: "login",
  }, NOW), true);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google", state: tx.state, code: "code-1", transactionSecret: tx.transactionSecret, flowMode: "login",
  }, NOW), false);
});

test("계정 연결 state는 시작한 로그인 사용자에게 결합된다", async () => {
  const { db } = createDb();
  const tx = await createOAuthTransaction(db, {
    provider: "kakao",
    clientKind: "native",
    flowMode: "link",
    userId: "parent-1",
  }, NOW);
  await markOAuthCallback(db, "kakao", tx.state, "link-code", NOW);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "kakao", state: tx.state, code: "link-code", transactionSecret: tx.transactionSecret, flowMode: "link", userId: "parent-2",
  }, NOW), false);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "kakao", state: tx.state, code: "link-code", transactionSecret: tx.transactionSecret, flowMode: "link", userId: "parent-1",
  }, NOW), true);
});

test("만료·오류·취소 state는 교환되지 않는다", async () => {
  const { db } = createDb();
  const expired = await createOAuthTransaction(db, {
    provider: "naver", clientKind: "native", flowMode: "login",
  }, NOW);
  const later = new Date(NOW.getTime() + 11 * 60 * 1000);
  assert.equal(await markOAuthCallback(db, "naver", expired.state, "late-code", later), null);

  const canceled = await createOAuthTransaction(db, {
    provider: "naver", clientKind: "native", flowMode: "login",
  }, NOW);
  assert.deepEqual(await cancelOAuthTransaction(db, "naver", canceled.state, NOW), {
    redirectTarget: "https://hyeni-calendar.pages.dev/oauth/callback",
    flowMode: "login",
  });
  assert.equal(await markOAuthCallback(db, "naver", canceled.state, "code", NOW), null);
});

test("콜백 URL은 승인된 target에 인코딩된 값만 붙인다", () => {
  const url = appendOAuthCallbackQuery("https://hyeni-calendar.pages.dev", {
    provider: "google",
    code: "a</script>&b",
    state: "state",
  });
  assert.equal(url.startsWith("https://hyeni-calendar.pages.dev?"), true);
  assert.equal(url.includes("</script>"), false);
  assert.equal(new URL(url).searchParams.get("code"), "a</script>&b");
});

test("Android 네이티브 OAuth 완료 페이지는 정확한 앱 패키지 intent로 첫 복귀를 보장한다", async () => {
  const callbackUrl = "https://hyeni-calendar.pages.dev/oauth/callback?provider=kakao&code=CODE123&state=STATE123";
  const intentUrl = createAndroidOAuthIntentUrl(callbackUrl);
  assert.equal(
    intentUrl,
    "intent://oauth/callback?provider=kakao&code=CODE123&state=STATE123#Intent;scheme=com.hyeni.calendar.oauth;package=com.hyeni.calendar;end",
  );
  assert.equal(createAndroidOAuthIntentUrl("https://hyeni-calendar.pages.dev.evil/oauth/callback?code=C"), null);
  assert.equal(createAndroidOAuthIntentUrl("https://hyeni-calendar.pages.dev/invite?code=C"), null);

  const html = await oauthCallbackResponse("카카오", callbackUrl).text();
  assert.match(html, /intent:\/\/oauth\/callback\?provider=kakao&amp;code=CODE123&amp;state=STATE123#Intent;scheme=com\.hyeni\.calendar\.oauth;package=com\.hyeni\.calendar;end/);
  assert.match(html, /location\.replace\("intent:\/\/oauth\/callback/);
  assert.match(html, />앱 열기<\/a>/);
});

test("Google 본인 확인 화면이 콜백 로드와 겹쳐도 브라우저 focus 복귀 시 앱을 다시 연다", async () => {
  const callbackUrl = "https://hyeni-calendar.pages.dev/oauth/callback?provider=google&code=CODE123&state=STATE123";
  const html = await oauthCallbackResponse("구글", callbackUrl).text();

  assert.doesNotMatch(html, /document\.hasFocus\(\)/);
  assert.match(html, /addEventListener\("focus",\s*launch/);
  assert.match(html, /addEventListener\("pageshow",\s*launch/);
  assert.match(html, /addEventListener\("visibilitychange",\s*launch/);
  assert.match(html, /setTimeout\(launch,\s*250\)/);
  assert.match(html, /setTimeout\(launch,\s*1000\)/);

  const script = html.match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(script);
  const launched = [];
  const listeners = new Map();
  const timers = new Map();
  runInNewContext(script, {
    Date: { now: () => 1_000 },
    document: {
      visibilityState: "visible",
      addEventListener: (event, handler) => listeners.set(`document:${event}`, handler),
    },
    location: { replace: (target) => launched.push(target) },
    addEventListener: (event, handler) => listeners.set(event, handler),
    setTimeout: (handler, delay) => {
      timers.set(delay, handler);
      return 0;
    },
  });
  assert.equal(launched.length, 1);
  assert.equal(launched[0], createAndroidOAuthIntentUrl(callbackUrl));

  timers.get(250)();
  assert.equal(launched.length, 2, "Chrome 주소창이 focus를 가진 경우에도 지연 재시도해야 합니다");
});

test("비정상적으로 큰 state·code·transaction secret은 해시·DB 접근 전에 거부한다", async () => {
  const { db } = createDb();
  const huge = "x".repeat(9_000);
  assert.equal(await markOAuthCallback(db, "google", huge, "code", NOW), null);
  assert.equal(await markOAuthCallback(db, "google", "state", huge, NOW), null);
  assert.equal(await cancelOAuthTransaction(db, "google", huge, NOW), null);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google",
    state: huge,
    code: "code",
    transactionSecret: "secret",
    flowMode: "login",
  }, NOW), false);
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google",
    state: "state",
    code: "code",
    transactionSecret: huge,
    flowMode: "login",
  }, NOW), false);
});

test("네이티브 OAuth recovery는 hash+device binding만 저장하고 ACK 전까지 at-least-once로 읽힌다", async () => {
  assert.equal(typeof readOAuthRecovery, "function");
  assert.equal(typeof acknowledgeOAuthRecovery, "function");

  const { db, sqlite } = createDb();
  const tx = await createOAuthTransaction(db, {
    provider: "google",
    clientKind: "native",
    flowMode: "login",
  }, NOW);
  await markOAuthCallback(db, "google", tx.state, "recovery-code", NOW);
  const recoveryId = "R".repeat(43);
  const deviceId = "native-install-recovery";

  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google",
    state: tx.state,
    code: "recovery-code",
    transactionSecret: tx.transactionSecret,
    flowMode: "login",
    recovery: { id: recoveryId, deviceId },
  }, NOW), true);

  const stored = sqlite.prepare(`SELECT recovery_id_hash,recovery_binding_hash,recovery_user_id,
    recovery_account_status,recovery_access_jti,recovery_refresh_token_hash,
    recovery_ready_at,recovery_expires_at,recovery_acknowledged_at
    FROM oauth_state_transactions`).get();
  assert.equal(typeof stored.recovery_id_hash, "string");
  assert.equal(typeof stored.recovery_binding_hash, "string");
  assert.notEqual(stored.recovery_id_hash, recoveryId);
  assert.notEqual(stored.recovery_binding_hash, deviceId);
  assert.equal(JSON.stringify(stored).includes(recoveryId), false);
  assert.equal(JSON.stringify(stored).includes(deviceId), false);

  assert.deepEqual(await readOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId,
  }, NOW), { status: "pending" });
  sqlite.prepare(`UPDATE oauth_state_transactions
    SET recovery_user_id='parent-1', recovery_account_status='existing',
        recovery_access_jti='16b217ba-200f-45e2-b728-d08e95acff1a',
        recovery_refresh_token_hash=?, recovery_ready_at='2026-07-14 00:00:00+00'`)
    .run("r".repeat(43));

  const expectedReady = {
    status: "ready",
    userId: "parent-1",
    accountStatus: "existing",
    accessJti: "16b217ba-200f-45e2-b728-d08e95acff1a",
    refreshTokenHash: "r".repeat(43),
  };
  assert.deepEqual(await readOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId,
  }, NOW), expectedReady);
  assert.deepEqual(await readOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId,
  }, new Date(NOW.getTime() + 1_000)), expectedReady, "ACK 전 응답 유실은 같은 device에서 재발급할 수 있어야 합니다");
  assert.equal(await readOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId: "other-device",
  }, NOW), null);
  assert.equal(await acknowledgeOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId, userId: "other-user",
    accessJti: "16b217ba-200f-45e2-b728-d08e95acff1a",
  }, NOW), false);
  assert.equal(await acknowledgeOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId, userId: "parent-1",
    accessJti: "8c6ad2a7-2013-44fc-9bed-823d08e783d4",
  }, NOW), false, "같은 user/device라도 다른 access generation은 ACK할 수 없습니다");
  assert.equal(await acknowledgeOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId, userId: "parent-1",
    accessJti: "16b217ba-200f-45e2-b728-d08e95acff1a",
  }, NOW), true);
  assert.equal(await readOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId,
  }, NOW), null, "인증된 completion ACK 뒤에는 replay를 닫아야 합니다");
});

test("OAuth recovery ready 결과는 짧은 TTL 뒤 재발급되지 않는다", async () => {
  assert.equal(typeof readOAuthRecovery, "function");
  const { db, sqlite } = createDb();
  const tx = await createOAuthTransaction(db, {
    provider: "google", clientKind: "native", flowMode: "login",
  }, NOW);
  await markOAuthCallback(db, "google", tx.state, "ttl-code", NOW);
  const recoveryId = "T".repeat(43);
  const deviceId = "ttl-native-install";
  assert.equal(await consumeOAuthTransaction(db, {
    provider: "google", state: tx.state, code: "ttl-code", transactionSecret: tx.transactionSecret,
    flowMode: "login", recovery: { id: recoveryId, deviceId },
  }, NOW), true);
  sqlite.prepare(`UPDATE oauth_state_transactions
    SET recovery_user_id='parent-ttl', recovery_account_status='created',
        recovery_access_jti='0b655668-a05d-41fd-84bf-50da93072ec3',
        recovery_refresh_token_hash=?, recovery_ready_at='2026-07-14 00:00:00+00'`)
    .run("t".repeat(43));
  assert.equal(await readOAuthRecovery(db, {
    provider: "google", recoveryId, deviceId,
  }, new Date(NOW.getTime() + 5 * 60 * 1000 + 1)), null);
});

test("OAuth recovery는 web/link·실패한 transaction claim·TTL 밖에서 열리지 않는다", async () => {
  assert.equal(typeof readOAuthRecovery, "function");
  const recoveryId = "B".repeat(43);
  const deviceId = "native-install-bounded";

  const web = createDb();
  const webTx = await createOAuthTransaction(web.db, {
    provider: "google", clientKind: "web", webOrigin: "https://hyeni-calendar.pages.dev", flowMode: "login",
  }, NOW);
  await markOAuthCallback(web.db, "google", webTx.state, "web-code", NOW);
  assert.equal(await consumeOAuthTransaction(web.db, {
    provider: "google", state: webTx.state, code: "web-code", transactionSecret: webTx.transactionSecret,
    flowMode: "login", recovery: { id: recoveryId, deviceId },
  }, NOW), false, "웹 transaction은 native recovery로 승격하면 안 됩니다");

  const native = createDb();
  const nativeTx = await createOAuthTransaction(native.db, {
    provider: "kakao", clientKind: "native", flowMode: "login",
  }, NOW);
  await markOAuthCallback(native.db, "kakao", nativeTx.state, "native-code", NOW);
  assert.equal(await consumeOAuthTransaction(native.db, {
    provider: "kakao", state: nativeTx.state, code: "wrong-code", transactionSecret: nativeTx.transactionSecret,
    flowMode: "login", recovery: { id: recoveryId, deviceId },
  }, NOW), false);
  assert.equal(await readOAuthRecovery(native.db, {
    provider: "kakao", recoveryId, deviceId,
  }, NOW), null, "transaction claim 실패가 recovery handle을 만들면 안 됩니다");

  const weak = createDb();
  const weakTx = await createOAuthTransaction(weak.db, {
    provider: "google", clientKind: "native", flowMode: "login",
  }, NOW);
  await markOAuthCallback(weak.db, "google", weakTx.state, "weak-recovery-code", NOW);
  assert.equal(await consumeOAuthTransaction(weak.db, {
    provider: "google",
    state: weakTx.state,
    code: "weak-recovery-code",
    transactionSecret: weakTx.transactionSecret,
    flowMode: "login",
    recovery: { id: "16b217ba-200f-45e2-b728-d08e95acff1a", deviceId },
  }, NOW), false, "UUID 1개 엔트로피의 recovery bearer를 허용하면 안 됩니다");
  assert.equal(
    weak.sqlite.prepare("SELECT consumed_at FROM oauth_state_transactions").get().consumed_at,
    null,
    "약한 recovery ID 거부가 정상 transaction을 소비해서도 안 됩니다",
  );
});
