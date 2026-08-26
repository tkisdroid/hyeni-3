import type { LoginFormInput } from "./loginForm.ts";

export const LOGIN_AUTOFILL_ANIMATION_NAME = "hy-login-autofill-detected";

interface LoginAutofillSubmissionInput extends LoginFormInput {
  loginIdAutofilled: boolean;
  passwordAutofilled: boolean;
  busy: boolean;
  autofillAttempted: boolean;
}

/** 브라우저가 저장된 ID·비밀번호를 모두 채운 경우에만 자동 로그인 입력을 확정한다. */
export function resolveLoginAutofillSubmission(
  input: LoginAutofillSubmissionInput,
): LoginFormInput | null {
  if (
    input.busy
    || input.autofillAttempted
    || !input.loginIdAutofilled
    || !input.passwordAutofilled
  ) {
    return null;
  }

  const candidate = {
    loginId: input.loginId,
    password: input.password,
  };
  if (!candidate.loginId.trim() || !candidate.password) return null;
  return candidate;
}

export interface LoginActionGate {
  tryBegin: () => boolean;
  end: () => void;
  active: () => boolean;
}

/** React 렌더보다 빠른 수동·자동완성·소셜 인증 요청을 동기식으로 하나만 통과시킨다. */
export function createLoginActionGate(): LoginActionGate {
  let inFlight = false;
  return {
    tryBegin() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    end() {
      inFlight = false;
    },
    active() {
      return inFlight;
    },
  };
}

/** 표준 selector와 Android WebView·Safari의 WebKit selector를 각각 안전하게 확인한다. */
export function isAutofilledLoginInput(input: Pick<HTMLInputElement, "matches">): boolean {
  for (const selector of [":autofill", ":-webkit-autofill"] as const) {
    try {
      if (input.matches(selector)) return true;
    } catch {
      // 지원하지 않는 selector 하나가 다른 브라우저용 폴백까지 막지 않게 한다.
    }
  }
  return false;
}
