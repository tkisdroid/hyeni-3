export type SignupPendingAction = "request-code" | "verify";

// Worker callback 페이지의 package-bound intent 재시도 창(15초)이 모두 끝난 뒤에만
// callback 없는 foreground를 사용자의 브라우저 중단으로 확정한다.
export const OAUTH_CALLBACK_DELIVERY_GRACE_MS = 16_000;

export class OperationTimeoutError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "OperationTimeoutError";
  }
}

/** resolve되지 않는 native bridge/fetch도 UI gate를 영구 점유하지 않게 한다. */
export async function withOperationDeadline<T>(
  operation: Promise<T>,
  input: { timeoutMs: number; errorCode: string; onTimeout?: () => void },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      input.onTimeout?.();
      reject(new OperationTimeoutError(input.errorCode));
    }, input.timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export type AsyncActionToken<Action extends string> = Readonly<{
  generation: number;
  action: Action;
}>;

export interface AsyncActionController<Action extends string> {
  begin(action: Action): AsyncActionToken<Action>;
  isOwner(token: AsyncActionToken<Action>): boolean;
  complete(token: AsyncActionToken<Action>): boolean;
  current(): AsyncActionToken<Action> | null;
}

/**
 * 같은 종류의 요청이 겹쳐도 객체 identity와 generation으로 최신 요청만 소유자로 인정한다.
 * 이전 요청의 늦은 완료가 새 요청의 UI·세션을 변경하지 못하게 하는 경계다.
 */
export function createAsyncActionController<Action extends string>(): AsyncActionController<Action> {
  let generation = 0;
  let active: AsyncActionToken<Action> | null = null;

  return {
    begin(action) {
      active = Object.freeze({ generation: ++generation, action });
      return active;
    },
    isOwner(token) {
      return active === token;
    },
    complete(token) {
      if (active !== token) return false;
      active = null;
      return true;
    },
    current() {
      return active;
    },
  };
}

export function isAsyncActionTokenFor<Action extends string>(
  token: AsyncActionToken<Action> | null,
  action: Action,
): boolean {
  return token?.action === action;
}

export async function runOwnedAsyncAction<Action extends string, Result>(input: {
  controller: AsyncActionController<Action>;
  token: AsyncActionToken<Action>;
  request: () => Promise<Result>;
  onSuccess: (result: Result) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
}): Promise<void> {
  try {
    const result = await input.request();
    if (!input.controller.isOwner(input.token)) return;
    input.onSuccess(result);
  } catch (error) {
    if (!input.controller.isOwner(input.token)) return;
    input.onError(error);
  } finally {
    if (input.controller.complete(input.token)) input.onFinally();
  }
}

export function shouldReleaseOAuthBusyOnResume(input: {
  documentVisible: boolean;
  oauthExternalPending: boolean;
  oauthContextPending: boolean;
}): boolean {
  return input.documentVisible && input.oauthExternalPending && input.oauthContextPending;
}

export function isLoginNavigationLocked(input: {
  busy: boolean;
  commitBoundaryActive: boolean;
}): boolean {
  return input.busy || input.commitBoundaryActive;
}
