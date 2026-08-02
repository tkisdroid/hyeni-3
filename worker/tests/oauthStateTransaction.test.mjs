import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

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
  cancelOAuthTransaction,
  consumeOAuthTransaction,
  createOAuthTransaction,
  markOAuthCallback,
  parseOAuthPrepareBody,
  resolveOAuthRedirectTarget,
} = await import("../lib/oauthState.ts");

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
      client_kind TEXT NOT NULL,
      redirect_target TEXT NOT NULL,
      flow_mode TEXT NOT NULL,
      user_id TEXT,
      authorization_code_hash TEXT,
      callback_received_at TEXT,
      consumed_at TEXT,
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
  assert.equal(resolveOAuthRedirectTarget("web", "https://hyeni-calendar.pages.dev"), "https://hyeni-calendar.pages.dev");
  for (const target of [
    "https://evil.example",
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
});

test("콜백 code와 state를 서버 트랜잭션에 결합하고 정확히 한 번만 소비한다", async () => {
  const { db } = createDb();
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
