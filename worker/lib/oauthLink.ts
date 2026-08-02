/**
 * OAuth 신규 identity 를 기존 계정에 연결할지 판정(순수 함수).
 *
 * 배경(2026-07-10 실기기 규명): 같은 사람이 ID/PW(또는 카카오)로 만든 계정과 같은 이메일로
 * 구글 로그인을 하면, identity 행이 없어 "신규"로 분류되고 email 소유자가 있어 409
 * email_conflict_other_account 로 거부됐다 → 구글 로그인이 영구 실패.
 *
 * 올바른 동작은 계정 연결(account linking)이다. 단, 이메일만으로 연결하면 계정 탈취 경로가 되므로
 * **provider 가 이메일 소유를 검증했을 때만** 연결한다(구글 email_verified, 카카오 is_email_verified).
 * 검증되지 않았거나 소유자가 익명 계정(아이 기기 등)이면 연결하지 않고 그대로 거부한다.
 */

export interface OAuthLinkOwner {
  id: string;
  isAnonymous: boolean;
}

export interface OAuthLinkInput {
  /** provider 가 준 실제 이메일이 아니라 `{provider}-{id}@hyeni.local` 폴백인가. */
  emailIsFallback: boolean;
  /** provider 가 이메일 소유를 검증했는가(구글 email_verified / 카카오 is_email_verified). */
  emailVerified: boolean;
  /** 같은 이메일을 이미 가진 계정(없으면 null). */
  owner: OAuthLinkOwner | null;
}

export type OAuthLinkDecision =
  | { kind: "create" }
  | { kind: "link"; userId: string }
  | { kind: "conflict"; reason: "email_unverified" | "anonymous_owner" | "email_placeholder" };

export function decideOAuthLink(input: OAuthLinkInput): OAuthLinkDecision {
  const { owner, emailVerified, emailIsFallback } = input;
  if (!owner) return { kind: "create" };

  // 폴백 이메일은 사람의 이메일이 아니다 — 이걸로 남의 계정에 붙일 수 없다.
  if (emailIsFallback) return { kind: "conflict", reason: "email_placeholder" };

  // 익명 계정(아이 기기 세션 등)은 절대 OAuth 로 접수하지 않는다.
  if (owner.isAnonymous) return { kind: "conflict", reason: "anonymous_owner" };

  // provider 가 검증하지 않은 이메일로는 연결하지 않는다(탈취 방지).
  if (!emailVerified) return { kind: "conflict", reason: "email_unverified" };

  return { kind: "link", userId: owner.id };
}

export type OAuthConflictReason = "email_unverified" | "anonymous_owner" | "email_placeholder";

/** 사용자에게 보여줄 거부 사유(한국어). */
export function oauthConflictMessage(reason: OAuthConflictReason): string {
  switch (reason) {
    case "email_unverified":
      return "이 이메일이 확인되지 않아 기존 계정과 연결할 수 없어요. 기존 로그인 방법으로 들어와 주세요.";
    case "anonymous_owner":
      return "이 이메일은 다른 계정에서 쓰고 있어요. 기존 로그인 방법으로 들어와 주세요.";
    default:
      return "이 계정으로는 로그인할 수 없어요. 기존 로그인 방법으로 들어와 주세요.";
  }
}

/** provider JSON 의 email_verified 계열 값을 boolean 으로(문자열 "true" 도 허용). */
export function readEmailVerified(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

/**
 * 소셜 연결 해제(unlink) 가능 여부.
 *
 * 마지막 로그인 수단을 지우면 계정에 영영 못 들어간다(OAuth-only 계정은 비밀번호도 없다).
 * 남는 수단이 하나라도 있어야 해제한다. 판단은 보수적으로 — 확실한 수단만 센다.
 */
export interface UnlinkCheck {
  /** login-password 로 들어올 수 있는가(비밀번호 + 전화번호 모두 있어야 한다). */
  hasPasswordLogin: boolean;
  /** 해제 후에 남는 소셜 identity 개수. */
  remainingSocialCount: number;
}

export type UnlinkDecision = { kind: "allow" } | { kind: "deny"; reason: "last_login_method" };

export function decideOAuthUnlink({ hasPasswordLogin, remainingSocialCount }: UnlinkCheck): UnlinkDecision {
  const methods = (hasPasswordLogin ? 1 : 0) + Math.max(0, remainingSocialCount);
  if (methods < 1) return { kind: "deny", reason: "last_login_method" };
  return { kind: "allow" };
}

export function oauthUnlinkDenyMessage(reason: "last_login_method"): string {
  if (reason === "last_login_method") {
    return "마지막 로그인 수단이라 해제할 수 없어요. 다른 로그인 방법을 먼저 추가해 주세요.";
  }
  return "지금은 해제할 수 없어요.";
}
