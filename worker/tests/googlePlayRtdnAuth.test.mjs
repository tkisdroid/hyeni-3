import test from "node:test";
import assert from "node:assert/strict";

async function optionalImport(path) {
  try {
    return await import(path);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  }
}

const googleOidc = await optionalImport("../lib/googleOidc.ts");
const googlePlayRtdn = await optionalImport("../lib/googlePlayRtdn.ts");
let freshModuleSequence = 0;

const NOW = new Date("2026-07-13T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const AUDIENCE = "https://hyeni-calendar-api.example/api/google-play/rtdn";
const SERVICE_ACCOUNT_EMAIL = "google-play-rtdn@example.iam.gserviceaccount.com";

function encodeBase64Url(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createSigner(kid) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    jwk: { ...publicJwk, kid, alg: "RS256", use: "sig" },
    async sign(claimPatch = {}, headerPatch = {}) {
      const header = { alg: "RS256", typ: "JWT", kid, ...headerPatch };
      const claims = {
        iss: "https://accounts.google.com",
        aud: AUDIENCE,
        email: SERVICE_ACCOUNT_EMAIL,
        email_verified: true,
        iat: NOW_SECONDS - 10,
        exp: NOW_SECONDS + 300,
        ...claimPatch,
      };
      const encodedHeader = encodeBase64Url(JSON.stringify(header));
      const encodedClaims = encodeBase64Url(JSON.stringify(claims));
      const unsigned = `${encodedHeader}.${encodedClaims}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keyPair.privateKey,
        new TextEncoder().encode(unsigned),
      );
      return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
    },
  };
}

function jwksFetch(keys, calls = []) {
  return async (url) => {
    calls.push(String(url));
    return Response.json({ keys }, { headers: { "cache-control": "public, max-age=3600" } });
  };
}

function verify(token, fetchImpl) {
  assert.equal(typeof googleOidc.verifyGoogleOidcJwt, "function", "verifyGoogleOidcJwt가 구현되어야 합니다");
  return googleOidc.verifyGoogleOidcJwt(token, {
    audience: AUDIENCE,
    serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
    fetchImpl,
    now: NOW,
  });
}

async function freshOidcModule() {
  freshModuleSequence += 1;
  return import(`../lib/googleOidc.ts?cache-test=${freshModuleSequence}`);
}

function verifyWithModule(module, token, fetchImpl, now = NOW) {
  return module.verifyGoogleOidcJwt(token, {
    audience: AUDIENCE,
    serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
    fetchImpl,
    now,
  });
}

async function rejectsCode(action, code) {
  await assert.rejects(action, (error) => error?.code === code);
}

test("Google OIDC JWT는 v3 JWKS의 RSA 키로 검증된 claim만 반환한다", async () => {
  const signer = await createSigner("valid-rsa-key");
  const calls = [];
  const claims = await verify(await signer.sign(), jwksFetch([signer.jwk], calls));

  assert.equal(claims.email, SERVICE_ACCOUNT_EMAIL);
  assert.equal(claims.aud, AUDIENCE);
  assert.deepEqual(calls, ["https://www.googleapis.com/oauth2/v3/certs"]);
});

test("JWT alg가 RS256이 아니거나 kid가 비어 있으면 JWKS 조회 전에 거부한다", async () => {
  const signer = await createSigner("header-validation-key");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return Response.json({ keys: [signer.jwk] });
  };

  await rejectsCode(async () => verify(await signer.sign({}, { alg: "HS256" }), fetchImpl), "rtdn_invalid_token");
  await rejectsCode(async () => verify(await signer.sign({}, { kid: "" }), fetchImpl), "rtdn_invalid_token");
  assert.equal(fetchCount, 0);
});

test("서명이 다른 RSA 키로 만들어졌으면 거부한다", async () => {
  const trusted = await createSigner("signature-key");
  const attacker = await createSigner("signature-key");
  await rejectsCode(
    async () => verify(await attacker.sign(), jwksFetch([trusted.jwk])),
    "rtdn_invalid_token",
  );
});

test("issuer는 Google의 두 공식 값만 허용한다", async () => {
  for (const issuer of ["https://accounts.google.com.evil.example", "accounts.google.com/"]) {
    const signer = await createSigner(`issuer-${issuer.length}`);
    await rejectsCode(
      async () => verify(await signer.sign({ iss: issuer }), jwksFetch([signer.jwk])),
      "rtdn_invalid_token",
    );
  }
});

test("audience와 서비스 계정 이메일은 완전 일치해야 한다", async () => {
  const signer = await createSigner("identity-claims-key");
  for (const patch of [
    { aud: `${AUDIENCE}/` },
    { aud: [AUDIENCE] },
    { email: ` ${SERVICE_ACCOUNT_EMAIL}` },
  ]) {
    await rejectsCode(
      async () => verify(await signer.sign(patch), jwksFetch([signer.jwk])),
      "rtdn_invalid_token",
    );
  }
});

test("만료됐거나 현재보다 60초 넘게 미래에 발급된 JWT는 거부한다", async () => {
  const signer = await createSigner("time-claims-key");
  for (const patch of [
    { exp: NOW_SECONDS },
    { iat: NOW_SECONDS + 61 },
  ]) {
    await rejectsCode(
      async () => verify(await signer.sign(patch), jwksFetch([signer.jwk])),
      "rtdn_invalid_token",
    );
  }
});

test("email_verified가 boolean true가 아니면 거부한다", async () => {
  const signer = await createSigner("email-verified-key");
  for (const emailVerified of [false, "true", undefined]) {
    await rejectsCode(
      async () => verify(await signer.sign({ email_verified: emailVerified }), jwksFetch([signer.jwk])),
      "rtdn_invalid_token",
    );
  }
});

test("audience 또는 push 서비스 계정 설정이 공백이면 rtdn_not_configured로 거부한다", async () => {
  assert.equal(typeof googleOidc.verifyGoogleOidcJwt, "function", "verifyGoogleOidcJwt가 구현되어야 합니다");
  for (const options of [
    { audience: " ", serviceAccountEmail: SERVICE_ACCOUNT_EMAIL },
    { audience: AUDIENCE, serviceAccountEmail: "\n" },
  ]) {
    await rejectsCode(
      () => googleOidc.verifyGoogleOidcJwt("not-a-token", { ...options, now: NOW }),
      "rtdn_not_configured",
    );
  }
});

test("최초 JWKS 조회 직후에도 kid가 없으면 같은 요청에서 두 번째 조회를 하지 않는다", async () => {
  const oidc = await freshOidcModule();
  const publishedSigner = await createSigner("published-initial-key");
  const unknownSigner = await createSigner("unknown-initial-key");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return Response.json(
      { keys: [publishedSigner.jwk] },
      { headers: { "cache-control": "max-age=3600" } },
    );
  };

  await rejectsCode(
    async () => verifyWithModule(oidc, await unknownSigner.sign(), fetchImpl),
    "rtdn_invalid_token",
  );
  assert.equal(fetchCount, 1);
});

test("유효 캐시의 같은 unknown kid와 서로 다른 unknown kid는 전역 cooldown 동안 추가 조회를 만들지 않는다", async () => {
  const oidc = await freshOidcModule();
  const publishedSigner = await createSigner("cooldown-published-key");
  const unknownA = await createSigner("cooldown-unknown-a");
  const unknownB = await createSigner("cooldown-unknown-b");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return Response.json(
      { keys: [publishedSigner.jwk] },
      { headers: { "cache-control": "max-age=3600" } },
    );
  };

  await verifyWithModule(oidc, await publishedSigner.sign(), fetchImpl, NOW);
  await rejectsCode(
    async () => verifyWithModule(oidc, await unknownA.sign(), fetchImpl, new Date(NOW.getTime() + 61_000)),
    "rtdn_invalid_token",
  );
  await rejectsCode(
    async () => verifyWithModule(oidc, await unknownA.sign(), fetchImpl, new Date(NOW.getTime() + 62_000)),
    "rtdn_invalid_token",
  );
  await rejectsCode(
    async () => verifyWithModule(oidc, await unknownB.sign(), fetchImpl, new Date(NOW.getTime() + 63_000)),
    "rtdn_invalid_token",
  );
  assert.equal(fetchCount, 2);
});

test("동시에 들어온 unknown kid 검증은 강제 JWKS 갱신 한 건을 single-flight로 공유한다", async () => {
  const oidc = await freshOidcModule();
  const publishedSigner = await createSigner("single-flight-published-key");
  const unknownSigner = await createSigner("single-flight-unknown-key");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    await Promise.resolve();
    return Response.json(
      { keys: [publishedSigner.jwk] },
      { headers: { "cache-control": "max-age=3600" } },
    );
  };
  await verifyWithModule(oidc, await publishedSigner.sign(), fetchImpl, NOW);
  const token = await unknownSigner.sign();

  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => verifyWithModule(
      oidc,
      token,
      fetchImpl,
      new Date(NOW.getTime() + 61_000),
    )),
  );

  assert.ok(results.every((result) => result.status === "rejected" && result.reason?.code === "rtdn_invalid_token"));
  assert.equal(fetchCount, 2);
});

test("새 Google kid는 refresh cooldown 뒤 한 번 갱신해 정상 검증한다", async () => {
  const oidc = await freshOidcModule();
  const oldSigner = await createSigner("rotation-old-key");
  const newSigner = await createSigner("rotation-new-key");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return Response.json(
      { keys: fetchCount === 1 ? [oldSigner.jwk] : [newSigner.jwk] },
      { headers: { "cache-control": "max-age=3600" } },
    );
  };
  await verifyWithModule(oidc, await oldSigner.sign(), fetchImpl, NOW);
  const newToken = await newSigner.sign();

  await rejectsCode(
    () => verifyWithModule(oidc, newToken, fetchImpl, new Date(NOW.getTime() + 30_000)),
    "rtdn_invalid_token",
  );
  const claims = await verifyWithModule(oidc, newToken, fetchImpl, new Date(NOW.getTime() + 61_000));

  assert.equal(claims.email, SERVICE_ACCOUNT_EMAIL);
  assert.equal(fetchCount, 2);
});

test("JWKS 최초 network/429 실패는 같은·다른 kid 요청을 60초 막고 cooldown 뒤 한 번만 재시도한다", async () => {
  for (const failureMode of ["network", "429"]) {
    const oidc = await freshOidcModule();
    const unknownA = await createSigner(`${failureMode}-initial-unknown-a`);
    const unknownB = await createSigner(`${failureMode}-initial-unknown-b`);
    const tokenA = await unknownA.sign();
    const tokenB = await unknownB.sign();
    let fetchCount = 0;
    const fetchImpl = async () => {
      fetchCount += 1;
      if (failureMode === "network") throw new Error("upstream unavailable");
      return new Response(null, { status: 429 });
    };

    await rejectsCode(() => verifyWithModule(oidc, tokenA, fetchImpl, NOW), "rtdn_oidc_unavailable");
    await rejectsCode(() => verifyWithModule(oidc, tokenA, fetchImpl, new Date(NOW.getTime() + 1_000)), "rtdn_oidc_unavailable");
    await rejectsCode(() => verifyWithModule(oidc, tokenB, fetchImpl, new Date(NOW.getTime() + 2_000)), "rtdn_oidc_unavailable");
    assert.equal(fetchCount, 1, `${failureMode} cooldown 중 추가 조회가 발생했습니다`);

    await rejectsCode(() => verifyWithModule(oidc, tokenB, fetchImpl, new Date(NOW.getTime() + 61_000)), "rtdn_oidc_unavailable");
    assert.equal(fetchCount, 2, `${failureMode} cooldown 뒤 재시도 횟수가 다릅니다`);
  }
});

test("만료 캐시 재조회 실패도 마지막 fetch 시도부터 60초 backoff한다", async () => {
  const oidc = await freshOidcModule();
  const signer = await createSigner("expired-cache-key");
  const token = await signer.sign();
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    if (fetchCount > 1) throw new Error("upstream unavailable");
    return Response.json({ keys: [signer.jwk] }, { headers: { "cache-control": "max-age=1" } });
  };
  await verifyWithModule(oidc, token, fetchImpl, NOW);

  await rejectsCode(() => verifyWithModule(oidc, token, fetchImpl, new Date(NOW.getTime() + 61_000)), "rtdn_oidc_unavailable");
  await rejectsCode(() => verifyWithModule(oidc, token, fetchImpl, new Date(NOW.getTime() + 62_000)), "rtdn_oidc_unavailable");
  assert.equal(fetchCount, 2);
  await rejectsCode(() => verifyWithModule(oidc, token, fetchImpl, new Date(NOW.getTime() + 122_000)), "rtdn_oidc_unavailable");
  assert.equal(fetchCount, 3);
});

test("강제 refresh 실패도 다른 unknown kid가 cooldown 중 추가 fetch를 만들지 못한다", async () => {
  const oidc = await freshOidcModule();
  const publishedSigner = await createSigner("force-failure-published-key");
  const unknownA = await createSigner("force-failure-unknown-a");
  const unknownB = await createSigner("force-failure-unknown-b");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    if (fetchCount > 1) throw new Error("upstream unavailable");
    return Response.json({ keys: [publishedSigner.jwk] }, { headers: { "cache-control": "max-age=3600" } });
  };
  await verifyWithModule(oidc, await publishedSigner.sign(), fetchImpl, NOW);

  await rejectsCode(async () => verifyWithModule(oidc, await unknownA.sign(), fetchImpl, new Date(NOW.getTime() + 61_000)), "rtdn_oidc_unavailable");
  await rejectsCode(async () => verifyWithModule(oidc, await unknownB.sign(), fetchImpl, new Date(NOW.getTime() + 62_000)), "rtdn_oidc_unavailable");
  assert.equal(fetchCount, 2);
  await rejectsCode(async () => verifyWithModule(oidc, await unknownB.sign(), fetchImpl, new Date(NOW.getTime() + 122_000)), "rtdn_oidc_unavailable");
  assert.equal(fetchCount, 3);
});

test("Cache-Control max-age 동안 같은 kid 검증은 JWKS를 다시 조회하지 않는다", async () => {
  const oidc = await freshOidcModule();
  const signer = await createSigner("cache-control-key");
  const calls = [];
  const fetchImpl = jwksFetch([signer.jwk], calls);
  const token = await signer.sign();

  await verifyWithModule(oidc, token, fetchImpl);
  await verifyWithModule(oidc, token, fetchImpl);
  assert.equal(calls.length, 1);
});

function encodeRtdnData(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function subscriptionPayload(patch = {}) {
  return {
    version: "1.0",
    packageName: "com.hyeni.calendar",
    eventTimeMillis: "1783944000000",
    subscriptionNotification: {
      version: "1.0",
      notificationType: 4,
      purchaseToken: "purchase-token-sensitive",
      subscriptionId: "hyeni_premium",
    },
    ...patch,
  };
}

function envelope(payload, patch = {}) {
  return {
    message: {
      messageId: "pubsub-message-1",
      data: encodeRtdnData(payload),
      ...patch,
    },
  };
}

function parse(input) {
  assert.equal(typeof googlePlayRtdn.parseGooglePlayRtdnEnvelope, "function", "parseGooglePlayRtdnEnvelope가 구현되어야 합니다");
  return googlePlayRtdn.parseGooglePlayRtdnEnvelope(input);
}

test("subscription RTDN envelope을 필요한 필드만 있는 정규형으로 변환한다", () => {
  assert.deepEqual(parse(envelope(subscriptionPayload())), {
    messageId: "pubsub-message-1",
    eventTimeMillis: "1783944000000",
    kind: "subscription",
    notificationType: 4,
    purchaseToken: "purchase-token-sensitive",
    subscriptionId: "hyeni_premium",
  });
});

test("testNotification은 구매 토큰 없이 test 정규형으로 변환한다", () => {
  const payload = {
    version: "1.0",
    packageName: "com.hyeni.calendar",
    eventTimeMillis: "1783944000000",
    testNotification: { version: "1.0" },
  };
  assert.deepEqual(parse(envelope(payload)), {
    messageId: "pubsub-message-1",
    eventTimeMillis: "1783944000000",
    kind: "test",
  });
});

test("voidedPurchaseNotification은 일회성 환불 처리에 필요한 고정 필드만 정규화한다", () => {
  const payload = {
    version: "1.0",
    packageName: "com.hyeni.calendar",
    eventTimeMillis: "1783944000000",
    voidedPurchaseNotification: {
      purchaseToken: "voided-token-sensitive",
      orderId: "voided-order-sensitive",
      productType: 2,
      refundType: 1,
    },
  };
  assert.deepEqual(parse(envelope(payload)), {
    messageId: "pubsub-message-1",
    eventTimeMillis: "1783944000000",
    kind: "voided",
    purchaseToken: "voided-token-sensitive",
    orderId: "voided-order-sensitive",
    productType: 2,
    refundType: 1,
  });
});

test("Pub/Sub message envelope과 data의 strict base64 JSON을 검증한다", () => {
  for (const invalid of [
    null,
    {},
    { message: { messageId: "", data: encodeRtdnData(subscriptionPayload()) } },
    { message: { messageId: "id", data: "eyJub3QiOiJiYXNlNjQifQ" } },
    { message: { messageId: "id", data: "@@@@" } },
    { message: { messageId: "id", data: btoa("not-json") } },
  ]) {
    assert.throws(() => parse(invalid), (error) => error?.code === "invalid_rtdn_payload");
  }
});

test("다른 packageName의 알림은 거부한다", () => {
  assert.throws(
    () => parse(envelope(subscriptionPayload({ packageName: "com.attacker.app" }))),
    (error) => error?.code === "invalid_rtdn_payload",
  );
});

test("지원 RTDN 종류가 둘 이상이거나 one-time purchase 알림이면 거부한다", () => {
  for (const payload of [
    {
      version: "1.0",
      packageName: "com.hyeni.calendar",
      eventTimeMillis: "1783944000000",
      oneTimeProductNotification: { version: "1.0" },
    },
    subscriptionPayload({ testNotification: { version: "1.0" } }),
    subscriptionPayload({ oneTimeProductNotification: { version: "1.0" } }),
    subscriptionPayload({
      voidedPurchaseNotification: {
        purchaseToken: "token",
        orderId: "order",
        productType: 2,
        refundType: 1,
      },
    }),
  ]) {
    assert.throws(() => parse(envelope(payload)), (error) => error?.code === "invalid_rtdn_payload");
  }
});

test("voided 알림은 token/order와 양의 정수 productType/refundType이 필수다", () => {
  const base = {
    version: "1.0",
    packageName: "com.hyeni.calendar",
    eventTimeMillis: "1783944000000",
  };
  for (const voidedPurchaseNotification of [
    { purchaseToken: "", orderId: "order", productType: 2, refundType: 1 },
    { purchaseToken: "token", orderId: "", productType: 2, refundType: 1 },
    { purchaseToken: "token", orderId: "order", productType: 0, refundType: 1 },
    { purchaseToken: "token", orderId: "order", productType: 2, refundType: 1.5 },
  ]) {
    assert.throws(
      () => parse(envelope({ ...base, voidedPurchaseNotification })),
      (error) => error?.code === "invalid_rtdn_payload",
    );
  }
});

test("subscription 알림은 정수 notificationType과 비어 있지 않은 purchaseToken이 필수다", () => {
  for (const subscriptionNotification of [
    { version: "1.0", purchaseToken: "token" },
    { version: "1.0", notificationType: 4.5, purchaseToken: "token" },
    { version: "1.0", notificationType: 4, purchaseToken: " " },
  ]) {
    assert.throws(
      () => parse(envelope(subscriptionPayload({ subscriptionNotification }))),
      (error) => error?.code === "invalid_rtdn_payload",
    );
  }
});

test("notificationType은 0보다 큰 safe integer만 허용한다", () => {
  for (const notificationType of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => parse(envelope(subscriptionPayload({
        subscriptionNotification: {
          version: "1.0",
          notificationType,
          purchaseToken: "token",
        },
      }))),
      (error) => error?.code === "invalid_rtdn_payload",
    );
  }
});

test("알 수 없는 양의 notificationType도 파싱만 하며 entitlement는 항상 Play API 재조회 결과로 결정한다", () => {
  const parsed = parse(envelope(subscriptionPayload({
    subscriptionNotification: {
      version: "1.0",
      notificationType: 999_999,
      purchaseToken: "token",
    },
  })));
  assert.equal(parsed.kind, "subscription");
  assert.equal(parsed.notificationType, 999_999);
});
