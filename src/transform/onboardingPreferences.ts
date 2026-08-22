export const ONBOARDING_INTERESTS = [
  "schedule",
  "location",
  "arrival",
  "safety",
  "ai",
] as const;

export type OnboardingInterest = (typeof ONBOARDING_INTERESTS)[number];

const onboardingInterestSet = new Set<string>(ONBOARDING_INTERESTS);

export function normalizeOnboardingInterests(value: unknown): OnboardingInterest[] {
  if (!Array.isArray(value)) return [];
  const normalized: OnboardingInterest[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !onboardingInterestSet.has(item)) continue;
    const interest = item as OnboardingInterest;
    if (!normalized.includes(interest)) normalized.push(interest);
  }
  return normalized;
}

