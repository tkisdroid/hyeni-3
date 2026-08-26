export type StudyMutationVariables = Readonly<{
  memberId: string;
  requestId: string;
}>;

export type StudyMutationRequest = StudyMutationVariables & Readonly<{
  run<T>(send: (variables: StudyMutationVariables) => Promise<T>): Promise<T>;
}>;

export function createStudyMutationRequest(rawMemberId: string): StudyMutationRequest {
  const memberId = String(rawMemberId ?? "").trim();
  if (!memberId) throw new Error("study_member_required");
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("study_random_unavailable");
  }
  const variables = Object.freeze({ memberId, requestId: crypto.randomUUID() });
  return Object.freeze({
    ...variables,
    run<T>(send: (input: StudyMutationVariables) => Promise<T>): Promise<T> {
      return send(variables);
    },
  });
}
