// FCM HTTP v1 발송 헬퍼. supabase/functions/push-notify/index.ts 의 FCM 경로 직역.
//
// 변환점:
//  · 서비스계정 JWT(RS256) 서명을 원본의 crypto.subtle.importKey(pkcs8) 대신
//    jose importPKCS8 + SignJWT(setProtectedHeader{alg:'RS256'}) 로 한다(Web Crypto 네이티브 RS256).
//  · OAuth2 access token 은 모듈 전역 캐시(만료 60s 전까지 재사용) — 원본 패턴 보존.
import { importPKCS8, SignJWT } from "jose";
import type { PushEnv } from "./pushEnv";
import { writeOperationalLog } from "./safeOperationalLog";

interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

// 서비스계정 JSON(우선) 또는 개별 env 폴백에서 project_id/client_email/private_key 추출.
function resolveFcmConfig(env: PushEnv): FcmConfig | null {
  let sa: { project_id?: string; client_email?: string; private_key?: string } | null = null;
  const json = env.FCM_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (json) {
    try {
      sa = JSON.parse(json);
    } catch {
      writeOperationalLog("error", "fcm_service_account_json_invalid", { provider: "fcm" });
    }
  }

  const projectId = env.FCM_PROJECT_ID || sa?.project_id || "";
  const clientEmail = env.FCM_CLIENT_EMAIL || sa?.client_email || "";

  let privateKey = "";
  if (sa?.private_key) {
    privateKey = sa.private_key.replace(/\\n/g, "\n");
  } else if (env.FCM_PRIVATE_KEY) {
    privateKey = env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else if (env.FCM_PRIVATE_KEY_B64) {
    try {
      privateKey = new TextDecoder().decode(
        Uint8Array.from(atob(env.FCM_PRIVATE_KEY_B64), (c) => c.charCodeAt(0)),
      );
    } catch {
      privateKey = "";
    }
  }

  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

// ── OAuth2 access token 캐시(모듈 전역; isolate 수명 동안 재사용) ──
let fcmAccessToken: string | null = null;
let fcmTokenExpiry = 0;

async function getFcmAccessToken(env: PushEnv, signal?: AbortSignal): Promise<string | null> {
  const cfg = resolveFcmConfig(env);
  if (!cfg) return null;

  if (fcmAccessToken && Date.now() < fcmTokenExpiry - 60_000) {
    return fcmAccessToken;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const key = await importPKCS8(cfg.privateKey, "RS256");
    const jwt = await new SignJWT({
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(cfg.clientEmail)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      signal,
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
    if (!tokenData.access_token) {
      writeOperationalLog("error", "fcm_token_exchange_failed", {
        provider: "fcm",
        status: tokenRes.status,
      });
      return null;
    }

    fcmAccessToken = tokenData.access_token;
    fcmTokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
    return fcmAccessToken;
  } catch {
    if (signal?.aborted) return null;
    writeOperationalLog("error", "fcm_auth_failed", { provider: "fcm" });
    return null;
  }
}

export type FcmSendResult = "sent" | "expired" | "error";

// Return: "sent" | "expired" | "error"
export async function sendFcmNotification(
  env: PushEnv,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
  signal?: AbortSignal,
): Promise<FcmSendResult> {
  const cfg = resolveFcmConfig(env);
  if (!cfg) return "error";
  if (signal?.aborted) return "error";
  const accessToken = await getFcmAccessToken(env, signal);
  if (!accessToken) return "error";

  try {
    const isRemoteListen = data.type === "remote_listen";
    const isLocationRefresh = data.type === "request_location";
    const stringData = Object.fromEntries(
      Object.entries({ title, body, type: data.type || "schedule", ...data }).map(([k, v]) => [k, String(v)]),
    );

    const androidConfig: Record<string, unknown> = {
      priority: "HIGH",
      ttl: isRemoteListen ? "300s" : (isLocationRefresh ? "120s" : "120s"),
      // 앱 수신 서비스는 CE 세션을 사용해 directBootAware=false다. 잠금 해제 전
      // 전달을 강제하지 않고 FCM 보관 + 서버 pending unlock 복구 경로를 사용한다.
      direct_boot_ok: false,
    };
    const message: Record<string, unknown> = {
      message: {
        token,
        data: stringData,
        android: androidConfig,
      },
    };

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
        signal,
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      writeOperationalLog("error", "fcm_send_failed", {
        provider: "fcm",
        status: res.status,
      });
      if (res.status === 404 || res.status === 410 || errBody.includes("UNREGISTERED")) {
        return "expired";
      }
      return "error";
    }

    return "sent";
  } catch {
    if (signal?.aborted) return "error";
    writeOperationalLog("error", "fcm_send_network_failed", { provider: "fcm" });
    return "error";
  }
}

// Data-only FCM (force_ring 전용) — TTL/action 커스텀, notification 없음.
export async function sendFcmDataOnly(
  env: PushEnv,
  token: string,
  payload: { data: Record<string, string>; android: { ttl: string } },
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const cfg = resolveFcmConfig(env);
  if (!cfg) return { success: false, error: "fcm_auth_failed" };
  const accessToken = await getFcmAccessToken(env);
  if (!accessToken) return { success: false, error: "fcm_auth_failed" };

  const message = {
    message: {
      token,
      data: Object.fromEntries(Object.entries(payload.data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: "HIGH",
        ttl: payload.android.ttl,
        direct_boot_ok: false,
      },
    },
  };

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      },
    );
    if (!res.ok) {
      return { success: false, error: `fcm_${res.status}` };
    }
    const json = (await res.json()) as { name?: string };
    return { success: true, messageId: json.name };
  } catch {
    return { success: false, error: "fcm_network_error" };
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

// DB-H4: transient "error" 만 지수 백오프 재시도. "sent"/"expired" 는 즉시 종료.
export async function sendFcmWithRetry(
  env: PushEnv,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
  maxAttempts = 3,
  signal?: AbortSignal,
): Promise<FcmSendResult> {
  let result = await sendFcmNotification(env, token, title, body, data, signal);
  for (let attempt = 1; attempt < maxAttempts && result === "error"; attempt++) {
    if (!(await sleep(attempt * 500, signal))) return "error";
    result = await sendFcmNotification(env, token, title, body, data, signal);
  }
  return result;
}

export function isFcmConfigured(env: PushEnv): boolean {
  return resolveFcmConfig(env) !== null;
}
