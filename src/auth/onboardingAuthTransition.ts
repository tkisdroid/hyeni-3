type OnboardingAuthTransitionListener = () => void;
declare const onboardingAuthTransitionTokenBrand: unique symbol;
export type OnboardingAuthTransitionToken = number & {
  readonly [onboardingAuthTransitionTokenBrand]: true;
};

const activeTokens = new Set<OnboardingAuthTransitionToken>();
const committedTokens = new Set<OnboardingAuthTransitionToken>();
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
  // 세션 채택 뒤에는 가족 판정이 끝나기 전 cleanup/back으로 gate를 풀 수 없다.
  if (committedTokens.has(token)) return;
  if (!activeTokens.delete(token)) return;
  if (activeTokens.size === 0) notifyListeners();
}

export function isOnboardingAuthTransitionActive(
  token: OnboardingAuthTransitionToken,
): boolean {
  return activeTokens.has(token);
}

export type OnboardingAuthCommitResult = "stale" | "adopted" | "replayed";

/** active 확인과 세션 채택 경계를 한 동기 continuation 안에서 확정한다. */
export function commitOnboardingAuthResult<T extends object>(
  token: OnboardingAuthTransitionToken,
  result: T,
  adopt: (result: T) => boolean,
): OnboardingAuthCommitResult {
  if (!activeTokens.has(token)) return "stale";
  committedTokens.add(token);
  notifyListeners();
  try {
    return adopt(result) ? "adopted" : "replayed";
  } catch (error) {
    committedTokens.delete(token);
    notifyListeners();
    throw error;
  }
}

export function completeOnboardingAuthTransitionsThrough(
  token: OnboardingAuthTransitionToken,
): boolean {
  if (!activeTokens.has(token)) return false;
  activeTokens.forEach((activeToken) => {
    if (activeToken <= token) {
      activeTokens.delete(activeToken);
      committedTokens.delete(activeToken);
    }
  });
  notifyListeners();
  return true;
}

export function cancelOnboardingAuthTransitions(): void {
  if (activeTokens.size === 0) return;
  activeTokens.forEach((token) => {
    if (!committedTokens.has(token)) activeTokens.delete(token);
  });
  notifyListeners();
}

export function getOnboardingAuthTransitionSnapshot(): boolean {
  return activeTokens.size > 0;
}

export function getOnboardingAuthCommitSnapshot(): boolean {
  return committedTokens.size > 0;
}

export function subscribeOnboardingAuthTransition(
  listener: OnboardingAuthTransitionListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
