import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";

const {
  StudyRpcAuthorizationError,
  canonicalStudyAuthorizationPayload,
  fingerprintStudyRequest,
  signStudyAuthorization,
  verifyStudyAuthorization,
} = await import("../lib/studyRpcAuthorization.ts");

const SECRET = "study-rpc-test-secret-with-sufficient-length";
const NOW = new Date("2026-08-29T00:00:00.000Z");
const FIXTURE = JSON.parse(readFileSync(new URL("../contracts/fixtures/calendar-study-authorization-v2.json", import.meta.url), "utf8"));

function base(overrides = {}) {
  return {
    actorId: "calendar-actor-1",
    familyId: "family-1",
    memberId: "child-1",
    role: "learner",
    operation: "learner.state",
    grade: { grade: 4, source: "birthdate", academicYear: 2026 },
    requestId: "study-request-0001",
    fingerprint: "Wm2f4w7W6vQf_NB_v7cD8QxFIm6xD4vi0usvJX6Tz6A",
    nonce: "study-nonce-0001",
    now: NOW,
    ...overrides,
  };
}

test("operation 또는 member가 달라지면 서명이 달라진다", async () => {
  const first = await signStudyAuthorization(base({ operation: "learner.state", memberId: "c1" }), SECRET);
  const second = await signStudyAuthorization(base({ operation: "learner.start", memberId: "c1" }), SECRET);
  const third = await signStudyAuthorization(base({ operation: "learner.state", memberId: "c2" }), SECRET);

  assert.notEqual(first.signature, second.signature);
  assert.notEqual(first.signature, third.signature);
});

test("공유 V2 fixture의 actorRef, fingerprint, payload, signature를 독립 expected 값과 일치시킨다", async () => {
  const fingerprint = await fingerprintStudyRequest(FIXTURE.normalizedRequest);
  const authorization = await signStudyAuthorization({
    ...FIXTURE.signInput,
    now: new Date(FIXTURE.signInput.now),
    fingerprint,
  }, FIXTURE.testSecret);

  assert.equal(fingerprint, FIXTURE.requestFingerprint);
  assert.equal(authorization.actorRef, FIXTURE.actorRef);
  assert.equal(canonicalStudyAuthorizationPayload({ ...authorization, signature: undefined }), FIXTURE.canonicalPayload);
  assert.deepEqual(authorization, FIXTURE.authorization);
});

test("member와 grade가 없는 guardian children authorization도 null key를 항상 보낸다", async () => {
  const authorization = await signStudyAuthorization(base({
    operation: "guardian.children",
    role: "guardian",
    memberId: null,
    grade: null,
  }), SECRET);

  assert.equal(authorization.memberId, null);
  assert.equal(authorization.grade, null);
  assert.ok(Object.hasOwn(authorization, "memberId"));
  assert.ok(Object.hasOwn(authorization, "grade"));
});

test("CalendarStudyAuthorizationV2 payload는 backend verifier와 같은 newline field 순서를 쓴다", () => {
  assert.equal(canonicalStudyAuthorizationPayload({
    apiVersion: "2026-08-27",
    role: "learner",
    operation: "learner.state",
    actorRef: "actor-ref",
    familyId: "family-1",
    memberId: "child-1",
    studyMarket: "KR",
    grade: { grade: 4, source: "hyeni_birth_year", academicYear: 2026 },
    requestId: "study-request-0001",
    fingerprint: "request-fingerprint",
    issuedAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T00:05:00.000Z",
    nonce: "study-nonce-0001",
  }), [
    "2026-08-27", "learner", "learner.state", "actor-ref", "family-1", "child-1", "KR",
    "4", "hyeni_birth_year", "2026", "study-request-0001", "request-fingerprint",
    "2026-08-29T00:00:00.000Z", "2026-08-29T00:05:00.000Z", "study-nonce-0001",
  ].join("\n"));
});

test("같은 JSON 요청은 키 순서와 무관하게 같은 fingerprint가 되고 내용 변경은 달라진다", async () => {
  const first = await fingerprintStudyRequest({ missionId: "m1", answer: "42", nested: { a: 1, b: true } });
  const reordered = await fingerprintStudyRequest({ nested: { b: true, a: 1 }, answer: "42", missionId: "m1" });
  const changed = await fingerprintStudyRequest({ missionId: "m1", answer: "43", nested: { a: 1, b: true } });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("서명은 raw actor 대신 secret-keyed actorRef와 canonical 만료 시각만 담는다", async () => {
  const authorization = await signStudyAuthorization(base(), SECRET);

  assert.equal(authorization.apiVersion, "2026-08-27");
  assert.equal(authorization.studyMarket, "KR");
  assert.equal(authorization.issuedAt, "2026-08-29T00:00:00.000Z");
  assert.equal(authorization.expiresAt, "2026-08-29T00:05:00.000Z");
  assert.equal("actorId" in authorization, false);
  assert.notEqual(authorization.actorRef, base().actorId);
  assert.match(authorization.actorRef, /^[A-Za-z0-9_-]+$/);
});

test("서명은 최대 300초이고 만료 또는 30초 초과 미래 clock은 거부한다", async () => {
  const maxLifetime = await signStudyAuthorization(base({ ttlSeconds: 300 }), SECRET);
  await verifyStudyAuthorization(maxLifetime, {
    secret: SECRET,
    operation: "learner.state",
    now: new Date("2026-08-28T23:59:30.000Z"),
  });
  await verifyStudyAuthorization(maxLifetime, {
    secret: SECRET,
    operation: "learner.state",
    now: new Date("2026-08-29T00:04:59.999Z"),
  });
  await assert.rejects(
    () => signStudyAuthorization(base({ ttlSeconds: 301 }), SECRET),
    (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_ttl_invalid",
  );

  const authorization = await signStudyAuthorization(base(), SECRET);
  await assert.rejects(
    () => verifyStudyAuthorization(authorization, { secret: SECRET, operation: "learner.state", now: new Date("2026-08-29T00:05:00.000Z") }),
    (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_expired",
  );
  await assert.rejects(
    () => verifyStudyAuthorization(authorization, { secret: SECRET, operation: "learner.state", now: new Date("2026-08-28T23:59:29.000Z") }),
    (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_future",
  );
});

test("전체 operation policy는 허용 role과 member·grade required 및 forbidden 조합을 고정한다", async () => {
  const rows = [
    { operation: "guardian.children", role: "guardian", memberId: null, grade: null },
    { operation: "guardian.overview", role: "guardian", memberId: "child-1", grade: base().grade },
    { operation: "guardian.report", role: "guardian", memberId: "child-1", grade: base().grade },
    { operation: "guardian.grade", role: "guardian", memberId: "child-1", grade: base().grade },
    { operation: "primary.service-country", role: "primary", memberId: null, grade: null },
    { operation: "learner.state", role: "learner", memberId: "child-1", grade: base().grade },
    { operation: "learner.start", role: "learner", memberId: "child-1", grade: base().grade },
    { operation: "learner.get", role: "learner", memberId: "child-1", grade: base().grade },
    { operation: "learner.submit", role: "learner", memberId: "child-1", grade: base().grade },
    { operation: "system.cleanup", role: "system_cleanup", memberId: "child-1", grade: null },
  ];

  for (const row of rows) {
    const allowed = await signStudyAuthorization(base(row), SECRET);
    assert.equal(allowed.role, row.role, row.operation);
    assert.equal(allowed.memberId, row.memberId, row.operation);
    assert.deepEqual(allowed.grade, row.grade === null ? null : { ...row.grade, source: row.grade.source === "birthdate" ? "hyeni_birth_year" : "parent_override" }, row.operation);

    await assert.rejects(
      () => signStudyAuthorization(base({ ...row, role: row.role === "guardian" ? "learner" : "guardian" }), SECRET),
      (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_role_forbidden",
      `${row.operation} role`,
    );
    await assert.rejects(
      () => signStudyAuthorization(base({ ...row, memberId: row.memberId === null ? "child-1" : null }), SECRET),
      (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_invalid",
      `${row.operation} member`,
    );
    await assert.rejects(
      () => signStudyAuthorization(base({ ...row, grade: row.grade === null ? base().grade : null }), SECRET),
      (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_invalid",
      `${row.operation} grade`,
    );
  }
});

test("role-operation 정책과 변조된 replay shape를 거부한다", async () => {
  await assert.rejects(
    () => signStudyAuthorization(base({ role: "guardian", operation: "learner.start" }), SECRET),
    (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_role_forbidden",
  );

  const authorization = await signStudyAuthorization(base({ operation: "learner.start" }), SECRET);
  await assert.rejects(
    () => verifyStudyAuthorization(authorization, { secret: SECRET, operation: "learner.state", now: NOW }),
    (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_scope_mismatch",
  );
  await assert.rejects(
    () => verifyStudyAuthorization({ ...authorization, fingerprint: "tampered-fingerprint" }, { secret: SECRET, operation: "learner.start", now: NOW }),
    (error) => error instanceof StudyRpcAuthorizationError && error.code === "authorization_signature_invalid",
  );
});
