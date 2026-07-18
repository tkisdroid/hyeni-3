export type SignupPendingAction = "request-code" | "verify";

export function isLoginNavigationLocked(input: {
  busy: boolean;
  commitBoundaryActive: boolean;
}): boolean {
  return input.busy || input.commitBoundaryActive;
}

export function isSignupActionPending(
  current: SignupPendingAction | null,
  expected: SignupPendingAction,
): boolean {
  return current === expected;
}

export function completeSignupPendingAction(
  current: SignupPendingAction | null,
  completed: SignupPendingAction,
): SignupPendingAction | null {
  return current === completed ? null : current;
}
