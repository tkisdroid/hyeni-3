import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Vars } from "./types";
import { resolveCorsOrigin } from "./lib/corsOrigin";
import { signRealtimeTicket, verifyRealtimeTicket } from "./lib/jwt";
import { getMyTeacherId, resolveVerifiedFamilyMembership } from "./db/authz";
import { requireAuth } from "./middleware/auth";
import {
  hashRealtimeTarget,
  isRealtimeTicketRequestBody,
  normalizeRealtimeTargetId,
  normalizeRealtimeTicketId,
  REALTIME_TICKET_TTL_SECONDS,
  resolveRealtimeTicketStoreFailure,
  type RealtimeTargetKind,
} from "./lib/realtimeTicket";
import authRoutes from "./routes/auth";
import familyRoutes from "./routes/family";
import eventRoutes from "./routes/events";
import academyRoutes from "./routes/academies";
import savedPlaceRoutes from "./routes/saved-places";
import memoRoutes from "./routes/memos";
import dailySupplyRoutes from "./routes/daily-supplies";
import dangerZoneRoutes from "./routes/danger-zones";
import stickerRoutes from "./routes/stickers";
import parentAlertRoutes from "./routes/parent-alerts";
import locationRoutes from "./routes/location";
import teacherRoutes from "./routes/teacher";
import teacherWriteRoutes from "./routes/teacher-write";
import teacherNoticeRoutes from "./routes/teacher-notices";
import kakaoRoutes from "./routes/kakao";
import feedbackRoutes from "./routes/feedback";
import premiumFunnelRoutes from "./routes/premium-funnel";
import accountRoutes from "./routes/account";
import { admin as adminRoutes } from "./routes/admin.ts";
import aiRoutes from "./routes/ai";
import aiProactiveRoutes from "./routes/ai-proactive";
import aiChatRoutes from "./routes/ai-child-chat";
import aiChatDataRoutes from "./routes/ai-chat-data";
import pushRoutes from "./routes/push-notify";
import {
  privacyPolicyHtml,
  termsOfServiceHtml,
  dataDeletionHtml,
  LEGAL_HTML_HEADERS,
  LEGAL_FAVICON_HEADERS,
  LEGAL_FAVICON_SVG,
} from "./routes/legal";
import { run as runRegistered } from "./cron/registered-place-geofence-check";
import { run as runDanger } from "./cron/danger-zone-geofence-check";
import { run as runStay } from "./cron/unregistered-stay-check";
import { run as runStaleness } from "./cron/location-staleness-check";
import { run as runTeacher } from "./cron/teacher-notification-batch";
import { run as runPushNotify } from "./cron/push-notify";
import { run as runForceRingReminder } from "./cron/force-ring-reminder";
import { run as runForceRingDeliveryTimeout } from "./cron/force-ring-delivery-timeout";
import { run as runPlaydateAutoEnd } from "./cron/friend-playdate-auto-end";
import { run as runAiProactive } from "./cron/ai-proactive";
import { run as runChildDailyDigest } from "./cron/child-daily-digest";
import { run as runPushIdempotencyCleanup } from "./cron/push-idempotency-cleanup";
import { run as runRemoteListenExpiry } from "./cron/remote-listen-expiry";
import { cacheSweep } from "./lib/edgeCache";
import mergeOauthRoutes from "./routes/merge-oauth";
import subscriptionReconcileRoutes from "./routes/subscription-reconcile";
import qonversionWebhookRoutes from "./routes/qonversion-webhook";
import googlePlayVerifyRoutes from "./routes/google-play-verify";
import googlePlayRtdnRoutes from "./routes/google-play-rtdn";
import webBillingRoutes from "./routes/web-billing";
import webAiCreditBillingRoutes from "./routes/web-ai-credit-billing";
import referralRoutes from "./routes/referrals";
import sendSmsRoutes from "./routes/send-sms";
import naverAuthRoutes from "./routes/naver-auth";
import oauthRoutes from "./routes/oauth";
import oauthBridgeRoutes from "./routes/oauth-bridge";
import playdateRoutes from "./routes/playdate";
import forceRingRoutes from "./routes/force-ring";
import sosRoutes from "./routes/sos";
import subscriptionsRoutes from "./routes/subscriptions";
import entitlementRoutes from "./routes/entitlement";
import remoteListenRoutes from "./routes/remote-listen";
import storageRoutes from "./routes/storage";
import notifSettingsRoutes from "./routes/notif-settings";
import locationPrefsRoutes from "./routes/location-prefs";
import pushSubscriptionsRoutes from "./routes/push-subscriptions";
import reviewRewardsRoutes from "./routes/review-rewards";
import restShim from "./routes/rest-shim";
import { cleanupStorageUploadDailyUsage } from "./lib/storageUploadQuota";
import { cleanupAnonymousSignupProtection } from "./lib/anonymousSignupProtection";
import { processPendingFamilyUnpairCleanups } from "./lib/unpairCleanup";
import { processPendingStorageInvalidUploadCleanups } from "./lib/storageInvalidUploadCleanup";
import { cleanupExpiredAccountMutationLeases } from "./lib/accountMutationLease";
import { cleanupCompletedAccountDeletionClaims } from "./lib/accountDeletionClaims";
import { processMemoNotificationOutbox } from "./lib/memoNotificationOutbox";
import { cleanupExpiredMemoInteractionLeases } from "./lib/memoInteractionLease";
import { run as runPremiumFunnelRetention } from "./cron/premium-funnel-retention";
import { run as runLocationHistoryRetention } from "./cron/location-history-retention";
import {
  REFERRAL_REWARD_CRON_MAX_D1_QUERIES,
  run as runReferralRewards,
} from "./cron/referral-rewards";
import { runLocationConfirmationRetention } from "./lib/locationConfirmationAudit";
import {
  cleanupWebBillingFinancialRecords,
  processWebBillingRefundFunnelRetries,
  processWebBillingRefundReconciliations,
  processWebBillingRenewals,
} from "./lib/webBillingService";
import {
  cleanupWebAiCreditOrders,
  processWebAiCreditReconciliations,
} from "./lib/webAiCreditBillingService";
import { cleanupLocationHistoryIngestDailyUsage } from "./lib/locationHistoryIngestQuota";
import { isReleaseDatabaseReady } from "./lib/healthReadiness";
import { logCronHeartbeat, logRequestOutcome } from "./lib/launchObservability";
import { normalizeEdgeCountry } from "./lib/accessRegion";

export { CalendarProfileService } from "./entrypoints/CalendarProfileService";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// invocation_logs=false를 유지하면서 배포 버전별 전체 요청과 5xx 분모만 집계한다.
// URL·method·header·body·사용자/가족 식별자는 이 마커에 넣지 않는다.
app.use("*", async (c, next) => {
  await next();
  logRequestOutcome(c.env.CF_VERSION_METADATA, c.res.status);
});

// PWA·Android WebView와 명시적인 로컬 개발 origin만 허용한다.
// Origin이 없는 서버 간 호출은 CORS 헤더 없이 그대로 처리한다.
app.use(
  "*",
  cors({
    origin: resolveCorsOrigin,
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "apikey",
      "x-client-info",
      "Idempotency-Key",
      "X-Hyeni-Upload-Purpose",
      "X-Hyeni-Upload-Request-Id",
      "X-Hyeni-Target-Member-Id",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  }),
);

// 공개 헬스체크는 사용자 행이나 건수를 읽지 않고 통합 출시 스키마 준비 상태만 확인한다.
app.get("/api/health", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    if (!(await isReleaseDatabaseReady(c.env.DB))) {
      console.error("[health] release schema is not ready");
      return c.json(
        { ok: false, error: "health_check_failed", reason: "schema_not_ready" },
        503,
      );
    }
    return c.json({ ok: true, status: "ready" });
  } catch {
    console.error("[health] D1 readiness query failed");
    return c.json(
      { ok: false, error: "health_check_failed", reason: "database_unavailable" },
      503,
    );
  }
});

// GPS·인증·D1 없이 Cloudflare 엣지가 이미 계산한 접속 국가만 공개한다.
// IP 원문이나 세부 지역은 읽거나 저장하지 않고, 캐시에도 남기지 않는다.
app.get("/api/access-region", (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ country: normalizeEdgeCountry(c.req.raw.cf?.country) });
});

// 공개 법적 고지(Play Console 필수 공개 URL). workers.dev 또는 커스텀 도메인(hyenicalendar.com)
// 어디로 라우팅되든 동작한다. GET /terms, GET /privacy, GET /data-deletion.
app.get("/terms", () => new Response(termsOfServiceHtml(), { headers: LEGAL_HTML_HEADERS }));
app.get("/privacy", () => new Response(privacyPolicyHtml(), { headers: LEGAL_HTML_HEADERS }));
app.get("/data-deletion", () => new Response(dataDeletionHtml(), { headers: LEGAL_HTML_HEADERS }));
app.get("/favicon.ico", () => new Response(LEGAL_FAVICON_SVG, { headers: LEGAL_FAVICON_HEADERS }));

// 브라우저 WebSocket은 Authorization 헤더를 보낼 수 없으므로 full access JWT를 URL에
// 싣지 않는다. 먼저 header 인증 POST로 45초·목적 제한 ticket을 발급하고, 가족/선생님
// Durable Object가 ticket ID를 원자적으로 한 번만 소비한다.
app.post("/api/realtime/ticket", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 512) {
    return c.json({ error: "payload_too_large" }, 413);
  }
  let body: unknown;
  try {
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > 512) {
      return c.json({ error: "payload_too_large" }, 413);
    }
    body = JSON.parse(raw) as unknown;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  if (!isRealtimeTicketRequestBody(body)) {
    return c.json({ error: "invalid_json" }, 400);
  }

  const familyId = normalizeRealtimeTargetId(body.familyId);
  const teacherId = normalizeRealtimeTargetId(body.teacherId);
  if ((familyId ? 1 : 0) + (teacherId ? 1 : 0) !== 1) {
    return c.json({ error: "realtime_target_required" }, 400);
  }

  const user = c.get("user");
  let targetKind: RealtimeTargetKind;
  let targetId: string;
  let stub: DurableObjectStub;
  try {
    if (familyId) {
      const membership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId);
      if (!membership) return c.json({ error: "forbidden" }, 403);
      targetKind = "family";
      targetId = familyId;
      stub = c.env.FAMILY_ROOM.get(c.env.FAMILY_ROOM.idFromName(familyId));
    } else {
      if (user.role !== "teacher") return c.json({ error: "forbidden" }, 403);
      const ownTeacherId = await getMyTeacherId(c.env.DB, user.sub);
      if (!teacherId || ownTeacherId !== teacherId) return c.json({ error: "forbidden" }, 403);
      targetKind = "teacher";
      targetId = teacherId;
      stub = c.env.TEACHER_ROOM.get(c.env.TEACHER_ROOM.idFromName(teacherId));
    }
  } catch (error) {
    console.error("[realtime-ticket] target authorization failed");
    return c.json({ error: "realtime_ticket_unavailable" }, 503);
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenExp = c.get("accessTokenExp");
  if (!Number.isSafeInteger(tokenExp) || tokenExp <= now + 1) {
    return c.json({ error: "access_token_expiring" }, 401);
  }
  const ticketExp = Math.min(tokenExp, now + REALTIME_TICKET_TTL_SECONDS);
  const ticketId = crypto.randomUUID();
  try {
    const targetHash = await hashRealtimeTarget(targetKind, targetId);
    const ticket = await signRealtimeTicket(c.env, {
      ticketId,
      targetKind,
      targetHash,
      issuedAt: now,
      expiresAt: ticketExp,
    });
    const storeResponse = await stub.fetch("https://realtime.internal/ticket", {
      method: "POST",
      headers: {
        "x-hyeni-ticket-id": ticketId,
        "x-hyeni-user-id": user.sub,
        "x-hyeni-user-role": user.role,
        "x-hyeni-token-exp": String(tokenExp),
        "x-hyeni-ticket-exp": String(ticketExp),
      },
    });
    const storeFailure = resolveRealtimeTicketStoreFailure(storeResponse);
    if (storeFailure?.status === 429) {
      c.header("Retry-After", String(storeFailure.retryAfterSeconds));
      return c.json({ error: "realtime_ticket_rate_limited" }, 429);
    }
    if (storeFailure) {
      return c.json({ error: "realtime_ticket_unavailable" }, 503);
    }
    return c.json({
      ticket,
      expires_at: new Date(ticketExp * 1000).toISOString(),
      expires_in: ticketExp - now,
    });
  } catch (error) {
    console.error("[realtime-ticket] issue failed");
    return c.json({ error: "realtime_ticket_unavailable" }, 503);
  }
});

// GET /realtime?family_id=...&ticket=... 또는 GET /realtime?teacher_id=...&ticket=...
app.get("/realtime", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "expected_websocket" }, 426);
  }
  const familyId = normalizeRealtimeTargetId(c.req.query("family_id"));
  const teacherId = normalizeRealtimeTargetId(c.req.query("teacher_id"));
  if ((familyId ? 1 : 0) + (teacherId ? 1 : 0) !== 1) {
    return c.json({ error: "realtime_target_required" }, 400);
  }
  const ticket = c.req.query("ticket") ?? "";
  if (ticket.length < 80 || ticket.length > 2048) {
    return c.json({ error: "invalid_ticket" }, 401);
  }
  const targetKind: RealtimeTargetKind = familyId ? "family" : "teacher";
  const targetId = familyId ?? teacherId ?? "";
  let ticketId: string;
  try {
    const claims = await verifyRealtimeTicket(c.env, ticket);
    const expectedHash = await hashRealtimeTarget(targetKind, targetId);
    ticketId = normalizeRealtimeTicketId(claims.jti) ?? "";
    if (!ticketId || claims.target_kind !== targetKind || claims.target_hash !== expectedHash) {
      throw new Error("ticket_scope_mismatch");
    }
  } catch {
    return c.json({ error: "invalid_ticket" }, 401);
  }

  const forwardedUrl = new URL(c.req.url);
  forwardedUrl.searchParams.delete("ticket");
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-hyeni-ticket-id", ticketId);
  if (teacherId) {
    const tid = c.env.TEACHER_ROOM.idFromName(teacherId);
    const tstub = c.env.TEACHER_ROOM.get(tid);
    return tstub.fetch(new Request(forwardedUrl, { headers }));
  }

  if (!familyId) return c.json({ error: "realtime_target_required" }, 400);
  const id = c.env.FAMILY_ROOM.idFromName(familyId);
  const stub = c.env.FAMILY_ROOM.get(id);
  return stub.fetch(new Request(forwardedUrl, { headers }));
});

// 라우트 마운트
app.route("/auth", authRoutes);
app.route("/api/family", familyRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/academies", academyRoutes);
app.route("/api/saved-places", savedPlaceRoutes);
app.route("/api/memos", memoRoutes);
app.route("/api/daily-supplies", dailySupplyRoutes);
app.route("/api/danger-zones", dangerZoneRoutes);
app.route("/api/stickers", stickerRoutes);
app.route("/api/parent-alerts", parentAlertRoutes);
app.route("/api/location", locationRoutes);
app.route("/api/teacher", teacherRoutes);
app.route("/api/teacher", teacherWriteRoutes);
// P6 알림장 — /api/teacher/notices/* (기존 teacher 경로와 충돌 없음)
app.route("/api/teacher", teacherNoticeRoutes);
// M4 Edge Functions → Worker
app.route("/api/kakao", kakaoRoutes);
app.route("/api/feedback", feedbackRoutes);
app.route("/api/premium-funnel", premiumFunnelRoutes);
app.route("/api/account", accountRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/ai", aiProactiveRoutes);
app.route("/api/ai", aiChatRoutes);
// P1-AI: AI 채팅 surface 데이터(설정·크레딧·메모리·기록·안전) — 하위 경로 분리로 충돌 없음
app.route("/api/ai", aiChatDataRoutes);
app.route("/api/push-notify", pushRoutes);
// M5 결제/SMS/OAuth/구독
app.route("/api/account", mergeOauthRoutes);
app.route("/api/subscription", subscriptionReconcileRoutes);
app.route("/api/billing", qonversionWebhookRoutes);
app.route("/api/billing", googlePlayVerifyRoutes);
app.route("/api/billing", googlePlayRtdnRoutes);
app.route("/api/billing", webBillingRoutes);
app.route("/api/billing", webAiCreditBillingRoutes);
app.route("/api/referrals", referralRoutes);
app.route("/api/sms", sendSmsRoutes);
app.route("/api/auth", naverAuthRoutes);
// P0-b OAuth(kakao/google) — /api/auth/oauth/:provider/{start,callback} + POST.
app.route("/api/auth", oauthRoutes);
// P3 전화 OTP 브리지 — /api/auth/oauth-bridge/{find-user,send-otp,verify-otp,mark-linked}.
app.route("/api/auth", oauthBridgeRoutes);
// P2 친구놀이(friend playdate) — candidates·sessions·public-places·family-enabled
app.route("/api/playdate", playdateRoutes);
// P3 응급 강제 알람(force_ring) read — active·history·quota
app.route("/api/force-ring", forceRingRoutes);
// P2 비-realtime — SOS audit / kkuk 쿼터 / 구독 read / 원격청취 세션
app.route("/api/sos", sosRoutes);
app.route("/api/subscriptions", subscriptionsRoutes);
// P3-entitlement: 프리미엄 게이트 read (family_subscription + families.user_tier raw 행)
app.route("/api/entitlement", entitlementRoutes);
app.route("/api/remote-listen", remoteListenRoutes);
// P1-storage 자녀 사진(child-photos) — Supabase Storage private bucket → R2 proxy
app.route("/api/storage", storageRoutes);
// P3 per-user 알림 설정(notification_settings) read/upsert + 같은 사용자 다기기 realtime
app.route("/api/notif-settings", notifSettingsRoutes);
// 가족 위치 전송 설정 — 부모 저장, 아이 네이티브 LocationService 가 읽어 주기 반영
app.route("/api/location-prefs", locationPrefsRoutes);
// P3 웹 푸시 구독(push_subscriptions) upsert/delete — 웹 전용(네이티브는 FCM)
app.route("/api/push-subscriptions", pushSubscriptionsRoutes);
// 기존 스토어 방문 혜택(family_review_rewards) read 호환 — 신규 claim은 410 종료
app.route("/api/review-rewards", reviewRewardsRoutes);
// 네이티브 PostgREST/Realtime 호환 shim (/rest/v1/rpc·table, /functions/v1 별칭, /realtime/v1/api/broadcast)
app.route("/", restShim);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  const entitlementError = err as Error & { code?: string; status?: number };
  if (
    entitlementError.code === "family_entitlement_unavailable"
    && entitlementError.status === 503
  ) {
    return c.json({ error: "family_entitlement_unavailable" }, 503);
  }
  console.error("[worker] unhandled:");
  return c.json({ error: "internal" }, 500);
});

// Durable Object 클래스는 엔트리포인트에서 export 해야 wrangler 가 바인딩한다.
export { FamilyRoom } from "./realtime/FamilyRoom";
export { TeacherRoom } from "./realtime/TeacherRoom";

// M4-B/M5 cron — pg_cron → Cloudflare Cron Triggers. 같은 표현식에 여러 작업이 있을 수 있다.
type CronHandler = {
  name: string;
  run: (env: Env) => Promise<unknown>;
};

const CRON_HANDLER_FAILURE = "scheduled_cron_handler_failed";

export async function runCronHandlers(
  cron: string,
  handlers: readonly CronHandler[],
  env: Env,
): Promise<void> {
  let failed = false;
  for (const handler of handlers) {
    try {
      await handler.run(env);
      logCronHeartbeat(env.CF_VERSION_METADATA, cron, handler.name, "success");
    } catch {
      failed = true;
      logCronHeartbeat(env.CF_VERSION_METADATA, cron, handler.name, "failure");
    }
  }
  if (failed) {
    throw new Error(CRON_HANDLER_FAILURE);
  }
}

export type HourlyMaintenanceHandler = CronHandler & {
  maxD1Queries: number;
};

export const HOURLY_MAINTENANCE_CRON = "0,5,10,15,20,25,30,35,40,45,50,55 * * * *";

const webBillingInitialRecoveryHandler: HourlyMaintenanceHandler = {
  name: "web-billing-initial-reconciliation",
  run: (env) => processWebBillingRenewals(env, { limit: 1, mode: "initial" }),
  maxD1Queries: 45,
};

const webBillingRefundRecoveryHandler: HourlyMaintenanceHandler = {
  name: "web-billing-refund-reconciliation",
  run: (env) => processWebBillingRefundReconciliations(env, { limit: 1 }),
  maxD1Queries: 50,
};

const hourlyMaintenanceSlots: Readonly<Record<number, readonly HourlyMaintenanceHandler[]>> = {
  // location-history retention은 9가족 기준 47 queries를 단독 사용한다.
  0: [{ name: "location-history-retention", run: runLocationHistoryRetention, maxD1Queries: 47 }],
  // 5분 offset은 환불 누락 대사 전용 invocation으로 하루 144건을 FIFO 처리한다.
  5: [webBillingRefundRecoveryHandler],
  15: [webBillingRefundRecoveryHandler],
  25: [webBillingRefundRecoveryHandler],
  35: [webBillingRefundRecoveryHandler],
  45: [webBillingRefundRecoveryHandler],
  55: [webBillingRefundRecoveryHandler],
  // Toss 최초 복구와 갱신은 서로 다른 invocation에서 후보 1건만 처리한다.
  10: [webBillingInitialRecoveryHandler],
  20: [{
    name: "web-billing-renewal",
    run: (env) => processWebBillingRenewals(env, { limit: 1, mode: "renewal" }),
    maxD1Queries: 45,
  }],
  30: [
    {
      name: "web-ai-credit-reconciliation",
      run: (env) => processWebAiCreditReconciliations(env, { limit: 1, mode: "recovery" }),
      maxD1Queries: 36,
    },
    { name: "location-confirmation-retention", run: runLocationConfirmationRetention, maxD1Queries: 1 },
    { name: "premium-funnel-retention", run: runPremiumFunnelRetention, maxD1Queries: 4 },
    {
      name: "web-billing-refund-funnel-retry",
      run: (env) => processWebBillingRefundFunnelRetries(env),
      maxD1Queries: 4,
    },
    { name: "push-idempotency-cleanup", run: runPushIdempotencyCleanup, maxD1Queries: 1 },
  ],
  40: [
    { name: "location-confirmation-retention", run: runLocationConfirmationRetention, maxD1Queries: 1 },
    {
      name: "storage-upload-usage-cleanup",
      run: async (env) => ({ removed: await cleanupStorageUploadDailyUsage(env.DB) }),
      maxD1Queries: 2,
    },
    {
      name: "anonymous-signup-protection-cleanup",
      run: async (env) => cleanupAnonymousSignupProtection(env.DB),
      maxD1Queries: 11,
    },
    {
      name: "account-mutation-lease-cleanup",
      run: async (env) => ({ removed: await cleanupExpiredAccountMutationLeases(env.DB) }),
      maxD1Queries: 1,
    },
    {
      name: "memo-interaction-lease-cleanup",
      run: async (env) => ({ removed: await cleanupExpiredMemoInteractionLeases(env.DB) }),
      maxD1Queries: 1,
    },
    {
      name: "referral-rewards",
      run: runReferralRewards,
      maxD1Queries: REFERRAL_REWARD_CRON_MAX_D1_QUERIES,
    },
  ],
  50: [
    { name: "location-confirmation-retention", run: runLocationConfirmationRetention, maxD1Queries: 1 },
    {
      name: "web-ai-credit-reconciliation-secondary",
      run: (env) => processWebAiCreditReconciliations(env, { limit: 1, mode: "refund" }),
      maxD1Queries: 36,
    },
    {
      name: "web-ai-credit-order-cleanup",
      run: async (env) => cleanupWebAiCreditOrders(env.DB),
      maxD1Queries: 3,
    },
    {
      name: "web-billing-financial-record-cleanup",
      run: async (env) => ({ removed: await cleanupWebBillingFinancialRecords(env.DB) }),
      maxD1Queries: 2,
    },
    {
      name: "location-history-ingest-usage-cleanup",
      run: async (env) => cleanupLocationHistoryIngestDailyUsage(env.DB),
      maxD1Queries: 1,
    },
    {
      name: "account-deletion-tombstone-cleanup",
      run: async (env) => cleanupCompletedAccountDeletionClaims(env.DB),
      maxD1Queries: 2,
    },
    {
      name: "edge-cache-sweep",
      run: async (env: Env) => ({ removed: await cacheSweep(env.DB) }),
      maxD1Queries: 1,
    },
  ],
};

export function resolveHourlyMaintenanceHandlers(
  scheduledTime: number,
): readonly HourlyMaintenanceHandler[] {
  if (!Number.isFinite(scheduledTime)) return [];
  const scheduledAt = new Date(scheduledTime);
  return hourlyMaintenanceSlots[scheduledAt.getUTCMinutes()] ?? [];
}

const CRON: Record<string, CronHandler[]> = {
  "* * * * *": [
    { name: "push-notify", run: runPushNotify },
    { name: "memo-notification-outbox", run: processMemoNotificationOutbox },
    { name: "force-ring-reminder", run: runForceRingReminder },
    { name: "remote-listen-expiry", run: runRemoteListenExpiry },
    { name: "family-unpair-cleanup", run: processPendingFamilyUnpairCleanups },
    { name: "storage-invalid-upload-cleanup", run: processPendingStorageInvalidUploadCleanups },
  ],
  // 2분: 등록장소 도착 + force-ring 타임아웃 + 놀이 자동종료 + 위험지역.
  //   danger-zone 은 원래 1-59/2(홀수분) → */2(짝수분)로 통합, 동일 2분 주기(무해).
  "*/2 * * * *": [
    { name: "registered-place-geofence-check", run: runRegistered },
    { name: "force-ring-delivery-timeout", run: runForceRingDeliveryTimeout },
    { name: "friend-playdate-auto-end", run: runPlaydateAutoEnd },
    { name: "danger-zone-geofence-check", run: runDanger },
  ],
  // 5분: 위치 끊김(원래 3분) + 미등록 체류(원래 4분) + 선생님 배치(원래 5분).
  //   Cloudflare Free 플랜 cron trigger 5개 한도에 맞춘 통합 — 핸들러는 하나도 버리지
  //   않고 주기만 소폭 완화. 위치 끊김 임계(10분) 대비 5분 스캔은 충분.
  "*/5 * * * *": [
    { name: "location-staleness-check", run: runStaleness },
    { name: "unregistered-stay-check", run: runStay },
    { name: "teacher-notification-batch", run: runTeacher },
  ],
  // 하루 대시보드는 자기 트리거를 새로 만들지 않는다(Cloudflare Free 플랜 cron 5개 한도).
  // 핸들러가 KST 저녁 창 밖이면 즉시 빠져나오고, 하루 1회는 DB PK 가 보증한다.
  "*/10 * * * *": [
    { name: "ai-proactive", run: runAiProactive },
    { name: "child-daily-digest", run: runChildDailyDigest },
  ],
};

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const handlers = event.cron === HOURLY_MAINTENANCE_CRON
      ? resolveHourlyMaintenanceHandlers(event.scheduledTime)
      : CRON[event.cron];
    if (!handlers?.length) {
      console.warn("[cron] no handler for");
      return;
    }
    await runCronHandlers(event.cron, handlers, env);
  },
};
