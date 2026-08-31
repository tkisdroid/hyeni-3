import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { createGoogleMapsTokenProvider, GOOGLE_MAP_SCOPES } = await import("../lib/maps/googleOAuth.ts");

function serviceAccountJson() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "maps-server@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

test("지도 전용 OAuth는 exact 최소 scope JWT를 만들고 만료 5분 전까지 캐시한다", async () => {
  const assertions = [];
  const fetchImpl = async (_url, init) => {
    const params = new URLSearchParams(init.body);
    assertions.push(params.get("assertion"));
    return Response.json({ access_token: "maps-token", expires_in: 3600 });
  };
  const provider = createGoogleMapsTokenProvider(serviceAccountJson(), { fetchImpl, nowMs: () => 1_800_000_000_000 });
  assert.equal(await provider.getAccessToken([GOOGLE_MAP_SCOPES.details], AbortSignal.timeout(1000)), "maps-token");
  assert.equal(await provider.getAccessToken([GOOGLE_MAP_SCOPES.details], AbortSignal.timeout(1000)), "maps-token");
  assert.equal(assertions.length, 1);
  const payload = JSON.parse(Buffer.from(assertions[0].split(".")[1], "base64url").toString());
  assert.equal(payload.scope, GOOGLE_MAP_SCOPES.details);
  assert.notEqual(payload.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(payload.exp - payload.iat, 3600);
});

test("잘못된 전용 service account와 OAuth 실패는 축소 오류로 닫힌다", async () => {
  assert.throws(() => createGoogleMapsTokenProvider("{}"), /google_maps_credentials_invalid/);
  const provider = createGoogleMapsTokenProvider(serviceAccountJson(), {
    fetchImpl: async () => new Response("secret upstream body", { status: 403 }),
  });
  await assert.rejects(
    provider.getAccessToken([GOOGLE_MAP_SCOPES.autocomplete], AbortSignal.timeout(1000)),
    /google_maps_oauth_unavailable/,
  );
});

