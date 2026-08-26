import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudyManagementView,
  resolveSelectedStudyMember,
  selectActiveStudyChildren,
} from "../src/transform/studyManagementView.ts";

function familyChild(memberId: string, isActive = true) {
  return {
    id: memberId,
    role: "child" as const,
    name: memberId,
    photo_url: null,
    child_order: 0,
    is_active: isActive,
  };
}

function studyChild(memberId: string, linked = true) {
  return {
    memberId,
    displayName: memberId,
    photoAvailable: false,
    linked,
    grade: linked ? 4 as const : null,
    canManageLinks: false,
  };
}

function realReport(memberId: string, linked = true) {
  return {
    apiVersion: "2026-08-24" as const,
    memberId,
    linked,
    grade: linked ? 4 as const : null,
    range: "7d" as const,
    todayProblemCount: 8,
    completedToday: true,
    lastStudiedAt: "2026-08-27T01:00:00.000Z",
    accuracy: 75,
    conceptMastery: [{ conceptId: "fraction", label: "분수", mastery: 80 }],
    reviewDueCount: 1,
    recentSessions: [{
      sessionId: "session-a",
      startedAt: "2026-08-27T00:30:00.000Z",
      problemCount: 8,
      accuracy: 75,
    }],
  };
}

test("활성 자녀 member id만 사용하고 비활성 ghost를 선택하지 않는다", () => {
  const children = selectActiveStudyChildren([
    familyChild("active-a"),
    familyChild("ghost", false),
    { ...familyChild("parent"), role: "parent" as const },
    familyChild("active-b"),
  ]);

  assert.deepEqual(children.map((child) => child.memberId), ["active-a", "active-b"]);
  assert.equal(resolveSelectedStudyMember(children, "ghost"), null);
  assert.equal(resolveSelectedStudyMember(children, "active-b"), "active-b");
});

test("자녀가 하나면 exact id를 선택하고 여러 명이면 명시 선택을 요구한다", () => {
  const only = selectActiveStudyChildren([familyChild("active-a")]);
  const many = selectActiveStudyChildren([familyChild("active-a"), familyChild("active-b")]);

  assert.equal(resolveSelectedStudyMember(only, null), "active-a");
  assert.equal(resolveSelectedStudyMember(many, null), null);
});

test("실제 report 데이터로 읽기 전용 linked 부모 화면을 만든다", () => {
  const child = studyChild("active-a");
  const state = buildStudyManagementView({
    featureState: "ready",
    activeChildren: selectActiveStudyChildren([familyChild("active-a")]),
    selectedMemberId: "active-a",
    studyChild: child,
    report: realReport("active-a"),
    devices: [],
    canManageLinks: false,
  });

  assert.equal(state.kind, "linked");
  assert.equal(state.kind === "linked" ? state.report.grade : null, 4);
  assert.equal(state.kind === "linked" ? state.report.todayProblemCount : null, 8);
  assert.equal(state.kind === "linked" ? state.canManageLinks : true, false);
});

test("연결 전 상태는 0으로 채운 가짜 report를 노출하지 않는다", () => {
  const child = studyChild("active-a", false);
  const state = buildStudyManagementView({
    featureState: "ready",
    activeChildren: selectActiveStudyChildren([familyChild("active-a")]),
    selectedMemberId: "active-a",
    studyChild: child,
    report: realReport("active-a", false),
    devices: [],
    canManageLinks: true,
  });

  assert.deepEqual(state, {
    kind: "unlinked",
    memberId: "active-a",
    child,
    devices: [],
    canManageLinks: true,
  });
  assert.equal("report" in state, false);
});

test("빈 가족·disabled·장애·다자녀 미선택 상태를 서로 구분한다", () => {
  const base = {
    featureState: "ready" as const,
    activeChildren: selectActiveStudyChildren([familyChild("active-a")]),
    selectedMemberId: "active-a",
    studyChild: studyChild("active-a"),
    report: realReport("active-a"),
    devices: [],
    canManageLinks: false,
  };

  assert.equal(buildStudyManagementView({ ...base, activeChildren: [] }).kind, "no-active-children");
  assert.equal(buildStudyManagementView({ ...base, featureState: "disabled" }).kind, "service-disabled");
  assert.equal(buildStudyManagementView({ ...base, unavailable: true }).kind, "service-unavailable");
  assert.equal(buildStudyManagementView({
    ...base,
    activeChildren: selectActiveStudyChildren([familyChild("active-a"), familyChild("active-b")]),
    selectedMemberId: null,
  }).kind, "select-child");
});

test("선택 member와 다른 report는 unavailable로 격리한다", () => {
  const state = buildStudyManagementView({
    featureState: "ready",
    activeChildren: selectActiveStudyChildren([familyChild("active-a")]),
    selectedMemberId: "active-a",
    studyChild: studyChild("active-a"),
    report: realReport("active-b"),
    devices: [],
    canManageLinks: true,
  });

  assert.equal(state.kind, "service-unavailable");
});
