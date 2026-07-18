type OnboardingAuthTransitionListener = () => void;
export type OnboardingAuthTransitionToken = symbol;

const activeTokens = new Set<OnboardingAuthTransitionToken>();
const listeners = new Set<OnboardingAuthTransitionListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function beginOnboardingAuthTransition(): OnboardingAuthTransitionToken {
  const shouldNotify = activeTokens.size === 0;
  const token = Symbol("onboarding-auth-transition");
  activeTokens.add(token);
  if (shouldNotify) notifyListeners();
  return token;
}

export function endOnboardingAuthTransition(token: OnboardingAuthTransitionToken): void {
  if (!activeTokens.delete(token)) return;
  if (activeTokens.size === 0) notifyListeners();
}

function clearOnboardingAuthTransitions(): void {
  if (activeTokens.size === 0) return;
  activeTokens.clear();
  notifyListeners();
}

export function completeOnboardingAuthTransitions(): void {
  clearOnboardingAuthTransitions();
}

export function cancelOnboardingAuthTransitions(): void {
  clearOnboardingAuthTransitions();
}

export function getOnboardingAuthTransitionSnapshot(): boolean {
  return activeTokens.size > 0;
}

export function subscribeOnboardingAuthTransition(
  listener: OnboardingAuthTransitionListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
