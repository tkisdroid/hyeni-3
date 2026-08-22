import { normalizeOnboardingInterests, type OnboardingInterest } from "./onboardingPreferences.ts";
import type { SignupMethod } from "./onboardingFlow.ts";

const ONBOARDING_DRAFT_KEY = "hyeni-onboarding-draft-v1";
const ONBOARDING_DRAFT_TTL_MS = 20 * 60 * 1000;

export interface PendingPairInvite {
  code: string;
  role: "child" | "parent";
  roleExplicit: boolean;
}

export interface OnboardingDraft {
  version: 1;
  pairInvite: PendingPairInvite | null;
  signupMethod: SignupMethod | null;
  surveyChoices: OnboardingInterest[];
  expiresAtMs: number;
}

function isSignupMethod(value: unknown): value is SignupMethod {
  if (!value || typeof value !== "object") return false;
  const method = value as Partial<SignupMethod>;
  if (method.kind === "phone") return true;
  return method.kind === "oauth"
    && (method.provider === "kakao" || method.provider === "google" || method.provider === "naver");
}

function parsePairInvite(value: unknown): PendingPairInvite | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const invite = value as Partial<PendingPairInvite>;
  const code = typeof invite.code === "string" ? invite.code.trim().toUpperCase() : "";
  if (!/^KID-[A-Z0-9-]{4,96}$/.test(code)) return undefined;
  if (invite.role !== "child" && invite.role !== "parent") return undefined;
  if (typeof invite.roleExplicit !== "boolean") return undefined;
  return { code, role: invite.role, roleExplicit: invite.roleExplicit };
}

export function createOnboardingDraft(input: {
  pairInvite: PendingPairInvite | null;
  signupMethod: SignupMethod | null;
  surveyChoices: unknown;
}, nowMs = Date.now()): OnboardingDraft {
  return {
    version: 1,
    pairInvite: input.pairInvite,
    signupMethod: input.signupMethod,
    surveyChoices: normalizeOnboardingInterests(input.surveyChoices),
    expiresAtMs: nowMs + ONBOARDING_DRAFT_TTL_MS,
  };
}

export function parseOnboardingDraft(raw: string | null, nowMs = Date.now()): OnboardingDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (value.version !== 1 || !Number.isSafeInteger(value.expiresAtMs) || Number(value.expiresAtMs) <= nowMs) {
      return null;
    }
    const pairInvite = parsePairInvite(value.pairInvite ?? null);
    if (pairInvite === undefined) return null;
    if (value.signupMethod !== null && value.signupMethod !== undefined && !isSignupMethod(value.signupMethod)) {
      return null;
    }
    return {
      version: 1,
      pairInvite,
      signupMethod: value.signupMethod ?? null,
      surveyChoices: normalizeOnboardingInterests(value.surveyChoices),
      expiresAtMs: Number(value.expiresAtMs),
    };
  } catch {
    return null;
  }
}

function browserStores(): Storage[] {
  if (typeof window === "undefined") return [];
  return [window.sessionStorage, window.localStorage];
}

export function clearOnboardingDraft(): void {
  for (const storage of browserStores()) {
    try {
      storage.removeItem(ONBOARDING_DRAFT_KEY);
    } catch {
      // 저장소가 막혀도 다른 저장소와 현재 화면 흐름은 계속 사용한다.
    }
  }
}

export function readOnboardingDraft(): OnboardingDraft | null {
  const drafts: OnboardingDraft[] = [];
  for (const storage of browserStores()) {
    try {
      const parsed = parseOnboardingDraft(storage.getItem(ONBOARDING_DRAFT_KEY));
      if (parsed) drafts.push(parsed);
    } catch {
      // 저장소 접근 불가
    }
  }
  if (drafts.length === 0) return null;
  const canonical = JSON.stringify(drafts[0]);
  if (!drafts.every((draft) => JSON.stringify(draft) === canonical)) {
    clearOnboardingDraft();
    return null;
  }
  return drafts[0] ?? null;
}

export function persistOnboardingDraft(input: {
  pairInvite: PendingPairInvite | null;
  signupMethod: SignupMethod | null;
  surveyChoices: unknown;
}): OnboardingDraft {
  const draft = createOnboardingDraft(input);
  const serialized = JSON.stringify(draft);
  clearOnboardingDraft();
  for (const storage of browserStores()) {
    try {
      storage.setItem(ONBOARDING_DRAFT_KEY, serialized);
    } catch {
      // OAuth 보안 context가 별도로 실패를 차단하므로 draft 저장 실패는 현재 화면 상태로 복구한다.
    }
  }
  return draft;
}

