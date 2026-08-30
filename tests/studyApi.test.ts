import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

const { qk } = await import("../src/queries/keys.ts");
const study = await import("../src/lib/api/endpoints/study.ts");
const { ApiError } = await import("../src/lib/api/errors.ts");
const { clearApiSession, setApiTokens } = await import("../src/lib/api/session.ts");

const VERSION = "2026-08-27";
const isInvalidStudyResponse = (error: unknown) => (
  error instanceof ApiError && error.code === "invalid_study_response" && error.status === 502
);

const mission = {
  apiVersion: VERSION,
  missionId: "mission-1",
  status: "started",
  grade: 4,
  items: [{
    problemId: "problem-1",
    position: 0,
    prompt: "12를 3으로 나누면 얼마인가요?",
    childObjective: "나눗셈의 몫을 구할 수 있어요.",
    domainLabel: "수와 연산",
    conceptTitle: "나눗셈",
    difficulty: 2,
    difficultyBand: "standard",
    type: "integer_input",
    input: { kind: "integer_input" },
    opened: true,
    resolved: false,
    revealedHints: [],
    nextHintLevel: 1,
    allowedActions: {
      canSubmit: true,
      canRequestHint: true,
      canRequestExplanation: false,
      canSkip: true,
    },
  }],
  progress: { completed: 0, total: 1 },
};

test("Study query key는 역할과 정확한 자녀 member를 포함한다", () => {
  assert.deepEqual(qk.study.report("family-1", "child-2", "30d"), [
    "study", "report", "family-1", "child-2", "30d",
  ]);
  assert.deepEqual(qk.study.status("family-1", "parent"), [
    "study", "status", "family-1", "parent",
  ]);
  assert.notDeepEqual(
    qk.study.report("family-1", "child-1", "30d"),
    qk.study.report("family-1", "child-2", "30d"),
  );
});

test("Study 상태는 서버 플래그와 확인 권한을 엄격히 파싱한다", () => {
  assert.deepEqual(study.parseStudyStatus({
    state: "enabled",
    market: "KR",
    role: "parent",
    managementEnabled: true,
    learnerEnabled: false,
  }), {
    state: "enabled",
    market: "KR",
    role: "parent",
    managementEnabled: true,
    learnerEnabled: false,
  });
  assert.deepEqual(study.parseStudyStatus({
    state: "not_confirmed",
    inferredCountry: "KR",
    canConfirm: true,
  }), {
    state: "not_confirmed",
    inferredCountry: "KR",
    canConfirm: true,
  });
  assert.throws(() => study.parseStudyStatus({ state: "enabled", role: "parent" }), isInvalidStudyResponse);
});

test("미션 파서는 버전·학년·항목과 정답 비공개 경계를 닫는다", () => {
  assert.deepEqual(study.parseStudyMission(mission), mission);
  assert.throws(() => study.parseStudyMission({ ...mission, apiVersion: "future" }), isInvalidStudyResponse);
  assert.throws(() => study.parseStudyMission({ ...mission, grade: 2 }), isInvalidStudyResponse);
  assert.throws(() => study.parseStudyMission({ ...mission, items: [] }), isInvalidStudyResponse);
  assert.throws(() => study.parseStudyMission({
    ...mission,
    items: [{ ...mission.items[0], canonicalAnswer: "4" }],
  }), isInvalidStudyResponse);
});

test("부모 리포트와 학습자 상태는 비정상 수치와 불완전 grade를 거부한다", () => {
  const report = {
    apiVersion: VERSION,
    memberId: "child-2",
    state: "ready",
    grade: { grade: 4, source: "hyeni_birth_year", academicYear: 2026 },
    hasStudyData: true,
    todayProblemCount: 3,
    completedToday: false,
    lastStudiedAt: "2026-08-30T01:00:00.000Z",
    range: "30d",
    accuracy: 75,
    conceptMastery: [{ conceptId: "division", label: "나눗셈", mastery: 80 }],
    reviewDueCount: 2,
    recentSessions: [{
      sessionId: "session-1",
      startedAt: "2026-08-30T01:00:00.000Z",
      problemCount: 4,
      accuracy: 75,
    }],
  };
  assert.deepEqual(study.parseStudyReport(report), report);
  assert.throws(() => study.parseStudyReport({ ...report, accuracy: Number.NaN }), isInvalidStudyResponse);
  assert.throws(() => study.parseStudyReport({
    ...report,
    conceptMastery: [{ conceptId: "division", label: "나눗셈", mastery: Number.POSITIVE_INFINITY }],
  }), isInvalidStudyResponse);
  assert.throws(() => study.parseStudyLearnerState({
    apiVersion: VERSION,
    memberId: "child-2",
    status: "available",
    grade: { grade: 4, source: "study" },
    profile: { memberId: "child-2" },
    activeMissionId: null,
  }), isInvalidStudyResponse);
  const needsSelection = {
    apiVersion: VERSION,
    memberId: "child-2",
    status: "available",
    grade: { grade: null, source: "manual_required" },
    profile: { memberId: "child-2", grade: null },
    activeMissionId: null,
  };
  assert.deepEqual(study.parseStudyLearnerState(needsSelection), needsSelection);
  const selected = {
    ...needsSelection,
    grade: { grade: 5, source: "study" },
    profile: {
      memberId: "child-2",
      grade: { grade: 5, source: "learner_selected", academicYear: 2026 },
    },
  };
  assert.deepEqual(study.parseStudyLearnerState(selected), selected);
});

test("학년 미설정 학습 시작은 선택 학년만 좁은 body로 전송한다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  setApiTokens({ access: "access-token", refresh: "refresh-token" });
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json(mission);
  };
  try {
    await study.startStudyMission({
      mode: "daily",
      grade: 5,
      idempotencyKey: "start-grade-00001",
    });
    assert.deepEqual(requestBody, { mode: "daily", grade: 5 });
  } finally {
    globalThis.fetch = originalFetch;
    clearApiSession();
  }
});

test("답안 재시도는 같은 idempotency key와 정확한 mission 경로를 사용한다", async () => {
  const originalFetch = globalThis.fetch;
  const headers: Headers[] = [];
  const paths: string[] = [];
  setApiTokens({ access: "access-token", refresh: "refresh-token" });
  globalThis.fetch = async (input, init) => {
    paths.push(String(input));
    headers.push(new Headers(init?.headers));
    return Response.json({
      apiVersion: VERSION,
      missionId: "mission/1",
      problemId: "problem-1",
      requestId: "retry-key-000001",
      result: "accepted",
      outcome: {
        isCorrect: true,
        resolutionCode: "submitted",
        feedback: {
          kind: "correct",
          shortReason: "정확해요.",
          finalAnswer: "4",
          next: "continue",
        },
        encouragement: "잘했어!",
      },
    });
  };

  const command = {
    missionId: "mission/1",
    problemId: "problem-1",
    answer: "4",
    idempotencyKey: "retry-key-000001",
  };
  try {
    await study.submitStudyAnswer(command);
    await study.submitStudyAnswer(command, { retry: true });
    assert.equal(new Set(headers.map((value) => value.get("Idempotency-Key"))).size, 1);
    assert.equal(headers[0]?.get("Idempotency-Key"), command.idempotencyKey);
    assert.ok(paths.every((path) => path.endsWith("/api/study/learner/missions/mission%2F1/submissions")));
  } finally {
    globalThis.fetch = originalFetch;
    clearApiSession();
  }
});
