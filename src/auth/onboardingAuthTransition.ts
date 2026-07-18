type OnboardingAuthTransitionListener = () => void;

let authTransitionActive = false;
const listeners = new Set<OnboardingAuthTransitionListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function beginOnboardingAuthTransition(): void {
  if (authTransitionActive) return;
  authTransitionActive = true;
  notifyListeners();
}

export function endOnboardingAuthTransition(): void {
  if (!authTransitionActive) return;
  authTransitionActive = false;
  notifyListeners();
}

export function getOnboardingAuthTransitionSnapshot(): boolean {
  return authTransitionActive;
}

export function subscribeOnboardingAuthTransition(
  listener: OnboardingAuthTransitionListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
