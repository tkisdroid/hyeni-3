import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");

test("OAuth state·별도 secret·mode를 두 저장소에 동일하게 저장하고 readback한다", () => {
  assert.match(src, /function writeOAuthContext/);
  assert.match(src, /for \(const store of \[window\.sessionStorage, window\.localStorage\]\)[\s\S]{0,200}setItem\(OAUTH_CONTEXT_KEY/);
  assert.match(src, /store\.getItem\(OAUTH_CONTEXT_KEY\) !== serialized/);
  assert.match(src, /writeOAuthContext\(\{[\s\S]{0,200}transactionSecret/);
});

test("OAuth context는 일치하는 callback만 소비하고 복구 가능한 login은 성공 검증 뒤 닫는다", () => {
  assert.match(src, /function takeMatchingOAuthContext/);
  assert.match(src, /context\.mode !== expected\.mode[\s\S]{0,200}context\.state !== expected\.state/);
  assert.match(src, /clearOAuthContext\(\)/);
  assert.match(src, /const context = takeMatchingOAuthContext\(/);
  assert.match(src, /function clearOAuthContextIfCurrent/);
  assert.match(src, /if \(!data\?\.session\?\.access_token\)[\s\S]{0,180}clearOAuthContextIfCurrent\(context\)/);
});

test("context가 없거나 state·provider·mode가 다르면 네트워크 전에 중단한다", () => {
  assert.match(src, /readMatchingOAuthContext\(\{[\s\S]{0,160}provider: input\.provider,[\s\S]{0,160}mode: "login",[\s\S]{0,160}state: input\.state/);
  assert.match(src, /if \(!context\) \{\s*throw new ApiError\("invalid_oauth_transaction", 400\)/);
  // 교환 POST 는 대조 이후에만 일어나야 한다.
  assert.ok(
    src.indexOf("const context = readMatchingOAuthContext({") < src.indexOf("oauthExchangePath(input.provider)"),
    "context 대조가 code 교환보다 앞서야 한다",
  );
});

test("새 OAuth 시작은 start 요청보다 먼저 이전 transaction을 포기한다", () => {
  const start = src.slice(src.indexOf("export async function startWorkerOAuth"), src.indexOf("/** OAuth 콜백에서"));
  assert.ok(start.indexOf("abandonPendingOAuth()") >= 0);
  assert.ok(start.indexOf("abandonPendingOAuth()") < start.indexOf("apiRequest<OAuthStartResponse>"));
});

test("OAuth device bridge·code exchange·account link는 AbortController deadline으로 영구 busy를 막는다", () => {
  const finishStart = src.indexOf("export async function finishOAuthLogin");
  const finish = src.slice(finishStart, src.indexOf("export type OAuthRecoveryResponse", finishStart));
  assert.match(finish, /withOperationDeadline\([\s\S]{0,120}getAuthDeviceDescriptor\(\)/);
  assert.match(finish, /const controller = new AbortController\(\)/);
  assert.match(finish, /timeoutMs: 20_000[\s\S]{0,100}controller\.abort\(\)/);

  const linkStart = src.indexOf("export async function linkOAuthAccount");
  const link = src.slice(linkStart, src.indexOf("export function finishOAuthCancellation", linkStart));
  assert.match(link, /withOperationDeadline\(/);
  assert.match(link, /errorCode: "oauth_link_timeout"/);
  assert.match(link, /onTimeout: \(\) => controller\.abort\(\)/);
});

test("sessionStorage 를 직접 읽고 쓰는 잔여 경로가 없다(단일 출처)", () => {
  const direct = src.match(/window\.sessionStorage\.(getItem|setItem|removeItem)/g) ?? [];
  const inHelpers = src.match(/for \(const store of \[window\.sessionStorage, window\.localStorage\]\)/g) ?? [];
  assert.equal(direct.length, 0, `sessionStorage 직접 접근이 남아 있다: ${direct.join(", ")}`);
  assert.ok(inHelpers.length >= 3, "context 헬퍼가 두 저장소를 함께 다뤄야 한다");
});

test("start 응답은 state·secret 타입/길이와 미래 만료시각을 검증한 뒤에만 저장한다", () => {
  assert.match(src, /function validateOAuthStartResponse/);
  assert.match(src, /typeof response\.state !== "string"/);
  assert.match(src, /response\.state\.length < 40/);
  assert.match(src, /typeof response\.transactionSecret !== "string"/);
  assert.match(src, /expiresAt <= Date\.now\(\)/);
  assert.ok(
    src.indexOf("validateOAuthStartResponse(response)") < src.indexOf("writeOAuthContext({"),
    "검증이 context 저장보다 먼저여야 한다",
  );
});

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("사용자가 OAuth 브라우저를 중단하고 인증 화면을 떠나면 남은 transaction을 폐기한다", async () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const pendingContext = JSON.stringify({
    provider: "kakao",
    mode: "login",
    state: "s".repeat(40),
    transactionSecret: "t".repeat(40),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  for (const store of [sessionStorage, localStorage]) {
    store.setItem("hyeni-oauth-context-v2", pendingContext);
    store.setItem("hyeni-oauth-state", "legacy-state");
    store.setItem("hyeni-oauth-provider", "kakao");
    store.setItem("hyeni-oauth-mode", "login");
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const auth = await import("../src/lib/api/endpoints/auth.ts");
    assert.equal(auth.hasLocalOAuthContext(), true, "사전조건: 중단된 OAuth context가 있어야 합니다");
    assert.equal(typeof auth.abandonPendingOAuth, "function", "명시적 OAuth 이탈 API가 필요합니다");

    auth.abandonPendingOAuth();

    assert.equal(auth.hasLocalOAuthContext(), false);
    for (const store of [sessionStorage, localStorage]) {
      assert.equal(store.getItem("hyeni-oauth-context-v2"), null);
      assert.equal(store.getItem("hyeni-oauth-state"), null);
      assert.equal(store.getItem("hyeni-oauth-provider"), null);
      assert.equal(store.getItem("hyeni-oauth-mode"), null);
    }
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: previousWindow,
      });
    }
  }
});

test("늦게 도착한 이전 callback은 새 OAuth transaction을 삭제하지 않는다", async () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const currentContext = JSON.stringify({
    provider: "google",
    mode: "link",
    state: "n".repeat(40),
    transactionSecret: "u".repeat(40),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  for (const store of [sessionStorage, localStorage]) {
    store.setItem("hyeni-oauth-context-v2", currentContext);
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const auth = await import("../src/lib/api/endpoints/auth.ts");
    assert.equal(
      auth.peekMatchingOAuthFlowMode?.({
        provider: "kakao",
        state: "o".repeat(40),
      }),
      null,
      "늦은 A callback을 현재 B 흐름으로 분류하면 안 됩니다",
    );
    await assert.rejects(
      auth.linkOAuthAccount({
        provider: "kakao",
        code: "old-one-time-code",
        state: "o".repeat(40),
      }),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "invalid_oauth_transaction"
      ),
    );
    assert.equal(auth.hasLocalOAuthContext(), true, "새 Google link transaction은 그대로 남아야 합니다");
    assert.equal(sessionStorage.getItem("hyeni-oauth-context-v2"), currentContext);
    assert.equal(localStorage.getItem("hyeni-oauth-context-v2"), currentContext);
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: previousWindow,
      });
    }
  }
});
