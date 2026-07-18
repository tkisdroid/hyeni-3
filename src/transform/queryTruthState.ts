export interface QueryTruthInput {
  isLoading: boolean;
  isError: boolean;
}

export type QueryTruthState = "loading" | "error" | "ready";

export function resolveQueryTruthState(states: readonly QueryTruthInput[]): QueryTruthState {
  if (states.some((state) => state.isError)) return "error";
  if (states.some((state) => state.isLoading)) return "loading";
  return "ready";
}
