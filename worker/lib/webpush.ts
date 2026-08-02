// VAPID Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) — Web Crypto 네이티브 재구현.
//
// ⚠️ 불확실성(보고에 명시): 원본은 `web-push` npm 을 썼으나 worker 에는 미설치라
// import 불가 → Web Crypto 로 직접 구현했다. 아래는 RFC 8291/8188/8292 표준을 따르나
// 실제 push 서비스(FCM/Mozilla) 대상 종단검증은 하지 않았다. 실기기 푸시는 FCM 네이티브
// 경로라 이 모듈이 미완성이어도 영향 없음. 모든 실패는 throw 하지 않고 "error" 로 흡수해
// FCM 경로/응답을 막지 않는다(원본 동작 보존).
import { SignJWT, importJWK } from "jose";
import type { PushEnv } from "./pushEnv";
import { writeOperationalLog } from "./safeOperationalLog.ts";

export type WebPushResult = "sent" | "expired" | "error";

const VAPID_SUBJECT = "mailto:hyeni-calendar@noreply.com";
const WEB_PUSH_MAX_TTL_SECONDS = 28 * 24 * 60 * 60;
const WEB_PUSH_DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function parseExpiryMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim()
    .replace(" ", "T")
    .replace(/\+00$/, "+00:00");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Push service가 오래 보관한 알림을 뒤늦게 표시하지 않도록 payload 의미와 같은
 * TTL을 계산한다. 일정처럼 정확한 만료가 있는 payload는 data.expiresAt을 정본으로
 * 쓰고, 없으면 유형별로 짧게 제한한다.
 */
export function resolveWebPushTtlSeconds(payloadJson: string, nowMs = Date.now()): number {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const data = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : {};
    const expiresAtMs = parseExpiryMs(data.expiresAt ?? payload.expiresAt);
    if (expiresAtMs != null) {
      return Math.max(0, Math.min(
        WEB_PUSH_MAX_TTL_SECONDS,
        Math.floor((expiresAtMs - nowMs) / 1000),
      ));
    }

    const type = String(data.type ?? payload.type ?? "").trim().toLowerCase();
    if (["sos", "emergency", "parent_alert", "kkuk"].includes(type)) return 5 * 60;
    if (type === "new_memo") return 2 * 60;
    if (["request_location", "request_device_status", "remote_listen", "remote_listen_stop"].includes(type)) {
      return 2 * 60;
    }
  } catch {
    // 파싱 실패도 28일 보관으로 되돌리지 않고 안전한 기본 TTL로 제한한다.
  }
  return WEB_PUSH_DEFAULT_TTL_SECONDS;
}

export function isWebPushConfigured(env: PushEnv): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// VAPID 서명키(env 의 raw base64url private d) → ES256 JWK. 공개키에서 x,y 를 분해.
async function importVapidSigningKey(env: PushEnv) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY || ""); // 0x04 || x(32) || y(32)
  const priv = b64urlToBytes(env.VAPID_PRIVATE_KEY || ""); // d(32)
  if (pub.length !== 65 || priv.length !== 32) {
    throw new Error("invalid VAPID key length");
  }
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const d = bytesToB64url(priv);
  return importJWK({ kty: "EC", crv: "P-256", x, y, d, ext: true }, "ES256");
}

async function buildVapidAuthHeader(env: PushEnv, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const key = await importVapidSigningKey(env);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(aud)
    .setSubject(VAPID_SUBJECT)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
    .sign(key);
  const pubB64url = (env.VAPID_PUBLIC_KEY || "").replace(/=+$/, "");
  return `vapid t=${jwt}, k=${pubB64url}`;
}

// RFC 8291 aes128gcm 본문 빌드: salt(16) || rs(4) || idlen(1)=65 || as_public(65) || ciphertext.
async function encryptAes128Gcm(
  payload: Uint8Array,
  uaPublicRaw: Uint8Array, // p256dh (65)
  authSecret: Uint8Array, // auth (16)
): Promise<Uint8Array> {
  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicRaw as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const asKeyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const asPublicRaw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", asKeyPair.publicKey)) as ArrayBuffer,
  );

  // workers-types 의 ECDH deriveBits 파라미터 타입과 표준 `public` 키 표기가 어긋나
  // (런타임은 `public` 필요) algorithm 객체를 any 로 캐스트.
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey } as any,
    asKeyPair.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedBits);

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0"||ua||as, 32)
  const keyInfo = concatBytes(utf8("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // 단일 레코드: plaintext || 0x02(마지막 레코드 패딩 구분자).
  const record = concatBytes(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 },
    aesKey,
    record as BufferSource,
  );
  const ciphertext = new Uint8Array(ctBuf);

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false); // record size
  const idlen = new Uint8Array([asPublicRaw.length]); // 65

  return concatBytes(salt, rs, idlen, asPublicRaw, ciphertext);
}

type WebPushSubscription = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

// 단건 web push. subscription = push_subscriptions.subscription(파싱된 객체).
export async function sendWebPush(
  env: PushEnv,
  subscription: unknown,
  payloadJson: string,
  signal?: AbortSignal,
): Promise<WebPushResult> {
  if (!isWebPushConfigured(env)) return "error";
  if (signal?.aborted) return "error";
  try {
    const sub = (subscription || {}) as WebPushSubscription;
    const endpoint = String(sub.endpoint || "");
    const p256dh = sub.keys?.p256dh ? b64urlToBytes(sub.keys.p256dh) : null;
    const auth = sub.keys?.auth ? b64urlToBytes(sub.keys.auth) : null;
    if (!endpoint || !p256dh || !auth) return "error";

    const body = await encryptAes128Gcm(utf8(payloadJson), p256dh, auth);
    const authHeader = await buildVapidAuthHeader(env, endpoint);
    const ttlSeconds = resolveWebPushTtlSeconds(payloadJson);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttlSeconds),
      },
      body: body as BodyInit,
      signal,
    });

    if (res.status === 201 || res.status === 200) return "sent";
    if (res.status === 404 || res.status === 410) return "expired";
    writeOperationalLog("error", "web_push_send_failed", {
      provider: "web_push",
      status: res.status,
    });
    return "error";
  } catch (err) {
    if (signal?.aborted) return "error";
    writeOperationalLog("error", "web_push_send_network_failed", { provider: "web_push" });
    return "error";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// DB-H4/H5: transient 실패 백오프 재시도. 410/404 = "expired" 종료.
export async function sendWebPushWithRetry(
  env: PushEnv,
  subscription: unknown,
  payloadJson: string,
  maxAttempts = 3,
  signal?: AbortSignal,
): Promise<WebPushResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await sendWebPush(env, subscription, payloadJson, signal);
    if (outcome === "sent" || outcome === "expired") return outcome;
    if (attempt === maxAttempts) return "error";
    if (!(await sleep(attempt * 500, signal))) return "error";
  }
  return "error";
}
