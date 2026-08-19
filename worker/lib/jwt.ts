// ES256 JWT 발급/검증. GoTrue를 대체하는 커스텀 토큰.
// 키는 JWK(JSON 문자열)로 Secret/.dev.vars에 저장(멀티라인 PEM 회피).
import { SignJWT, jwtVerify, importJWK, type JWTPayload } from "jose";
import type { Env, AuthUser } from "../types";
import { recordFamilyDailySignal } from "./familyLifecycleFunnel.ts";

const ALG = "ES256";

export interface AccessClaims extends JWTPayload {
  sub: string;
  role: AuthUser["role"];
  family_id: string | null;
  is_anonymous: boolean;
  device_id?: string;
}

export interface RealtimeTicketClaims extends JWTPayload {
  purpose: "realtime_connect";
  target_kind: "family" | "teacher";
  target_hash: string;
  jti: string;
  exp: number;
  iat: number;
}

async function privateKey(env: Env) {
  return importJWK(JSON.parse(env.JWT_PRIVATE_KEY), ALG);
}
async function publicKey(env: Env) {
  return importJWK(JSON.parse(env.JWT_PUBLIC_KEY), ALG);
}

export async function signAccessToken(
  env: Env,
  user: AuthUser,
  expiresIn = "1h",
): Promise<string> {
  const token = await new SignJWT({
    role: user.role,
    family_id: user.family_id,
    is_anonymous: user.is_anonymous,
    ...(user.device_id ? { device_id: user.device_id } : {}),
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(await privateKey(env));
  if (user.role === "parent" && user.family_id) {
    await recordFamilyDailySignal(env, {
      familyId: user.family_id,
      signal: "parent_active",
    });
  }
  return token;
}

export async function verifyAccessToken(
  env: Env,
  token: string,
): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, await publicKey(env), {
      algorithms: [ALG],
      requiredClaims: ["sub", "exp", "iat"],
    });
    const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
    const familyIdValid = payload.family_id === null
      || (typeof payload.family_id === "string"
        && payload.family_id.trim() === payload.family_id
        && payload.family_id.length > 0
        && payload.family_id.length <= 128);
    const deviceIdValid = payload.device_id === undefined
      || (typeof payload.device_id === "string"
        && /^[A-Za-z0-9-]{1,64}$/.test(payload.device_id));
    if (
      payload.purpose !== undefined
      || subject.length === 0
      || subject !== payload.sub
      || subject.length > 256
      || !["parent", "child", "teacher", "anonymous"].includes(String(payload.role))
      || !familyIdValid
      || !deviceIdValid
      || typeof payload.is_anonymous !== "boolean"
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || Number(payload.exp) <= Number(payload.iat)
    ) {
      throw new Error("invalid_access_token");
    }
    return payload as AccessClaims;
  } catch {
    throw new Error("invalid_access_token");
  }
}


export async function signRealtimeTicket(
  env: Env,
  input: {
    ticketId: string;
    targetKind: "family" | "teacher";
    targetHash: string;
    issuedAt: number;
    expiresAt: number;
  },
): Promise<string> {
  return new SignJWT({
    purpose: "realtime_connect",
    target_kind: input.targetKind,
    target_hash: input.targetHash,
  })
    .setProtectedHeader({ alg: ALG })
    .setJti(input.ticketId)
    .setIssuedAt(input.issuedAt)
    .setExpirationTime(input.expiresAt)
    .sign(await privateKey(env));
}

export async function verifyRealtimeTicket(
  env: Env,
  token: string,
): Promise<RealtimeTicketClaims> {
  try {
    const { payload } = await jwtVerify(token, await publicKey(env), {
      algorithms: [ALG],
      requiredClaims: ["exp", "iat", "jti"],
    });
    if (
      payload.purpose !== "realtime_connect"
      || (payload.target_kind !== "family" && payload.target_kind !== "teacher")
      || typeof payload.target_hash !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(payload.target_hash)
      || typeof payload.jti !== "string"
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || Number(payload.exp) <= Number(payload.iat)
      || Number(payload.exp) - Number(payload.iat) > 45
    ) {
      throw new Error("invalid_realtime_ticket");
    }
    return payload as RealtimeTicketClaims;
  } catch {
    throw new Error("invalid_realtime_ticket");
  }
}
