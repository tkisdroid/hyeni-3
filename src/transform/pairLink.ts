/**
 * 페어링 딥링크 조립·파싱.
 * QR 은 공개 웹앱 주소의 온보딩으로 향하는 딥링크를 인코딩한다.
 *   https://<web>/#/onboarding?pair=KID-XXXXXXXX
 * 아이 기기가 카메라로 스캔하면 웹앱이 열리고, Onboarding 이 pair 파라미터를 읽어
 * 코드를 미리 채운 채 아이 연결 흐름으로 진입한다.
 */
import { PUBLIC_WEB_BASE } from "@/config/env";

/** 페어링 코드 → QR 에 넣을 공개 딥링크. */
export function buildPairLink(pairCode: string): string {
  const code = String(pairCode || "").trim().toUpperCase();
  return `${PUBLIC_WEB_BASE}/#/onboarding?pair=${encodeURIComponent(code)}`;
}

/**
 * 현재 URL(검색·해시 양쪽)에서 pair 파라미터를 추출한다. 없으면 null.
 * HashRouter 라 코드가 해시 뒤(#/onboarding?pair=...)에 오는 경우가 일반적이다.
 */
export function readPairParam(): string | null {
  if (typeof window === "undefined") return null;
  const candidates: string[] = [];
  const { search, hash } = window.location;
  if (search) candidates.push(search.replace(/^\?/, ""));
  if (hash && hash.includes("?")) candidates.push(hash.slice(hash.indexOf("?") + 1));
  for (const qs of candidates) {
    const v = new URLSearchParams(qs).get("pair");
    if (v) {
      const code = decodeURIComponent(v).trim().toUpperCase();
      if (code) return code;
    }
  }
  return null;
}

/** URL 에서 pair 파라미터를 제거한다(1회 처리 후 새로고침·뒤로가기 재발동 방지). */
export function clearPairParam(): void {
  if (typeof window === "undefined") return;
  const { hash } = window.location;
  if (hash && hash.includes("?")) {
    const base = hash.slice(0, hash.indexOf("?"));
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + base);
    } catch {
      /* replaceState 실패는 무시(치명적 아님) */
    }
  }
}
