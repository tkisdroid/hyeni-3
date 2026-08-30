import type { QueryClient } from "@tanstack/react-query";
import { qk } from "./keys";

type StudyRefreshClient = Pick<QueryClient, "invalidateQueries">;

export function refreshStudyAfterAnswer(
  client: StudyRefreshClient,
  input: Readonly<{
    familyId: string;
    learnerMemberId: string | null;
    missionId: string;
  }>,
): void {
  const refreshes = [
    client.invalidateQueries({ queryKey: qk.study.mission(input.familyId, input.missionId), exact: true }),
    client.invalidateQueries({ queryKey: qk.study.learner(input.familyId), exact: true }),
  ];
  if (input.learnerMemberId) {
    refreshes.push(
      client.invalidateQueries({
        queryKey: qk.study.overview(input.familyId, input.learnerMemberId),
        exact: true,
      }),
      client.invalidateQueries({
        queryKey: ["study", "report", input.familyId, input.learnerMemberId],
      }),
    );
  }
  void Promise.allSettled(refreshes);
}
