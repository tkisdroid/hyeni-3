/**
 * 인증 폼 순수 정규화/검증(hyeni-1 accountAuth.js 이관).
 * 네트워크·세션 의존 없음 → 어디서나 재사용·테스트 가능.
 */

const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{3,23}$/;

function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeKakaoPhoneSpacing(value: string): string {
  return String(value || "").replace(/^\+82\s*0?/, "+82 ");
}

export function normalizeLoginId(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function isValidLoginId(value: string): boolean {
  return LOGIN_ID_RE.test(normalizeLoginId(value));
}

/** "010XXXXXXXX" 로컬 저장형으로 정규화. 실패 시 throw(한글 메시지). */
export function normalizePhoneForStorage(value: string): string {
  const raw = normalizeKakaoPhoneSpacing(value).trim();
  const digits = digitsOnly(raw);

  if (raw.startsWith("+82") && /^8210\d{8}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  if (/^8210\d{8}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  if (/^010\d{8}$/.test(digits)) {
    return digits;
  }
  throw new Error("휴대폰 번호는 010으로 시작하는 11자리 번호여야 해요");
}

/** "+8210XXXXXXXX" 인증형(E.164)으로 정규화. */
export function normalizePhoneForAuth(value: string): string {
  const local = normalizePhoneForStorage(value);
  return `+82${local.slice(1)}`;
}

const GENDER_VALUES = new Set(["mom", "dad", "guardian"]);
const KOREAN_GENDER_LABEL_TO_VALUE: Record<string, string> = {
  엄마: "mom",
  아빠: "dad",
  보호자: "guardian",
};

export function normalizeGender(value: string | null | undefined): string {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (GENDER_VALUES.has(raw)) return raw;
  return KOREAN_GENDER_LABEL_TO_VALUE[raw] ?? "";
}

/** "YYYY-MM-DD" 유효 생년월일만 통과(미래·비존재 날짜 거름). 무효 시 빈 문자열. */
export function normalizeBirthdate(value: string | null | undefined): string {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [yearStr, monthStr, dayStr] = raw.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (year < 1900) return "";
  const today = new Date();
  if (year > today.getFullYear()) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  if (date.getTime() > today.getTime()) return "";
  return raw;
}

export interface ParentSignupInput {
  name?: string;
  loginId?: string;
  password?: string;
  passwordConfirm?: string;
  gender?: string;
  birthdate?: string;
  phone?: string;
}

export interface ParentSignupValues {
  name: string;
  loginId: string;
  password: string;
  gender: string;
  birthdate: string;
  phoneAuth: string;
  phoneStorage: string;
}

export type ParentSignupErrors = Partial<
  Record<"name" | "loginId" | "password" | "passwordConfirm" | "gender" | "birthdate" | "phone", string>
>;

export interface ParentSignupValidation {
  ok: boolean;
  errors: ParentSignupErrors;
  values: ParentSignupValues | null;
}

/** 부모 가입 폼 검증. ok=false 면 errors, ok=true 면 정규화된 values. */
export function validateParentSignupForm(input: ParentSignupInput): ParentSignupValidation {
  const name = String(input?.name || "").trim();
  const loginId = normalizeLoginId(input?.loginId ?? "");
  const password = String(input?.password || "");
  const passwordConfirm = String(input?.passwordConfirm || "");
  const gender = normalizeGender(input?.gender);
  const birthdate = normalizeBirthdate(input?.birthdate);
  const errors: ParentSignupErrors = {};
  let phoneAuth = "";
  let phoneStorage = "";

  if (!name) errors.name = "이름을 입력해 주세요";
  if (!isValidLoginId(loginId)) {
    errors.loginId = "ID는 영문 소문자, 숫자, ., _, - 조합 4~24자로 입력해 주세요";
  }
  if (password.length < 6) errors.password = "비밀번호는 6자 이상이어야 해요";
  if (password !== passwordConfirm) errors.passwordConfirm = "비밀번호 확인이 일치하지 않아요";
  if (!gender) errors.gender = "엄마, 아빠, 보호자 중에서 선택해 주세요";
  if (!birthdate) errors.birthdate = "생년월일을 YYYY-MM-DD 형식으로 입력해 주세요";

  try {
    phoneAuth = normalizePhoneForAuth(input?.phone ?? "");
    phoneStorage = normalizePhoneForStorage(input?.phone ?? "");
  } catch (error) {
    errors.phone = error instanceof Error ? error.message : "휴대폰 번호를 확인해 주세요";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors, values: null };
  return { ok: true, errors: {}, values: { name, loginId, password, gender, birthdate, phoneAuth, phoneStorage } };
}

export function firstSignupValidationError(errors: ParentSignupErrors): string {
  return (
    errors.name ||
    errors.loginId ||
    errors.password ||
    errors.passwordConfirm ||
    errors.gender ||
    errors.birthdate ||
    errors.phone ||
    "입력값을 확인해 주세요"
  );
}
