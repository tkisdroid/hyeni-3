import type {
  CalendarMissionInput,
  CalendarStudyAuthorizationV2,
  CalendarStudyServiceBinding,
  ChildReportInput,
  LearnerStateInput,
  ParentOverviewInput,
  StartCalendarMissionInput,
  SubmitCalendarAnswerInput,
} from "../contracts/studyRpc";

declare const binding: CalendarStudyServiceBinding;
declare const auth: CalendarStudyAuthorizationV2;

const children: ParentOverviewInput = {
  children: [{ memberId: "child-a", grade: { grade: 4, source: "hyeni_birth_year", academicYear: 2026 } }],
  requestId: "request-id-00000001",
};
const report: ChildReportInput = {
  memberId: "child-a",
  grade: { grade: 4, source: "hyeni_birth_year", academicYear: 2026 },
  range: "7d",
  requestId: "request-id-00000002",
};
const learner: LearnerStateInput = { memberId: "child-a", requestId: "request-id-00000003" };
const start: StartCalendarMissionInput = { memberId: "child-a", mode: "daily", requestId: "request-id-00000004" };
const mission: CalendarMissionInput = { memberId: "child-a", missionId: "mission-a", requestId: "request-id-00000005" };
const submission: SubmitCalendarAnswerInput = {
  memberId: "child-a",
  missionId: "mission-a",
  problemId: "problem-a",
  answer: "42",
  requestId: "request-id-00000006",
};

void binding.getChildrenOverview(children, auth);
void binding.getChildReport(report, auth);
void binding.getLearnerState(learner, auth);
void binding.startCalendarMission(start, auth);
void binding.getCalendarMission(mission, auth);
void binding.submitCalendarAnswer(submission, auth);
