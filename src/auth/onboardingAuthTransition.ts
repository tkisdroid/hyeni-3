type OnboardingAuthTransitionListener = () => void;
declare const onboardingAuthTransitionTokenBrand: unique symbol;
export type OnboardingAuthTransitionToken = number & {
  readonly [onboardingAuthTransitionTokenBrand]: true;
};

const activeTokens = new Set<OnboardingAuthTransitionToken>();
const listeners = new Set<OnboardingAuthTransitionListener>();
let nextToken = 0;

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function beginOnboardingAuthTransition(): OnboardingAuthTransitionToken {
  const shouldNotify = activeTokens.size === 0;
  nextToken += 1;
  const token = nextToken as OnboardingAuthTransitionToken;
  activeTokens.add(token);
  if (shouldNotify) notifyListeners();
  return token;
}

export function endOnboardingAuthTransition(token: OnboardingAuthTransitionToken): void {
  if (!activeTokens.delete(token)) return;
  if (activeTokens.size === 0) notifyListeners();
}

export function completeOnboardingAuthTransitionsThrough(
  token: OnboardingAuthTransitionToken,
): void {
  const wasActive = activeTokens.size > 0;
  activeTokens.forEach((activeToken) => {
    if (activeToken <= token) activeTokens.delete(activeToken);
  });
  if (wasActive && activeTokens.size === 0) notifyListeners();
}

export function cancelOnboardingAuthTransitions(): void {
  if (activeTokens.size === 0) return;
  activeTokens.clear();
  notifyListeners();
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
