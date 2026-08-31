export const GOOGLE_MAP_SCOPES = {
  autocomplete: "https://www.googleapis.com/auth/maps-platform.places.autocomplete",
  details: "https://www.googleapis.com/auth/maps-platform.places.details",
  reverse: "https://www.googleapis.com/auth/maps-platform.geocode.location",
} as const;

const ALLOWED_SCOPES = new Set<string>(Object.values(GOOGLE_MAP_SCOPES));

export interface GoogleMapsTokenProvider {
  getAccessToken(scopes: readonly string[], signal: AbortSignal): Promise<string>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function parseServiceAccount(raw: string): ServiceAccount {
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    const clientEmail = String(parsed.client_email ?? "").trim();
    const privateKey = String(parsed.private_key ?? "").replace(/\\n/gu, "\n").trim();
    if (!clientEmail.endsWith(".gserviceaccount.com") || !privateKey.includes("BEGIN PRIVATE KEY")) throw new Error();
    return { client_email: clientEmail, private_key: privateKey };
  } catch {
    throw new Error("google_maps_credentials_invalid");
  }
}

function pemBytes(pem: string): Uint8Array {
  const normalized = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/gu, "");
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("google_maps_credentials_invalid");
  }
}

async function signedAssertion(account: ServiceAccount, scopes: readonly string[], nowMs: number): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: account.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(account.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
    return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  } catch {
    throw new Error("google_maps_credentials_invalid");
  }
}

export function createGoogleMapsTokenProvider(
  serviceAccountJson: string,
  dependencies: { fetchImpl?: typeof fetch; nowMs?: () => number } = {},
): GoogleMapsTokenProvider {
  const account = parseServiceAccount(serviceAccountJson);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nowMs = dependencies.nowMs ?? Date.now;
  const cache = new Map<string, CachedToken>();

  return {
    async getAccessToken(requestedScopes, signal) {
      const scopes = [...new Set(requestedScopes)].sort();
      if (scopes.length === 0 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
        throw new Error("google_maps_scope_invalid");
      }
      const cacheKey = scopes.join(" ");
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAtMs - nowMs() > 5 * 60_000) return cached.accessToken;
      const assertion = await signedAssertion(account, scopes, nowMs());
      let response: Response;
      try {
        response = await fetchImpl("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion,
          }),
          signal,
          cache: "no-store",
        });
      } catch {
        throw new Error("google_maps_oauth_unavailable");
      }
      const data = await response.json().catch(() => ({})) as { access_token?: unknown; expires_in?: unknown };
      const accessToken = typeof data.access_token === "string" ? data.access_token : "";
      const expiresIn = Number(data.expires_in);
      if (!response.ok || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 300) {
        throw new Error("google_maps_oauth_unavailable");
      }
      cache.set(cacheKey, { accessToken, expiresAtMs: nowMs() + expiresIn * 1000 });
      return accessToken;
    },
  };
}

