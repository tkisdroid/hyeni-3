import test from "node:test";
import assert from "node:assert/strict";

const { createGoogleMapAdapter, GOOGLE_FIELD_MASKS } = await import("../lib/maps/google.ts");
const { GOOGLE_MAP_SCOPES } = await import("../lib/maps/googleOAuth.ts");

test("Google adapter는 endpoint별 최소 scope·field mask·region·session token을 고정한다", async () => {
  const calls = [];
  const tokenCalls = [];
  const responses = [
    { suggestions: [{ placePrediction: { placeId: "place-1", structuredFormat: { mainText: { text: "School" }, secondaryText: { text: "Tokyo" } } } }] },
    { id: "place-1", displayName: { text: "School" }, formattedAddress: "Tokyo", location: { latitude: 35.1, longitude: 139.2 } },
    { results: [{ formattedAddress: "Tokyo address" }] },
  ];
  const adapter = createGoogleMapAdapter({
    countryCode: "JP",
    tokenProvider: { getAccessToken: async (scopes) => (tokenCalls.push([...scopes]), "token") },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(responses.shift());
    },
    routesOauthVerified: false,
  });

  const candidates = await adapter.search("school", "ja-JP", { lat: 35, lng: 139 }, "uuid-token");
  assert.equal(candidates[0].providerPlaceId, "place-1");
  assert.equal(await adapter.select("place-1", "uuid-token").then((value) => value.point.lat), 35.1);
  assert.equal(await adapter.reverse({ lat: 35.1, lng: 139.2 }, "ja-JP"), "Tokyo address");

  assert.deepEqual(tokenCalls, [
    [GOOGLE_MAP_SCOPES.autocomplete],
    [GOOGLE_MAP_SCOPES.details],
    [GOOGLE_MAP_SCOPES.reverse],
  ]);
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal(calls[0].init.headers["X-Goog-FieldMask"], GOOGLE_FIELD_MASKS.autocomplete);
  const autocompleteBody = JSON.parse(calls[0].init.body);
  assert.equal(autocompleteBody.regionCode, "jp");
  assert.equal(autocompleteBody.includeQueryPredictions, false);
  assert.equal(autocompleteBody.sessionToken, "uuid-token");
  assert.match(calls[1].url, /places\/place-1\?.*sessionToken=uuid-token/);
  assert.equal(calls[1].init.headers["X-Goog-FieldMask"], GOOGLE_FIELD_MASKS.details);
  assert.match(calls[2].url, /^https:\/\/geocode\.googleapis\.com\/v4\/geocode\/location\/35\.1,139\.2\?/);
  assert.equal(calls[2].init.headers["X-Goog-FieldMask"], GOOGLE_FIELD_MASKS.reverse);
  for (const call of calls) {
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.headers.Authorization, "Bearer token");
    assert.ok(!call.init.headers["X-Goog-FieldMask"].includes("*"));
  }
});

test("공식 최소 OAuth 확인 전 Google Routes만 외부 호출 없이 HOLD한다", async () => {
  let fetchCount = 0;
  const adapter = createGoogleMapAdapter({
    countryCode: "GB",
    tokenProvider: { getAccessToken: async () => "token" },
    fetchImpl: async () => { fetchCount += 1; return Response.json({}); },
    routesOauthVerified: false,
  });
  const route = await adapter.directions({ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.11 }, "en-GB");
  assert.equal(fetchCount, 0);
  assert.equal(route.routeSource, "none");
  assert.equal(route.distanceMeters, null);
});

