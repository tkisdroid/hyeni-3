import assert from "node:assert/strict";
import test from "node:test";
import type { IntlShape } from "react-intl";

import { localizeApiError } from "../src/i18n/apiError.ts";
import { ApiError, normalizeApiErrorCode } from "../src/lib/api/errors.ts";

const messages: Record<string, string> = {
  "core.error.api.invalidCredentials.formal": "로그인 정보를 확인해 주세요.",
  "core.error.api.invalidCredentials.child": "로그인 정보를 확인해 줘.",
  "core.error.api.network.formal": "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
  "core.error.api.network.child": "인터넷 연결을 확인하고 다시 해 줘.",
  "core.error.api.client.formal": "요청을 처리하지 못했어요. 입력 내용을 확인해 주세요.",
  "core.error.api.client.child": "요청을 처리하지 못했어. 입력한 내용을 확인해 줘.",
  "core.error.api.server.formal": "서버에 잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
  "core.error.api.server.child": "서버에 잠시 문제가 생겼어. 잠시 후 다시 해 줘.",
  "core.error.api.unknown.formal": "문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
  "core.error.api.unknown.child": "문제가 생겼어. 잠시 후 다시 해 줘.",
};

const intl = {
  formatMessage(descriptor: { id: string }) {
    return messages[descriptor.id] ?? `missing:${descriptor.id}`;
  },
} as IntlShape;

test("ApiError는 HTTP status와 제한된 안정 code를 분리하고 원문을 message에 넣지 않는다", () => {
  const known = new ApiError("invalid_credentials", 401);
  assert.equal(known.status, 401);
  assert.equal(known.code, "invalid_credentials");
  assert.equal(known.message, "API request failed");

  const secret = "Database failed: Bearer secret-token user@example.com";
  const untrusted = new ApiError(secret, 500);
  assert.equal(untrusted.code, null);
  assert.equal(untrusted.message.includes(secret), false);
  assert.equal(untrusted.stack?.includes(secret) ?? false, false);
});

test("API code는 소문자 snake_case와 최대 길이만 허용한다", () => {
  assert.equal(normalizeApiErrorCode("pair_code_expired"), "pair_code_expired");
  assert.equal(normalizeApiErrorCode("UPPER_CASE"), null);
  assert.equal(normalizeApiErrorCode("contains spaces"), null);
  assert.equal(normalizeApiErrorCode("x".repeat(65)), null);
  assert.equal(normalizeApiErrorCode({ code: "invalid_credentials" }), null);
});

test("allowlist code만 구체화하고 알 수 없는 4xx·5xx는 역할별 문구로 닫는다", () => {
  assert.equal(
    localizeApiError(new ApiError("invalid_credentials", 401), intl, "formal"),
    "로그인 정보를 확인해 주세요.",
  );
  assert.equal(
    localizeApiError(new ApiError("worker_database_table_missing", 409), intl, "child"),
    "요청을 처리하지 못했어. 입력한 내용을 확인해 줘.",
  );
  assert.equal(
    localizeApiError(new ApiError("worker_database_table_missing", 503), intl, "formal"),
    "서버에 잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
  );
});

test("네트워크·일반 Error의 원문과 token은 어떤 tone에서도 반환하지 않는다", () => {
  const raw = "fetch failed Bearer live-refresh-token";
  assert.equal(localizeApiError(new TypeError(raw), intl, "formal"), messages["core.error.api.network.formal"]);
  assert.equal(localizeApiError(new Error(raw), intl, "child"), messages["core.error.api.unknown.child"]);
  assert.equal(localizeApiError(new Error(raw), intl, "child").includes("Bearer"), false);
});
