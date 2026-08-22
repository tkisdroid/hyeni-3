import { API_BASE } from "@/config/env";
import { normalizeAccessCountry } from "@/transform/accessCountry";

const DEFAULT_TIMEOUT_MS = 2_500;

type FetchAccessCountryOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * 인증·위치 권한 없이 Cloudflare 엣지의 2자리 접속 국가만 읽는다.
 * 실패해도 로그인 진입을 막지 않으며 호출자는 브라우저 힌트로 강등한다.
 */
export async function fetchAccessCountry({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: FetchAccessCountryOptions = {}): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API_BASE}/api/access-region`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { country?: unknown };
    const country = normalizeAccessCountry(payload.country);
    return country === "ZZ" ? null : country;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
