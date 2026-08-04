/** 친구 초대 공개 링크 조립·파싱. 아이 페어링의 pair=KID-*와 별도 ref 파라미터를 쓴다. */

const REFERRAL_CODE_PATTERN = /^HYENI-[0-9A-HJKMNP-TV-Z]{16}$/;
const REFERRAL_SESSION_KEY = "hyeni_referral_code_v1";

export function normalizeReferralCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

export function buildReferralLink(publicWebBase: string, referralCode: string): string {
  const code = normalizeReferralCode(referralCode);
  if (!code) throw new Error("친구 초대 코드가 올바르지 않아요");
  return `${publicWebBase.replace(/\/$/, "")}/#/onboarding?ref=${encodeURIComponent(code)}`;
}

export function parseReferralCodeFromLocation(location: {
  search?: string;
  hash?: string;
}): string | null {
  const candidates: string[] = [];
  if (location.search) candidates.push(location.search.replace(/^\?/, ""));
  if (location.hash?.includes("?")) {
    candidates.push(location.hash.slice(location.hash.indexOf("?") + 1));
  }
  for (const query of candidates) {
    const code = normalizeReferralCode(new URLSearchParams(query).get("ref"));
    if (code) return code;
  }
  return null;
}

export function readReferralParam(): string | null {
  if (typeof window === "undefined") return null;
  const locationCode = parseReferralCodeFromLocation(window.location);
  if (locationCode) {
    try {
      window.sessionStorage?.setItem(REFERRAL_SESSION_KEY, locationCode);
    } catch {
      // 공개 추천 코드의 session 복원은 best-effort다.
    }
    return locationCode;
  }
  try {
    return normalizeReferralCode(window.sessionStorage?.getItem(REFERRAL_SESSION_KEY));
  } catch {
    return null;
  }
}

/** 가족 생성 성공 후에만 ref 한 항목을 지우며 OAuth·pair 등 다른 파라미터는 보존한다. */
export function clearReferralParam(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(REFERRAL_SESSION_KEY);
  } catch {
    // URL 정리는 계속 시도한다.
  }
  if (!window.history?.replaceState) return;
  const topQuery = new URLSearchParams(window.location.search);
  topQuery.delete("ref");
  let nextHash = window.location.hash;
  if (nextHash.includes("?")) {
    const [path, query = ""] = nextHash.split("?", 2);
    const hashQuery = new URLSearchParams(query);
    hashQuery.delete("ref");
    const remaining = hashQuery.toString();
    nextHash = remaining ? `${path}?${remaining}` : path;
  }
  const search = topQuery.toString();
  try {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${nextHash}`,
    );
  } catch {
    // URL 정리는 보상 귀속 성공을 되돌릴 이유가 없는 best-effort 후처리다.
  }
}
