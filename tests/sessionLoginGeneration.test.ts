import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

function jwt(
  sub: string,
  jti: string,
  options: { role?: string; familyId?: string | null; anonymous?: boolean } = {},
): string {
  const payload = Buffer.from(JSON.stringify({
    sub,
    jti,
    role: options.role ?? "parent",
    family_id: options.familyId === undefined ? "family-1" : options.familyId,
    is_anonymous: options.anonymous ?? false,
  })).toString("base64url");
  return `header.${payload}.sig`;
}

async function withSessionModule(name: string, initial?: Record<string, unknown>) {
  const storage = new MemoryStorage();
  if (initial) storage.setItem("hyeni-api-session-v1", JSON.stringify(initial));
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
  const session = await import(`../src/lib/api/session.ts?login-generation=${name}`);
  return {
    session,
    storage,
    restore() {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
      else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
      if (previousLocalStorage === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: previousLocalStorage,
      });
    },
  };
}

test("정상 access refresh와 가족 세션 재발급은 로그인 세대를 유지한다", async () => {
  const harness = await withSessionModule("refresh-family");
  try {
    const firstAccess = jwt("parent-1", "jti-login", { familyId: null });
    const refreshedAccess = jwt("parent-1", "jti-refresh", { familyId: null });
    const joinedAccess = jwt("parent-1", "jti-family", { familyId: "family-1" });

    harness.session.applyApiSession(
      { access_token: firstAccess, refresh_token: "refresh-a" },
      { renewLoginGeneration: true },
    );
    const loginGeneration = harness.session.getApiLoginGenerationId();
    const loginSessionInstance = harness.session.getApiSessionInstanceId();
    assert.match(loginGeneration ?? "", /^[0-9a-f-]{36}$/i);

    harness.session.setApiTokens({ access: refreshedAccess, refresh: "refresh-b" });
    assert.equal(harness.session.getApiLoginGenerationId(), loginGeneration,
      "refresh의 새 JTI는 명시적 로그인 세대를 바꾸면 안 됩니다");
    assert.equal(harness.session.getApiSessionInstanceId(), loginSessionInstance,
      "진행 중 refresh 응답 소유권 nonce도 같은 로그인에서는 유지해야 합니다");

    harness.session.applyApiSession({ access_token: joinedAccess, refresh_token: "refresh-c" });
    assert.equal(harness.session.getApiLoginGenerationId(), loginGeneration,
      "공동보호자 join/아이 pairing의 role·family 재발급도 같은 로그인 세대입니다");
  } finally {
    harness.restore();
  }
});

test("같은 사용자·역할·가족의 새 명시적 로그인은 로그인 세대를 반드시 바꾼다", async () => {
  const harness = await withSessionModule("explicit-login");
  try {
    harness.session.applyApiSession(
      { access_token: jwt("parent-1", "jti-first"), refresh_token: "refresh-a" },
      { renewLoginGeneration: true },
    );
    const firstGeneration = harness.session.getApiLoginGenerationId();
    const firstSessionInstance = harness.session.getApiSessionInstanceId();

    harness.session.applyApiSession(
      { access_token: jwt("parent-1", "jti-second"), refresh_token: "refresh-b" },
      { renewLoginGeneration: true },
    );
    assert.notEqual(harness.session.getApiLoginGenerationId(), firstGeneration);
    assert.notEqual(harness.session.getApiSessionInstanceId(), firstSessionInstance,
      "이전 로그인에서 시작한 refresh/family 응답도 새 명시적 로그인을 덮지 못해야 합니다");
  } finally {
    harness.restore();
  }
});

test("배포된 구버전 저장 세션은 로그인 세대를 한 번 생성하고 refresh 동안 보존한다", async () => {
  const access = jwt("legacy-parent", "legacy-jti");
  const harness = await withSessionModule("legacy-session", {
    access,
    refresh: "legacy-refresh",
    user: { id: "legacy-parent" },
    session_instance_id: "legacy-session-instance",
  });
  try {
    const upgradedGeneration = harness.session.getApiLoginGenerationId();
    assert.match(upgradedGeneration ?? "", /^[0-9a-f-]{36}$/i);
    const persisted = JSON.parse(harness.storage.getItem("hyeni-api-session-v1") ?? "{}") as {
      login_generation_id?: string;
    };
    assert.equal(persisted.login_generation_id, upgradedGeneration);

    harness.session.setApiTokens({
      access: jwt("legacy-parent", "refreshed-jti"),
      refresh: "rotated-refresh",
    });
    assert.equal(harness.session.getApiLoginGenerationId(), upgradedGeneration);
  } finally {
    harness.restore();
  }
});

test("인증 결과만 로그인 세대를 갱신하고 refresh·가족 재발급 경로는 강제 갱신하지 않는다", () => {
  const auth = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
  const family = readFileSync(new URL("../src/lib/api/endpoints/family.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/lib/api/client.ts", import.meta.url), "utf8");
  const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");

  assert.match(auth, /applyApiSession\([\s\S]{0,220}renewLoginGeneration: true/);
  assert.doesNotMatch(family, /renewLoginGeneration/);
  assert.doesNotMatch(client, /renewLoginGeneration/);
  assert.match(deepLink, /createApiLoginGenerationId\(\)/);
  assert.match(deepLink, /expectedLoginGenerationId: loginGenerationId/);
  assert.match(deepLink, /adoptAuthResult\(result, \{ loginGenerationId \}\)/);
  assert.match(
    deepLink,
    /getApiAccessToken\(\) === result\.session\.access_token[\s\S]{0,180}getApiLoginGenerationId\(\)/,
    "같은 OAuth 결과의 StrictMode/recovery replay는 이미 채택한 세대를 재사용해야 합니다",
  );
});
