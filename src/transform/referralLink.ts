/** 친구 초대 공개 링크 조립·파싱. 아이 페어링의 pair=KID-*와 별도 ref 파라미터를 쓴다. */

const REFERRAL_CODE_PATTERN = /^HYENI-[0-9A-HJKMNP-TV-Z]{16}$/;
const REFERRAL_CODE_IN_TEXT = /HYENI-[0-9A-HJKMNP-TV-Z]{16}/i;
const REFERRAL_SESSION_KEY = "hyeni_referral_code_v1";
const REFERRAL_STORAGE_KEY = "hyeni_referral_code_v1";

export const REFERRAL_CODE_EVENT = "hyeni:referral-code";

export function normalizeReferralCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/**
 * 코드 원문, 초대 URL, 공유 문구에서 HYENI 코드를 꺼낸다.
 * 카카오톡·메일에서 링크를 통째로 붙여 넣는 경우를 위해 본문 검색을 허용한다.
 */
export function extractReferralCodeFromInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = normalizeReferralCode(trimmed);
  if (direct) return direct;

  const fromHref = parseReferralCodeFromHref(trimmed);
  if (fromHref) return fromHref;

  const embedded = trimmed.match(REFERRAL_CODE_IN_TEXT);
  return embedded ? normalizeReferralCode(embedded[0]) : null;
}

export function buildReferralLink(publicWebBase: string, referralCode: string): string {
  const code = normalizeReferralCode(referralCode);
  if (!code) throw new Error("친구 초대 코드가 올바르지 않아요");
  // 해시(#/onboarding?ref=)는 카카오톡·라인 등에서 잘린다.
  // 루트 쿼리는 현재 Pages 가 그대로 index.html 을 주므로 /invite 배포 전에도 열린다.
  return `${publicWebBase.replace(/\/$/, "")}/?ref=${encodeURIComponent(code)}`;
}

function parseQueryReferral(query: string): string | null {
  return normalizeReferralCode(new URLSearchParams(query).get("ref"));
}

export function parseReferralCodeFromLocation(location: {
  search?: string;
  hash?: string;
  pathname?: string;
}): string | null {
  const candidates: string[] = [];
  if (location.search) candidates.push(location.search.replace(/^\?/, ""));
  if (location.hash?.includes("?")) {
    candidates.push(location.hash.slice(location.hash.indexOf("?") + 1));
  }
  for (const query of candidates) {
    const code = parseQueryReferral(query);
    if (code) return code;
  }
  const path = location.pathname ?? "";
  const inviteMatch = path.match(/^\/invite\/(HYENI-[0-9A-HJKMNP-TV-Z]{16})\/?$/i);
  return inviteMatch ? normalizeReferralCode(inviteMatch[1]) : null;
}

export function parseReferralCodeFromHref(href: string): string | null {
  const raw = href.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://hyeni-calendar.pages.dev");
    return parseReferralCodeFromLocation({
      search: url.search,
      hash: url.hash,
      pathname: url.pathname,
    });
  } catch {
    return null;
  }
}

function writeStoredReferralCode(code: string): void {
  try {
    window.localStorage?.setItem(REFERRAL_STORAGE_KEY, code);
  } catch {
    // 영속 저장 실패 시 session 폴백.
  }
  try {
    window.sessionStorage?.setItem(REFERRAL_SESSION_KEY, code);
  } catch {
    // 공개 추천 코드의 저장은 best-effort다.
  }
}

function readStoredReferralCode(): string | null {
  try {
    const local = normalizeReferralCode(window.localStorage?.getItem(REFERRAL_STORAGE_KEY));
    if (local) return local;
  } catch {
    // localStorage 접근 불가면 session 을 본다.
  }
  try {
    return normalizeReferralCode(window.sessionStorage?.getItem(REFERRAL_SESSION_KEY));
  } catch {
    return null;
  }
}

export function persistReferralCode(referralCode: string): string | null {
  const code = normalizeReferralCode(referralCode);
  if (!code || typeof window === "undefined") return null;
  writeStoredReferralCode(code);
  try {
    window.dispatchEvent(new CustomEvent(REFERRAL_CODE_EVENT, { detail: { code } }));
  } catch {
    // 화면이 아직 없으면 저장만으로 충분하다.
  }
  return code;
}

export function rememberReferralFromHref(href: string): string | null {
  const code = parseReferralCodeFromHref(href);
  return code ? persistReferralCode(code) : null;
}

export function rememberReferralFromCurrentLocation(): string | null {
  if (typeof window === "undefined") return null;
  const locationCode = parseReferralCodeFromLocation(window.location);
  return locationCode ? persistReferralCode(locationCode) : readStoredReferralCode();
}

export function readReferralParam(): string | null {
  if (typeof window === "undefined") return null;
  return rememberReferralFromCurrentLocation();
}

/** 가족 생성 성공 후에만 ref 한 항목을 지우며 OAuth·pair 등 다른 파라미터는 보존한다. */
export function clearReferralParam(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(REFERRAL_SESSION_KEY);
  } catch {
    // URL 정리는 계속 시도한다.
  }
  try {
    window.localStorage?.removeItem(REFERRAL_STORAGE_KEY);
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
