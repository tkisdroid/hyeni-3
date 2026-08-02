// 웹 푸시 구독 upsert/비활성화. Supabase push_subscriptions 테이블 직역.
// 원본: src/lib/pushNotifications.js — upsert(onConflict user_id,endpoint)/delete(endpoint).
// 웹 전용 경로(네이티브는 FCM). subscription 은 D1 에 TEXT(JSON 문자열)로 저장 —
// push-notify 가 parseJson 으로 되돌려 sendWebPush 에 넘기는 형태와 일치시킨다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { isPushSubscriptionRegisteredForAccount } from "../lib/pushSubscriptionStatus";
import {
  isPushSubscriptionRegistrationCurrent,
  isNotificationEndpointSchemaUnavailable,
  unregisterOwnedPushSubscription,
  upsertPushSubscriptionOwnership,
} from "../lib/notificationEndpointOwnership";

export { isPushSubscriptionRegisteredForAccount } from "../lib/pushSubscriptionStatus";

const pushSubscriptions = new Hono<{ Bindings: Env; Variables: Vars }>();

interface BrowserPushSubscription {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
}

function parseSubscription(value: unknown): BrowserPushSubscription | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as BrowserPushSubscription;
  } catch {
    return null;
  }
}

// 브라우저는 공개키만으로 구독할 수 있어도 서버 private key가 없으면 실제 전송이
// 불가능하다. 두 키가 모두 있을 때만 configured=true로 안내한다.
pushSubscriptions.get("/vapid-public-key", requireAuth, (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const configured = publicKey.length > 0 && !!c.env.VAPID_PRIVATE_KEY?.trim();
  return c.json({ configured, publicKey: configured ? publicKey : null });
});

// GET /api/push-subscriptions/status?endpoint=...
// 현재 브라우저 endpoint가 현재 JWT 사용자와 현재 정본 가족에 함께 귀속됐을 때만
// true다. 타 사용자/과거 가족 소유 여부는 구분하지 않아 계정 정보를 노출하지 않는다.
pushSubscriptions.get("/status", requireAuth, async (c) => {
  const user = c.get("user");
  const endpoint = c.req.query("endpoint")?.trim() ?? "";
  const registrationInstanceId = c.req.query("registration_instance_id")?.trim() ?? "";
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return c.json({ error: "invalid_endpoint" }, 400);
  }
  if (endpointUrl.protocol !== "https:" || endpoint.length > 2048) {
    return c.json({ error: "invalid_endpoint" }, 400);
  }
  const canonical = await resolveCanonicalFamilyMembership(
    c.env.DB,
    user.sub,
    user.family_id ?? null,
  );
  let registered = false;
  if (canonical) {
    if (registrationInstanceId) {
      try {
        registered = await isPushSubscriptionRegistrationCurrent(c.env.DB, {
          endpoint,
          userId: user.sub,
          familyId: canonical.familyId,
          registrationInstanceId,
        });
      } catch (error) {
        if (isNotificationEndpointSchemaUnavailable(error)) {
          return c.json({ error: "notification_endpoint_schema_unavailable" }, 503);
        }
        throw error;
      }
    } else {
      // migration 전 구버전 웹 클라이언트의 읽기 상태 확인만 호환한다.
      // 등록/해제 mutation은 registration_instance_id 없이 절대 열지 않는다.
      registered = await isPushSubscriptionRegisteredForAccount(c.env.DB, {
        endpoint,
        userId: user.sub,
        familyId: canonical.familyId,
      });
    }
  }
  return c.json({ registered });
});

// POST /api/push-subscriptions — endpoint UNIQUE 기반 원자 소유권 upsert.
// user_id 는 호출자(sub)로 고정. family_id 는 NOT NULL 이므로 필수 + 소속 검증.
// body:{ family_id, endpoint, subscription }
pushSubscriptions.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();

  const familyId = b.family_id ? String(b.family_id) : "";
  const endpoint = b.endpoint ? String(b.endpoint).trim() : "";
  const registrationInstanceId = b.registration_instance_id
    ? String(b.registration_instance_id).trim()
    : "";
  if (!familyId || !endpoint || !registrationInstanceId || b.subscription == null) {
    return c.json({ error: "bad_request" }, 400);
  }
  const canonical = await resolveCanonicalFamilyMembership(c.env.DB, user.sub, user.family_id ?? null);
  if (!canonical || canonical.familyId !== familyId) {
    return c.json({ error: "forbidden" }, 403);
  }

  const subscription = parseSubscription(b.subscription);
  const subscriptionEndpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
  const p256dh = typeof subscription?.keys?.p256dh === "string" ? subscription.keys.p256dh : "";
  const auth = typeof subscription?.keys?.auth === "string" ? subscription.keys.auth : "";
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return c.json({ error: "invalid_subscription" }, 400);
  }
  if (endpointUrl.protocol !== "https:"
      || endpoint.length > 2048
      || subscriptionEndpoint !== endpoint
      || !p256dh
      || !auth) {
    return c.json({ error: "invalid_subscription" }, 400);
  }
  const subText = JSON.stringify(subscription);
  if (subText.length > 16_384) return c.json({ error: "subscription_too_large" }, 413);

  let owned: boolean;
  try {
    owned = await upsertPushSubscriptionOwnership(c.env.DB, {
      id: crypto.randomUUID(),
      userId: user.sub,
      familyId,
      endpoint,
      subscription: subText,
      registrationInstanceId,
      now: pgNow(),
    });
  } catch (error) {
    if (isNotificationEndpointSchemaUnavailable(error)) {
      return c.json({ error: "notification_endpoint_schema_unavailable" }, 503);
    }
    throw error;
  }
  if (!owned) return c.json({ error: "endpoint_owned_by_other_user" }, 409);

  return c.json({ ok: true });
});

// DELETE /api/push-subscriptions?endpoint=... — endpoint+본인+등록 세션 스코프 비활성화.
// user_id와 registration_instance_id를 함께 확인해 타인·새 로그인 행 변경을 차단한다.
// endpoint 는 기기/브라우저별 고유라 같은 사용자의 다른 기기 구독은 영향 없음.
pushSubscriptions.delete("/", requireAuth, async (c) => {
  const user = c.get("user");
  const endpoint = c.req.query("endpoint")?.trim() ?? "";
  if (!endpoint) return c.json({ ok: true });
  const registrationInstanceId = c.req.query("registration_instance_id")?.trim() ?? "";
  if (!registrationInstanceId) return c.json({ error: "bad_request" }, 400);
  try {
    await unregisterOwnedPushSubscription(c.env.DB, {
      endpoint,
      userId: user.sub,
      registrationInstanceId,
      now: pgNow(),
    });
  } catch (error) {
    if (isNotificationEndpointSchemaUnavailable(error)) {
      return c.json({ error: "notification_endpoint_schema_unavailable" }, 503);
    }
    throw error;
  }
  return c.json({ ok: true });
});

export default pushSubscriptions;
