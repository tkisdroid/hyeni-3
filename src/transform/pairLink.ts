/**
 * 페어링 딥링크 조립·파싱.
 * QR 은 공개 웹앱 주소의 온보딩으로 향하는 딥링크를 인코딩한다.
 *   https://<web>/#/onboarding?pair=KID-XXXXXXXX&as=child|parent
 * 카메라로 스캔하면 웹앱이 열리고, Onboarding 이 pair와 as를 함께 읽어
 * 역할 명시 링크는 해당 흐름으로, 공용 링크는 역할 선택으로 진입한다.
 */
import { PUBLIC_WEB_BASE } from "@/config/env";

export type PairInviteRole = "child" | "parent";

export interface PairInvite {
  code: string;
  role: PairInviteRole;
  roleExplicit: boolean;
}

/** 페어링 코드 → QR 에 넣을 역할 명시 공개 딥링크. */
export function buildPairLink(pairCode: string, role: PairInviteRole): string {
  const code = String(pairCode || "").trim().toUpperCase();
  return `${PUBLIC_WEB_BASE}/#/onboarding?pair=${encodeURIComponent(code)}&as=${role}`;
}

/**
 * 아이관리의 공용 QR처럼 연결 대상이 정해지지 않은 진입점에 쓴다.
 * 역할을 URL에서 추정하지 않아 Safari로 읽어도 온보딩에서 학부모/아이를 먼저 선택한다.
 */
export function buildPairRoleChoiceLink(pairCode: string): string {
  const code = String(pairCode || "").trim().toUpperCase();
  return `${PUBLIC_WEB_BASE}/#/onboarding?pair=${encodeURIComponent(code)}`;
}

export function parsePairInviteFromLocation(input: { search: string; hash: string }): PairInvite | null {
  const candidates: string[] = [];
  if (input.hash && input.hash.includes("?")) candidates.push(input.hash.slice(input.hash.indexOf("?") + 1));
  if (input.search) candidates.push(input.search.replace(/^\?/, ""));
  for (const query of candidates) {
    const params = new URLSearchParams(query);
    const code = String(params.get("pair") ?? "").trim().toUpperCase();
    if (!code) continue;
    const requestedRole = params.get("as");
    const roleExplicit = requestedRole === "child" || requestedRole === "parent";
    return {
      code,
      role: requestedRole === "parent" ? "parent" : "child",
      roleExplicit,
    };
  }
  return null;
}

/**
 * 현재 URL(검색·해시 양쪽)에서 pair 파라미터를 추출한다. 없으면 null.
 * HashRouter 라 코드가 해시 뒤(#/onboarding?pair=...)에 오는 경우가 일반적이다.
 */
export function readPairParam(): string | null {
  if (typeof window === "undefined") return null;
  return parsePairInviteFromLocation(window.location)?.code ?? null;
}

export function readPairInvite(): PairInvite | null {
  if (typeof window === "undefined") return null;
  return parsePairInviteFromLocation(window.location);
}

function stripOwnedParams(query: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ""));
  params.delete("pair");
  params.delete("as");
  return params.toString();
}

export function removePairInviteParams(input: {
  pathname: string;
  search: string;
  hash: string;
}): { search: string; hash: string } {
  const searchQuery = stripOwnedParams(input.search);
  let hash = input.hash;
  if (hash.includes("?")) {
    const queryIndex = hash.indexOf("?");
    const base = hash.slice(0, queryIndex);
    const hashQuery = stripOwnedParams(hash.slice(queryIndex + 1));
    hash = hashQuery ? `${base}?${hashQuery}` : base;
  }
  return {
    search: searchQuery ? `?${searchQuery}` : "",
    hash,
  };
}

/** URL 에서 pair 파라미터를 제거한다(1회 처리 후 새로고침·뒤로가기 재발동 방지). */
export function clearPairParam(): void {
  if (typeof window === "undefined") return;
  const next = removePairInviteParams(window.location);
  try {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + next.search + next.hash,
    );
  } catch {
    /* replaceState 실패는 무시(치명적 아님) */
  }
}
