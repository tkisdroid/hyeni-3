export type AuthResultSessionAdoption = "immediate" | "deferred";

export interface AuthResultAdoptionOptions {
  sessionAdoption?: AuthResultSessionAdoption;
}

interface AuthResultAdoptionEffects<T extends object> {
  applySession: (result: T) => void;
  applyUser: (result: T) => void;
  notify: () => void;
}

/** 같은 인증 응답을 StrictMode continuation이 다시 처리해도 세션은 한 번만 채택한다. */
export function createIdempotentAuthResultAdopter<T extends object>(
  effects: AuthResultAdoptionEffects<T>,
): (result: T) => boolean {
  const adoptedResults = new WeakSet<T>();

  return (result) => {
    if (adoptedResults.has(result)) return false;
    adoptedResults.add(result);
    try {
      effects.applySession(result);
      effects.applyUser(result);
      effects.notify();
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
