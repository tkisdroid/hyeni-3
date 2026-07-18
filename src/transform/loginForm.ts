export interface LoginFormInput {
  loginId: string;
  password: string;
}

export interface LoginFormErrors {
  loginId?: string;
  password?: string;
}

export function validateLoginForm(input: LoginFormInput): LoginFormErrors {
  const errors: LoginFormErrors = {};

  if (!input.loginId.trim()) errors.loginId = "아이디를 입력해 주세요.";
  if (!input.password.trim()) errors.password = "비밀번호를 입력해 주세요.";

  return errors;
}
