// 아이 하루 대시보드 — 프리미엄 보호자에게 하루 한 번(2026-08-19 TK 지시).
//
// 언제: KST 저녁(20:00~23:00) 창 안에서 `*/10` cron 이 돌 때. 하루가 거의 끝난 뒤에 본다.
// 몇 번: **하루·아이당 한 번**. `child_daily_digests` PK 가 최종 보증이고,
//        INSERT 가 실제로 행을 만든 실행만 알림을 보낸다(여러 tick 이 겹쳐도 1건).
// 누구에게: 프리미엄 가족의 보호자. 무료 가족은 만들지도 보내지도 않는다.
// 무엇을: 대화 **주제**와 하루 일과 집계. 아이 대화 원문은 담지 않는다.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import { deliverParentAlert } from "./_deliver";
import { pgNow } from "../lib/time";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import { toAppDateKey } from "../shared/aiScheduleTools.js";
import {
  buildChildDailyDigest,
  buildChildDailyDigestAlert,
  childDailyDigestEventId,
  isChildDailyDigestWindow,
  shouldSendChildDailyDigest,
  CHILD_DAILY_DIGEST_ALERT_TYPE,
} from "../shared/childDailyDigest.js";
import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
} from "../lib/accountMutationLease";

// 순수 정책 모듈은 plain ESM(.js) 이라 기본 인자에서 never[] 로 추론된다.
// 계약은 childDailyDigest.js 주석과 tests/childDailyDigest 회귀가 지킨다.
type AnyFn = (...args: any[]) => any;
const buildDigest = buildChildDailyDigest as AnyFn;
const buildDigestAlert = buildChildDailyDigestAlert as AnyFn;
const shouldSendDigest = shouldSendChildDailyDigest as AnyFn;
const isDigestWindow = isChildDailyDigestWindow as AnyFn;
const digestEventId = childDailyDigestEventId as AnyFn;
const resolveEntitlement = resolveFamilyEntitlement as AnyFn;
const appDateKeyOf = toAppDateKey as AnyFn;

/** 한 tick 에서 처리할 최대 자녀 수. D1 질의 예산을 넘기지 않도록 낮게 둔다. */
const MAX_CHILDREN_PER_TICK = 8;

interface DigestChild {
  id: string;
  family_id: string;
  user_id: string;
  name: string | null;
}

function kstParts(now = new Date()): { dateKey: string; hhmm: string; startUtc: string; endUtc: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateKey = kst.toISOString().slice(0, 10);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  // KST 하루 경계를 UTC 문자열로 바꿔 substr 비교에 쓴다(D1 timestamp 는 UTC 문자열).
  const startUtcMs = Date.parse(`${dateKey}T00:00:00Z`) - 9 * 60 * 60 * 1000;
  return {
    dateKey,
    hhmm: `${hh}:${mm}`,
    startUtc: new Date(startUtcMs).toISOString().slice(0, 19).replace("T", " "),
    endUtc: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " "),
  };
}

/** 오늘 아직 대시보드를 만들지 않은 활성 아이. 이미 만든 아이는 SQL 에서 걸러 낸다. */
async function loadPendingChildren(db: D1Database, dateKey: string): Promise<DigestChild[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT fm.id, fm.family_id, fm.user_id, fm.name
           FROM family_members fm
          WHERE fm.role = 'child'
            AND fm.is_active = 1
            AND fm.user_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM child_daily_digests d
               WHERE d.family_id = fm.family_id
                 AND d.child_user_id = fm.user_id
                 AND d.date_key = ?
            )
          ORDER BY fm.family_id, fm.id
          LIMIT ?`,
      )
      .bind(dateKey, MAX_CHILDREN_PER_TICK)
      .all<DigestChild>();
    return results ?? [];
  } catch {
    console.error("[child-daily-digest] candidate lookup failed");
    return [];
  }
}

async function loadDigestPayload(
  db: D1Database,
  child: DigestChild,
  window: { dateKey: string; startUtc: string; endUtc: string },
): Promise<Record<string, any>> {
  const appDateKey = appDateKeyOf(window.dateKey);
  const [chatMessages, discoveries, safetyEvents, events, supplies, alerts] = await Promise.all([
    db.prepare(
      `SELECT role, content FROM ai_chat_messages
        WHERE family_id=? AND child_user_id=? AND role='user'
          AND substr(created_at,1,19) >= ? AND substr(created_at,1,19) < ?
        ORDER BY substr(created_at,1,19) ASC LIMIT 60`,
    ).bind(child.family_id, child.user_id, window.startUtc, window.endUtc).all<Record<string, unknown>>()
      .catch(() => ({ results: [] })),
    db.prepare(
      `SELECT value, parent_visible FROM ai_long_term_memories
        WHERE family_id=? AND child_user_id=? AND parent_visible=1
          AND substr(updated_at,1,19) >= ? AND substr(updated_at,1,19) < ?
        ORDER BY confidence DESC LIMIT 8`,
    ).bind(child.family_id, child.user_id, window.startUtc, window.endUtc).all<Record<string, unknown>>()
      .catch(() => ({ results: [] })),
    db.prepare(
      `SELECT severity FROM ai_safety_events
        WHERE family_id=? AND child_user_id=?
          AND substr(created_at,1,19) >= ? AND substr(created_at,1,19) < ?
        LIMIT 20`,
    ).bind(child.family_id, child.user_id, window.startUtc, window.endUtc).all<Record<string, unknown>>()
      .catch(() => ({ results: [] })),
    db.prepare(
      `SELECT e.title, e.time FROM events e
        WHERE e.family_id=? AND e.date_key=?
          AND (e.is_family_event=1 OR EXISTS (
            SELECT 1 FROM events_children ec WHERE ec.event_id=e.id AND ec.child_id=?
          ))
        ORDER BY e.time ASC LIMIT 12`,
    ).bind(child.family_id, appDateKey, child.id).all<Record<string, unknown>>()
      .catch(() => ({ results: [] })),
    db.prepare(
      `SELECT supplies, homework FROM daily_supplies
        WHERE family_id=? AND child_id=? AND date_key=?
        ORDER BY substr(updated_at,1,19) DESC LIMIT 1`,
    ).bind(child.family_id, child.id, appDateKey).first<Record<string, unknown>>()
      .catch(() => null),
    db.prepare(
      `SELECT alert_type FROM parent_alerts
        WHERE family_id=? AND child_user_id=?
          AND substr(created_at,1,19) >= ? AND substr(created_at,1,19) < ?
        LIMIT 40`,
    ).bind(child.family_id, child.user_id, window.startUtc, window.endUtc).all<Record<string, unknown>>()
      .catch(() => ({ results: [] })),
  ]);

  return buildDigest({
    dateKey: window.dateKey,
    childName: child.name ?? "",
    chatMessages: chatMessages.results ?? [],
    discoveries: discoveries.results ?? [],
    safetyEvents: safetyEvents.results ?? [],
    events: events.results ?? [],
    supplies,
    alerts: alerts.results ?? [],
  });
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const now = kstParts();
  if (!isDigestWindow(now.hhmm)) {
    return { skipped: "outside_window", nowHHMM: now.hhmm };
  }

  const children = await loadPendingChildren(db, now.dateKey);
  let checked = 0;
  let premiumSkipped = 0;
  let emptySkipped = 0;
  let created = 0;
  let notified = 0;

  const entitlementCache = new Map<string, boolean>();
  for (const child of children) {
    checked += 1;
    let isPremium = entitlementCache.get(child.family_id);
    if (isPremium === undefined) {
      try {
        isPremium = Boolean((await resolveEntitlement(db, child.family_id))?.isPremium);
      } catch {
        // 엔타이틀먼트를 확인할 수 없으면 프리미엄으로 추정하지 않는다(fail-closed).
        isPremium = false;
      }
      entitlementCache.set(child.family_id, isPremium);
    }
    if (!isPremium) {
      premiumSkipped += 1;
      continue;
    }

    const lease = await acquireAccountMutationLease(db, {
      userId: child.user_id,
      familyId: child.family_id,
    });
    if (lease.status !== "acquired") continue;
    try {
      const digest = await loadDigestPayload(db, child, now);
      if (!shouldSendDigest(digest)) {
        emptySkipped += 1;
        continue;
      }

      // 여기서 행이 실제로 만들어진 실행만 알림을 보낸다 = "1회성" 보증.
      const insert = await db
        .prepare(
          `INSERT OR IGNORE INTO child_daily_digests
             (family_id, child_user_id, date_key, payload, created_at)
           VALUES (?,?,?,?,?)`,
        )
        .bind(child.family_id, child.user_id, now.dateKey, JSON.stringify(digest), pgNow())
        .run();
      if (Number(insert.meta?.changes ?? 0) === 0) continue;
      created += 1;

      const copy = buildDigestAlert(digest);
      const eventId = digestEventId(child.user_id, now.dateKey);
      const { pushOk, alertId } = await deliverParentAlert(env as PushEnv, db, {
        familyId: child.family_id,
        childUserId: child.user_id,
        alert: {
          alertType: CHILD_DAILY_DIGEST_ALERT_TYPE,
          severity: "info",
          title: copy.title,
          message: copy.message,
        },
        idempotencyKey: eventId,
      });
      if (alertId) {
        await db
          .prepare(
            "UPDATE child_daily_digests SET alert_id=?, notified_at=? WHERE family_id=? AND child_user_id=? AND date_key=?",
          )
          .bind(alertId, pgNow(), child.family_id, child.user_id, now.dateKey)
          .run();
      }
      if (pushOk) notified += 1;
    } catch {
      console.error("[child-daily-digest] digest build failed");
    } finally {
      await releaseAccountMutationLease(db, lease.lease.id);
    }
  }

  return { checked, created, notified, premiumSkipped, emptySkipped, dateKey: now.dateKey };
}
