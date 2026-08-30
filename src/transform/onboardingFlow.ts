export type OnboardingRole = "parent" | "child" | "teacher";
export type SignupProvider = "kakao" | "google";
export type SignupMethod =
  | { kind: "phone" }
  | { kind: "oauth"; provider: SignupProvider };

export type PairInviteAction =
  | "role-home"
  | "choose-role"
  | "parent-auth"
  | "parent-pair"
  | "child-session"
  | "role-mismatch";

export function resolveSignupContinuation(method: SignupMethod):
  | { kind: "phone-form" }
  | { kind: "oauth"; provider: SignupProvider } {
  return method.kind === "phone"
    ? { kind: "phone-form" }
    : { kind: "oauth", provider: method.provider };
}

export function resolvePairInviteAction(input: {
  inviteRole: "parent" | "child";
  roleExplicit: boolean;
  authStatus: "authenticated" | "unauthenticated";
  authRole: OnboardingRole | null;
  familyId: string | null;
}): PairInviteAction {
  if (input.authStatus === "authenticated" && input.familyId) return "role-home";
  if (input.authStatus === "unauthenticated" && !input.roleExplicit) return "choose-role";

  if (input.inviteRole === "parent") {
    if (input.authStatus === "unauthenticated") return "parent-auth";
    return input.authRole === "parent" ? "parent-pair" : "role-mismatch";
  }

  if (input.authStatus === "unauthenticated" || input.authRole === "child") {
    return "child-session";
  }
  if (input.authRole === "parent" && !input.roleExplicit) return "parent-pair";
  return "role-mismatch";
}

export function resolvePostAuthAction(input: {
  authRole: OnboardingRole | null;
  familyExists: boolean;
  pendingParentInvite: boolean;
}): "role-home" | "parent-pair" | "parent-connect" | "child-pair" | "teacher-setup" {
  if (input.authRole === "child") return input.familyExists ? "role-home" : "child-pair";
  if (input.authRole === "teacher") return input.familyExists ? "role-home" : "teacher-setup";
  if (input.authRole !== "parent" || input.familyExists) return "role-home";
  return input.pendingParentInvite ? "parent-pair" : "parent-connect";
}
