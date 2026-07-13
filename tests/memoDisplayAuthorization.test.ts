import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeMemoDisplay,
  isNewMemoPush,
  MEMO_DISPLAY_AUTHORIZATION_PATH,
  type MemoDisplayAuthorizationFetch,
} from "../src/transform/memoDisplayAuthorization.ts";

const API_BASE = "https://api.example.test";
const PERMIT = "mdp1.payload.signature";

function response(ok: boolean, body: unknown): Awaited<ReturnType<MemoDisplayAuthorizationFetch>> {
  return {
    ok,
    json: async () => body,
  };
}

test("new_memo는 type 또는 action으로 식별하고 다른 알림은 재인가 대상으로 만들지 않는다", () => {
  assert.equal(isNewMemoPush({ type: "new_memo" }), true);
  assert.equal(isNewMemoPush({ action: " NEW_MEMO " }), true);
  assert.equal(isNewMemoPush({ type: "new_event", action: "new_event" }), false);
  assert.equal(isNewMemoPush({}), false);
});

test("유효한 permit을 POST하고 정확한 { allowed: true } 응답만 허용한다", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fetchImpl: MemoDisplayAuthorizationFetch = async (input, init) => {
    requestedUrl = input;
    requestedInit = init;
    return response(true, { allowed: true });
  };

  assert.equal(await authorizeMemoDisplay(PERMIT, { apiBase: API_BASE, fetchImpl }), true);
  assert.equal(requestedUrl, `${API_BASE}${MEMO_DISPLAY_AUTHORIZATION_PATH}`);
  assert.equal(requestedInit?.method, "POST");
  assert.equal(requestedInit?.body, JSON.stringify({ permit: PERMIT }));
  assert.equal(requestedInit?.credentials, "omit");
  assert.equal(requestedInit?.cache, "no-store");
  const headers = new Headers(requestedInit?.headers);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.has("Authorization"), false);
});

test("누락·공백·과대 permit과 잘못된 API base는 네트워크 호출 전에 거부한다", async () => {
  let calls = 0;
  const fetchImpl: MemoDisplayAuthorizationFetch = async () => {
    calls += 1;
    return response(true, { allowed: true });
  };

  assert.equal(await authorizeMemoDisplay(undefined, { apiBase: API_BASE, fetchImpl }), false);
  assert.equal(await authorizeMemoDisplay("", { apiBase: API_BASE, fetchImpl }), false);
  assert.equal(await authorizeMemoDisplay(` ${PERMIT}`, { apiBase: API_BASE, fetchImpl }), false);
  assert.equal(await authorizeMemoDisplay("x".repeat(3_073), { apiBase: API_BASE, fetchImpl }), false);
  assert.equal(await authorizeMemoDisplay(PERMIT, { apiBase: "javascript:alert(1)", fetchImpl }), false);
  assert.equal(calls, 0);
});

test("allowed false·추가 필드·HTTP 실패·JSON 실패·네트워크 실패는 모두 fail-closed한다", async () => {
  assert.equal(await authorizeMemoDisplay(PERMIT, {
    apiBase: API_BASE,
    fetchImpl: async () => response(true, { allowed: false }),
  }), false);
  assert.equal(await authorizeMemoDisplay(PERMIT, {
    apiBase: API_BASE,
    fetchImpl: async () => response(true, { allowed: true, reason: "extra" }),
  }), false);
  assert.equal(await authorizeMemoDisplay(PERMIT, {
    apiBase: API_BASE,
    fetchImpl: async () => response(false, { allowed: true }),
  }), false);
  assert.equal(await authorizeMemoDisplay(PERMIT, {
    apiBase: API_BASE,
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("invalid json"); } }),
  }), false);
  assert.equal(await authorizeMemoDisplay(PERMIT, {
    apiBase: API_BASE,
    fetchImpl: async () => { throw new Error("offline"); },
  }), false);
});

test("재인가 요청·JSON 처리가 제한 시간을 넘으면 abort하고 표시를 거부한다", async () => {
  let signal: AbortSignal | null = null;
  const fetchImpl: MemoDisplayAuthorizationFetch = async (_input, init) => {
    signal = init.signal instanceof AbortSignal ? init.signal : null;
    return await new Promise(() => undefined);
  };

  assert.equal(await authorizeMemoDisplay(PERMIT, {
    apiBase: API_BASE,
    fetchImpl,
    timeoutMs: 10,
  }), false);
  assert.equal(signal?.aborted, true);
});

test("helper는 Service Worker에서 localStorage나 permit 로그에 의존하지 않는다", () => {
  const source = readFileSync(
    new URL("../src/transform/memoDisplayAuthorization.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /console\./);
});
