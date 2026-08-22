export const ONBOARDING_INTERESTS = [
  "schedule",
  "location",
  "arrival",
  "safety",
  "ai",
] as const;

export type OnboardingInterest = (typeof ONBOARDING_INTERESTS)[number];

const onboardingInterestSet = new Set<string>(ONBOARDING_INTERESTS);

export type ParsedOnboardingInterests =
  | { ok: true; present: false; interests: [] }
  | { ok: true; present: true; interests: OnboardingInterest[] }
  | { ok: false };

export function parseOnboardingInterests(value: unknown): ParsedOnboardingInterests {
  if (value === undefined) return { ok: true, present: false, interests: [] };
  if (!Array.isArray(value) || value.length > ONBOARDING_INTERESTS.length) return { ok: false };
  const interests: OnboardingInterest[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !onboardingInterestSet.has(item)) return { ok: false };
    const interest = item as OnboardingInterest;
    if (!interests.includes(interest)) interests.push(interest);
  }
  return { ok: true, present: true, interests };
}

export function attachOnboardingPreferences<T extends Record<string, unknown>>(
  metadata: T,
  parsed: Extract<ParsedOnboardingInterests, { ok: true }>,
  completedAt: string,
): T & Record<string, unknown> {
  if (!parsed.present) return metadata;
  return {
    ...metadata,
    onboarding_interests: parsed.interests,
    onboarding_completed_at: completedAt,
  };
}

