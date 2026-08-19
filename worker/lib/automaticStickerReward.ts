import { notifyPg } from "./realtime";
import { pgNow } from "./time";
import type { PushEnv } from "./pushEnv";
import { partitionNotificationRecipients } from "./notificationQuietHours";
import { sendFcmToFamily } from "../routes/push-notify";

export const AUTOMATIC_EARLY_ARRIVAL_WINDOW_MS = 60 * 60_000;

export interface ScheduleEarlyArrivalBehavior {
  kind: "schedule_early_arrival";
  familyId: string;
  childUserId: string;
  eventId: string;
  occurrenceId: string;
  dateKey: string;
  arrivedAtMs: number;
  scheduledAtMs: number;
}

export type AutomaticStickerBehavior = ScheduleEarlyArrivalBehavior;

export interface AutomaticStickerReward {
  ruleId: "schedule_early_arrival_v1";
  eventId: string;
  dateKey: string;
  stickerType: "early";
  emoji: "🌟";
  title: "일찍 도착했어요";
}

/**
 * 행동→보상 규칙의 순수 판정점. 새 규칙은 이 함수에 명시적으로 추가하며,
 * UI나 알림 경로에서 임의로 스티커를 만들지 않는다.
 */
export function resolveAutomaticStickerReward(
  behavior: AutomaticStickerBehavior,
): AutomaticStickerReward | null {
  if (behavior.kind !== "schedule_early_arrival") return null;
  const familyId = behavior.familyId.trim();
  const childUserId = behavior.childUserId.trim();
  const eventId = behavior.eventId.trim();
  const occurrenceId = behavior.occurrenceId.trim();
  const dateKey = behavior.dateKey.trim();
  if (!familyId || !childUserId || !eventId || !occurrenceId) return null;
  if (!/^\d{4,}-\d{1,2}-\d{1,2}$/.test(dateKey)) return null;
  if (!Number.isFinite(behavior.arrivedAtMs) || !Number.isFinite(behavior.scheduledAtMs)) return null;
  const leadMs = behavior.scheduledAtMs - behavior.arrivedAtMs;
  if (leadMs <= 0 || leadMs > AUTOMATIC_EARLY_ARRIVAL_WINDOW_MS) return null;
  return {
    ruleId: "schedule_early_arrival_v1",
    eventId: `auto:schedule_early_arrival_v1:${occurrenceId}`,
    dateKey,
    stickerType: "early",
    emoji: "🌟",
    title: "일찍 도착했어요",
  };
}

export interface AutomaticStickerAwardResult {
  status: "awarded" | "duplicate" | "ineligible";
  stickerId?: string;
}

/**
 * 검증된 서버 위치 전이에서만 호출한다. 단일 INSERT ... WHERE NOT EXISTS로
 * 네이티브·cron·재시도가 겹쳐도 occurrence당 한 번만 지급한다.
 */
export async function awardAutomaticStickerForBehavior(
  env: PushEnv,
  db: D1Database,
  behavior: AutomaticStickerBehavior,
): Promise<AutomaticStickerAwardResult> {
  const reward = resolveAutomaticStickerReward(behavior);
  if (!reward) return { status: "ineligible" };

  const stickerId = crypto.randomUUID();
  const earnedAt = pgNow();
  try {
    const inserted = await db.prepare(
      `INSERT INTO stickers
         (id, user_id, family_id, event_id, date_key, sticker_type, emoji, title, earned_at)
       SELECT ?,?,?,?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM family_members
           WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
        )
          AND NOT EXISTS (
            SELECT 1 FROM stickers
             WHERE user_id=? AND event_id=? AND sticker_type=?
          )`,
    ).bind(
      stickerId,
      behavior.childUserId,
      behavior.familyId,
      reward.eventId,
      reward.dateKey,
      reward.stickerType,
      reward.emoji,
      reward.title,
      earnedAt,
      behavior.familyId,
      behavior.childUserId,
      behavior.childUserId,
      reward.eventId,
      reward.stickerType,
    ).run();
    if (Number(inserted.meta?.changes ?? 0) === 0) return { status: "duplicate" };

    const row = {
      id: stickerId,
      user_id: behavior.childUserId,
      family_id: behavior.familyId,
      event_id: reward.eventId,
      date_key: reward.dateKey,
      sticker_type: reward.stickerType,
      emoji: reward.emoji,
      title: reward.title,
      earned_at: earnedAt,
    };
    await notifyPg(env, behavior.familyId, "stickers", "INSERT", row, null);

    try {
      const quiet = await partitionNotificationRecipients(db, {
        userIds: [behavior.childUserId],
        identity: { action: "sticker" },
        atMs: Date.now(),
      });
      if (quiet.allowed.has(behavior.childUserId)) {
        await sendFcmToFamily(
          env,
          db,
          behavior.familyId,
          "",
          "스티커 도착!",
          "일정 장소에 미리 도착해서 스티커를 받았어!",
          "sticker",
          {
            targetRole: "child",
            targetUserId: behavior.childUserId,
            stickerId,
            stickerEmoji: reward.emoji,
            stickerTitle: reward.title,
            eventId: behavior.eventId,
            rewardRule: reward.ruleId,
            route: "child-sticker",
          },
          new Set([behavior.childUserId]),
        );
      }
    } catch {
      // 보상 행은 이미 정본에 저장됐다. 푸시 실패가 중복 지급을 유발하지 않게 재삽입하지 않는다.
      console.warn("[automatic-sticker] child push failed");
    }
    return { status: "awarded", stickerId };
  } catch {
    console.error("[automatic-sticker] reward failed");
    return { status: "ineligible" };
  }
}
