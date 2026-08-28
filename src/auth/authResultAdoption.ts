export type AuthResultSessionAdoption = "immediate" | "deferred";

export interface AuthResultAdoptionOptions {
  sessionAdoption?: AuthResultSessionAdoption;
}

interface AuthResultAdoptionEffects<T extends object, C> {
  applySession: (result: T, context: C | undefined) => void;
  applyUser: (result: T, context: C | undefined) => void;
  notify: (context: C | undefined) => void;
}

/** 같은 인증 응답을 StrictMode continuation이 다시 처리해도 세션은 한 번만 채택한다. */
export function createIdempotentAuthResultAdopter<T extends object, C = never>(
  effects: AuthResultAdoptionEffects<T, C>,
): (result: T, context?: C) => boolean {
  const adoptedResults = new WeakSet<T>();

  return (result, context) => {
    if (adoptedResults.has(result)) return false;
    adoptedResults.add(result);
    try {
      effects.applySession(result, context);
      effects.applyUser(result, context);
      effects.notify(context);
      return true;
    } catch (error) {
      adoptedResults.delete(result);
      throw error;
    }
  };
}

/** 인자를 생략한 기존 호출은 즉시 채택하고, 온보딩만 명시적으로 deferred를 선택한다. */
export function returnAuthResultWithAdoption<T extends object>(
  result: T,
  options: AuthResultAdoptionOptions | undefined,
  adopt: (result: T) => boolean,
): T {
  if ((options?.sessionAdoption ?? "immediate") === "immediate") {
    adopt(result);
  }
  return result;
}
