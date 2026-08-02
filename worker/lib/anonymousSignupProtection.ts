const ANONYMOUS_SIGNUP_IP_HOURLY_LIMIT = 30;
const ANONYMOUS_SIGNUP_DEVICE_HOURLY_LIMIT = 5;
const ANONYMOUS_SIGNUP_UNKNOWN_IP_HOURLY_LIMIT = 3;
const ANONYMOUS_ORPHAN_TTL_MS = 48 * 60 * 60 * 1000;
const ANONYMOUS_CLEANUP_BATCH_SIZE = 40;
const HMAC_KEY_DOMAIN = "hyeni:anonymous-signup-rate-limit:v1:key";

interface AnonymousSignupRateLimitClaim {
  scopeType: "ip" | "device";
  scopeHash: string;
  windowKey: string;
}

export type AnonymousSignupProtectionResult =
  | { status: "claimed"; claims: AnonymousSignupRateLimitClaim[] }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

function normalizeIpv4(value: string): string | null {
  const parts = value.split(".");
  if (
    parts.length !== 4
    || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return null;
  }
  return parts.map((part) => String(Number(part))).join(".");
}

function parseIpv6Hextets(value: string): number[] | null {
  let candidate = value;
  if (candidate.includes(".")) {
    const lastColon = candidate.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = normalizeIpv4(candidate.slice(lastColon + 1));
    if (!ipv4) return null;
    const octets = ipv4.split(".").map(Number);
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    candidate = `${candidate.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }
  if (!candidate || !/^[0-9a-f:]+$/.test(candidate)) return null;

  const compressedAt = candidate.indexOf("::");
  if (compressedAt !== candidate.lastIndexOf("::")) return null;
  let rawParts: string[];
  if (compressedAt >= 0) {
    const leftText = candidate.slice(0, compressedAt);
    const rightText = candidate.slice(compressedAt + 2);
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    if (left.some((part) => !part) || right.some((part) => !part)) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    rawParts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  } else {
    rawParts = candidate.split(":");
    if (rawParts.length !== 8 || rawParts.some((part) => !part)) return null;
  }
  if (
    rawParts.length !== 8
    || !rawParts.every((part) => /^[0-9a-f]{1,4}$/.test(part))
  ) {
    return null;
  }
  return rawParts.map((part) => Number.parseInt(part, 16));
}

function normalizeTrustedCfIp(value: string | null | undefined): string | null {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!candidate || candidate.length > 64 || /[\s,%]/.test(candidate)) return null;

  const ipv4 = normalizeIpv4(candidate);
  if (ipv4) return `v4:${ipv4}`;

  const hextets = parseIpv6Hextets(candidate);
  if (!hextets) return null;
  // IPv4-mapped IPv6는 실제 내장 IPv4 /32로 묶는다.
  if (
    hextets.slice(0, 5).every((part) => part === 0)
    && hextets[5] === 0xffff
  ) {
    return `v4:${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`;
  }
  // IPv6 privacy extension으로 host 부분만 바꿔도 새 가입 버킷을 만들지 못하게 /64로 집계한다.
  return `v6:${hextets
    .slice(0, 4)
    .map((part) => part.toString(16).padStart(4, "0"))
    .join(":")}/64`;
}

function utcHourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

function secondsUntilNextUtcHour(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createRateLimitHmacKey(keyMaterial: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const derived = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${HMAC_KEY_DOMAIN}\0${keyMaterial}`),
  );
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacScope(
  key: CryptoKey,
  scopeType: "ip" | "device",
  value: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`hyeni:anonymous-signup-rate-limit:v1:${scopeType}\0${value}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

async function claimRateLimitScope(
  db: D1Database,
  claim: AnonymousSignupRateLimitClaim,
  limit: number,
  now: Date,
): Promise<"claimed" | "limited" | "unavailable"> {
  try {
    const result = await db
      .prepare(
        `INSERT INTO anonymous_signup_rate_limits
           (scope_type, scope_hash, window_key, request_count, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(scope_type, scope_hash, window_key) DO UPDATE SET
           request_count = request_count + 1,
           updated_at = excluded.updated_at
         WHERE request_count < ?`,
      )
      .bind(
        claim.scopeType,
        claim.scopeHash,
        claim.windowKey,
        now.toISOString(),
        limit,
      )
      .run();
    return Number(result.meta?.changes ?? 0) === 1 ? "claimed" : "limited";
  } catch {
    // IP, device id, HMAC 및 key material은 예외 로그에도 포함하지 않는다.
    console.error("[anonymous-signup] rate-limit claim unavailable");
    return "unavailable";
  }
}

async function releaseRateLimitClaim(
  db: D1Database,
  claim: AnonymousSignupRateLimitClaim,
  now: Date,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE anonymous_signup_rate_limits
            SET request_count = MAX(request_count - 1, 0),
                updated_at = ?
          WHERE scope_type = ? AND scope_hash = ? AND window_key = ?`,
      )
      .bind(now.toISOString(), claim.scopeType, claim.scopeHash, claim.windowKey),
    db
      .prepare(
        `DELETE FROM anonymous_signup_rate_limits
          WHERE scope_type = ? AND scope_hash = ? AND window_key = ? AND request_count = 0`,
      )
      .bind(claim.scopeType, claim.scopeHash, claim.windowKey),
  ]);
}

/** 부분 claim 또는 계정 발급 실패 시 이미 소비한 버킷만 되돌린다. */
export async function releaseAnonymousSignupProtectionClaims(
  db: D1Database,
  claims: readonly AnonymousSignupRateLimitClaim[],
  now = new Date(),
): Promise<void> {
  let failed = false;
  for (const claim of [...claims].reverse()) {
    try {
      await releaseRateLimitClaim(db, claim, now);
    } catch {
      failed = true;
    }
  }
  if (failed) {
    // rollback 실패는 제한을 느슨하게 만들지 않고 보수적으로 사용량을 남긴다.
    console.error("[anonymous-signup] rate-limit rollback unavailable");
  }
}

/**
 * Cloudflare가 제공한 IP와 선택적 설치 id를 서로 독립된 HMAC 버킷으로 원자 claim한다.
 * 전용 secret이 없으면 이미 운영 필수인 JWT private key를 도메인 분리해 사용한다.
 */
export async function claimAnonymousSignupProtection(
  db: D1Database,
  input: {
    cfConnectingIp: string | null | undefined;
    deviceInstallId: string | null;
    dedicatedSecret?: string;
    jwtPrivateKey?: string;
    now?: Date;
  },
): Promise<AnonymousSignupProtectionResult> {
  const dedicatedSecret = String(input.dedicatedSecret ?? "").trim();
  const keyMaterial = dedicatedSecret.length >= 32
    ? dedicatedSecret
    : String(input.jwtPrivateKey ?? "").trim();
  if (!keyMaterial) return { status: "unavailable" };

  const now = input.now ?? new Date();
  const windowKey = utcHourKey(now);
  const normalizedIp = normalizeTrustedCfIp(input.cfConnectingIp);
  const deviceInstallId = String(input.deviceInstallId ?? "").trim();
  const claims: AnonymousSignupRateLimitClaim[] = [];
  try {
    const key = await createRateLimitHmacKey(keyMaterial);
    const ipClaim: AnonymousSignupRateLimitClaim = {
      scopeType: "ip",
      scopeHash: await hmacScope(key, "ip", normalizedIp ?? "unknown"),
      windowKey,
    };
    const ipResult = await claimRateLimitScope(
      db,
      ipClaim,
      normalizedIp ? ANONYMOUS_SIGNUP_IP_HOURLY_LIMIT : ANONYMOUS_SIGNUP_UNKNOWN_IP_HOURLY_LIMIT,
      now,
    );
    if (ipResult === "limited") {
      return { status: "limited", retryAfterSeconds: secondsUntilNextUtcHour(now) };
    }
    if (ipResult === "unavailable") return { status: "unavailable" };

    claims.push(ipClaim);
    if (!deviceInstallId) return { status: "claimed", claims };

    const deviceClaim: AnonymousSignupRateLimitClaim = {
      scopeType: "device",
      scopeHash: await hmacScope(key, "device", deviceInstallId),
      windowKey,
    };
    const deviceResult = await claimRateLimitScope(
      db,
      deviceClaim,
      ANONYMOUS_SIGNUP_DEVICE_HOURLY_LIMIT,
      now,
    );
    if (deviceResult !== "claimed") {
      await releaseAnonymousSignupProtectionClaims(db, claims, now);
      return deviceResult === "limited"
        ? { status: "limited", retryAfterSeconds: secondsUntilNextUtcHour(now) }
        : { status: "unavailable" };
    }
    claims.push(deviceClaim);
    return { status: "claimed", claims };
  } catch {
    if (claims.length > 0) {
      await releaseAnonymousSignupProtectionClaims(db, claims, now);
    }
    console.error("[anonymous-signup] protection unavailable");
    return { status: "unavailable" };
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

/** 48시간 이상 가족에 연결되지 않은 익명 계정과 오래된 rate-limit 버킷을 정리한다. */
export async function cleanupAnonymousSignupProtection(
  db: D1Database,
  now = new Date(),
): Promise<{ anonymousUsersRemoved: number; rateLimitRowsRemoved: number }> {
  const cutoff = new Date(now.getTime() - ANONYMOUS_ORPHAN_TTL_MS).toISOString();
  const cutoffNorm = cutoff.slice(0, 19).replace("T", " ");
  let candidates: string[] = [];
  try {
    const { results } = await db
      .prepare(
        `SELECT u.id
          FROM users u
          WHERE u.is_anonymous = 1
            AND substr(replace(COALESCE(u.created_at,''),'T',' '),1,19) < ?
            AND NOT EXISTS (SELECT 1 FROM family_members fm WHERE fm.user_id = u.id)
          ORDER BY substr(replace(COALESCE(u.created_at,''),'T',' '),1,19) ASC, u.id ASC
          LIMIT ?`,
      )
      .bind(cutoffNorm, ANONYMOUS_CLEANUP_BATCH_SIZE)
      .all<{ id: string }>();
    candidates = (results ?? []).map((row) => String(row.id ?? "").trim()).filter(Boolean);
  } catch {
    console.error("[anonymous-signup] orphan cleanup unavailable");
    return { anonymousUsersRemoved: 0, rateLimitRowsRemoved: 0 };
  }

  try {
    const statements: D1PreparedStatement[] = [];
    let userDeleteIndex = -1;
    if (candidates.length > 0) {
      const ph = placeholders(candidates.length);
      const eligible = `SELECT u.id
           FROM users u
         WHERE u.id IN (${ph})
           AND u.is_anonymous = 1
           AND substr(replace(COALESCE(u.created_at,''),'T',' '),1,19) < ?
           AND NOT EXISTS (SELECT 1 FROM family_members fm WHERE fm.user_id = u.id)`;
      const bindings = [...candidates, cutoffNorm];
      for (const table of [
        "refresh_tokens",
        "auth_identities",
        "user_profiles",
        "fcm_tokens",
        "push_subscriptions",
        "oauth_state_transactions",
        "storage_upload_daily_usage",
        "pair_attempts",
      ]) {
        statements.push(
          db.prepare(`DELETE FROM ${table} WHERE user_id IN (${eligible})`).bind(...bindings),
        );
      }
      userDeleteIndex = statements.length;
      statements.push(db.prepare(`DELETE FROM users WHERE id IN (${eligible})`).bind(...bindings));
    }
    const rateDeleteIndex = statements.length;
    statements.push(
      db
        .prepare(
          `DELETE FROM anonymous_signup_rate_limits
            WHERE substr(replace(COALESCE(updated_at,''),'T',' '),1,19) < ?`,
        )
        .bind(cutoffNorm),
    );

    const results = await db.batch(statements);
    return {
      anonymousUsersRemoved: userDeleteIndex >= 0
        ? Number(results[userDeleteIndex]?.meta?.changes ?? 0)
        : 0,
      rateLimitRowsRemoved: Number(results[rateDeleteIndex]?.meta?.changes ?? 0),
    };
  } catch {
    console.error("[anonymous-signup] cleanup batch unavailable");
    return { anonymousUsersRemoved: 0, rateLimitRowsRemoved: 0 };
  }
}
