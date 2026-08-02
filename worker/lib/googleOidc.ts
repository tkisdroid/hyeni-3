type FetchImplementation = typeof fetch;
type JsonMap = Record<string, unknown>;

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const JWKS_REFRESH_COOLDOWN_MS = 60_000;
const MAX_NEGATIVE_KIDS = 32;

type GoogleJwk = JsonWebKey & {
  kid: string;
  alg?: string;
  use?: string;
};

export interface GoogleOidcClaims extends JsonMap {
  iss: string;
  aud: string;
  email: string;
  email_verified: true;
  iat: number;
  exp: number;
}

export class GoogleOidcVerificationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "GoogleOidcVerificationError";
    this.code = code;
  }
}

let jwksCache: { keys: GoogleJwk[]; fetchedAt: number; expiresAt: number } | null = null;
let jwksFetchInFlight: Promise<GoogleJwk[]> | null = null;
let lastFetchAttemptAt: number | null = null;
const negativeKidCache = new Map<string, number>();

function fail(code = "rtdn_invalid_token"): never {
  throw new GoogleOidcVerificationError(code);
}

function isObject(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    fail();
  }
}

function decodeJwtJson(value: string): JsonMap {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(decodeBase64Url(value));
    const parsed: unknown = JSON.parse(decoded);
    if (!isObject(parsed)) fail();
    return parsed;
  } catch (error) {
    if (error instanceof GoogleOidcVerificationError) throw error;
    fail();
  }
}

function cacheMaxAgeMillis(header: string | null): number {
  if (!header) return 0;
  const match = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(header);
  if (!match) return 0;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) ? seconds * 1000 : 0;
}

function isGoogleJwk(value: unknown): value is GoogleJwk {
  if (!isObject(value)) return false;
  return value.kty === "RSA"
    && typeof value.kid === "string"
    && value.kid.length > 0
    && (value.alg === undefined || value.alg === "RS256")
    && (value.use === undefined || value.use === "sig")
    && typeof value.n === "string"
    && typeof value.e === "string";
}

async function fetchGoogleJwks(
  fetchImpl: FetchImplementation,
  nowMillis: number,
): Promise<GoogleJwk[]> {
  if (jwksFetchInFlight) return jwksFetchInFlight;
  if (lastFetchAttemptAt !== null && lastFetchAttemptAt + JWKS_REFRESH_COOLDOWN_MS > nowMillis) {
    fail("rtdn_oidc_unavailable");
  }
  lastFetchAttemptAt = nowMillis;

  const request = (async (): Promise<GoogleJwk[]> => {
    let response: Response;
    try {
      response = await fetchImpl(GOOGLE_JWKS_URL);
    } catch {
      fail("rtdn_oidc_unavailable");
    }
    if (!response.ok) fail("rtdn_oidc_unavailable");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      fail("rtdn_oidc_unavailable");
    }
    if (!isObject(body) || !Array.isArray(body.keys)) fail("rtdn_oidc_unavailable");
    const keys = body.keys.filter(isGoogleJwk);
    if (keys.length === 0) fail("rtdn_oidc_unavailable");

    jwksCache = {
      keys,
      fetchedAt: nowMillis,
      expiresAt: nowMillis + cacheMaxAgeMillis(response.headers.get("cache-control")),
    };
    negativeKidCache.clear();
    return keys;
  })();
  jwksFetchInFlight = request;
  try {
    return await request;
  } finally {
    if (jwksFetchInFlight === request) jwksFetchInFlight = null;
  }
}

function pruneNegativeKids(nowMillis: number): void {
  for (const [kid, expiresAt] of negativeKidCache) {
    if (expiresAt <= nowMillis) negativeKidCache.delete(kid);
  }
}

function rememberMissingKid(kid: string, nowMillis: number, refreshAllowedAt: number): void {
  pruneNegativeKids(nowMillis);
  if (refreshAllowedAt <= nowMillis) return;
  negativeKidCache.delete(kid);
  negativeKidCache.set(kid, refreshAllowedAt);
  while (negativeKidCache.size > MAX_NEGATIVE_KIDS) {
    const oldest = negativeKidCache.keys().next().value;
    if (typeof oldest !== "string") break;
    negativeKidCache.delete(oldest);
  }
}

function rejectMissingKid(kid: string, nowMillis: number): never {
  const refreshAllowedAt = (jwksCache?.fetchedAt ?? nowMillis) + JWKS_REFRESH_COOLDOWN_MS;
  rememberMissingKid(kid, nowMillis, refreshAllowedAt);
  fail();
}

async function resolveGoogleJwk(
  kid: string,
  fetchImpl: FetchImplementation,
  nowMillis: number,
): Promise<GoogleJwk> {
  if (!jwksCache || jwksCache.expiresAt <= nowMillis) {
    const fetched = await fetchGoogleJwks(fetchImpl, nowMillis);
    return fetched.find((key) => key.kid === kid) ?? rejectMissingKid(kid, nowMillis);
  }

  const cached = jwksCache.keys.find((key) => key.kid === kid);
  if (cached) return cached;

  pruneNegativeKids(nowMillis);
  if ((negativeKidCache.get(kid) ?? 0) > nowMillis) fail();
  if (jwksCache.fetchedAt + JWKS_REFRESH_COOLDOWN_MS > nowMillis) {
    rejectMissingKid(kid, nowMillis);
  }

  const refreshed = await fetchGoogleJwks(fetchImpl, nowMillis);
  return refreshed.find((key) => key.kid === kid) ?? rejectMissingKid(kid, nowMillis);
}

function resolveNow(now: Date | undefined): { millis: number; seconds: number } {
  const millis = (now ?? new Date()).getTime();
  if (!Number.isFinite(millis)) fail();
  return { millis, seconds: Math.floor(millis / 1000) };
}

export async function verifyGoogleOidcJwt(
  token: string,
  options: {
    audience: string;
    serviceAccountEmail: string;
    fetchImpl?: FetchImplementation;
    now?: Date;
  },
): Promise<GoogleOidcClaims> {
  if (!options.audience?.trim() || !options.serviceAccountEmail?.trim()) {
    fail("rtdn_not_configured");
  }
  if (typeof token !== "string") fail();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) fail();

  const header = decodeJwtJson(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) fail();

  const claims = decodeJwtJson(parts[1]);
  const { millis: nowMillis, seconds: nowSeconds } = resolveNow(options.now);
  if (!GOOGLE_ISSUERS.has(String(claims.iss ?? ""))) fail();
  if (typeof claims.aud !== "string" || claims.aud !== options.audience) fail();
  if (typeof claims.email !== "string" || claims.email !== options.serviceAccountEmail) fail();
  if (claims.email_verified !== true) fail();
  if (!Number.isInteger(claims.exp) || (claims.exp as number) <= nowSeconds) fail();
  if (!Number.isInteger(claims.iat) || (claims.iat as number) > nowSeconds + 60) fail();

  const jwk = await resolveGoogleJwk(header.kid, options.fetchImpl ?? fetch, nowMillis);
  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    fail();
  }
  if (!verified) fail();

  return claims as GoogleOidcClaims;
}
