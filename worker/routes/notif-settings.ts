// per-user 알림 설정 read/upsert. Supabase notification_settings 테이블(user_id PK) 직역.
// 원본: src/lib/notifSettings.js — select(user_id=eq)/upsert(onConflict user_id)/realtime(user_id 필터).
// D1 저장형: boolean→INTEGER 0/1, minutes_before→TEXT pg array literal('{15,5}').
// 응답은 Supabase 형태(snake_case row, boolean, int[])로 되돌려 클라 rowToSettings 가 그대로 소비.
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { assertFamilyAccess, resolveCanonicalFamilyMembership } from "../db/authz";
import { toBool, pgArray, toPgArray } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import {
  acquireAccountMutationLeases,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { handleInstantNotification } from "./push-notify";
import {
  type FamilyQuietHoursRecipient,
  loadChildNotificationStatus,
  loadFamilyQuietHoursRecipients,
  validateExpectedSettingsUser,
  validateQuietHoursTarget,
} from "../lib/notificationSettingsAccess";

export {
  loadChildNotificationStatus,
  loadFamilyQuietHoursRecipients,
  validateExpectedSettingsUser,
  validateQuietHoursTarget,
} from "../lib/notificationSettingsAccess";

const notifSettings = new Hono<{ Bindings: Env; Variables: Vars }>();
type NotifSettingsContext = Context<{ Bindings: Env; Variables: Vars }>;

const ACCOUNT_WRITE_ALLOWED_SQL = `
  EXISTS(SELECT 1 FROM users WHERE id = ?)
  AND NOT EXISTS(
    SELECT 1 FROM account_deletion_scopes
     WHERE scope_type = 'user' AND scope_id = ?
  )
  AND (
    ? IS NULL OR NOT EXISTS(
      SELECT 1 FROM account_deletion_scopes
       WHERE scope_type = 'family' AND scope_id = ?
    )
  )
  AND (
    ? IS NULL OR NOT EXISTS(
      SELECT 1 FROM account_deletion_scopes
       WHERE scope_type = 'family' AND scope_id = ?
    )
  )`;

const QUIET_HOURS_DB_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const QUIET_HOURS_CANONICAL_STORED_SQL = `strftime(
  '%Y-%m-%dT%H:%M:%fZ',
  CASE
    WHEN substr(notification_settings.quiet_hours_updated_at, -3) = '+00'
      THEN replace(
        substr(
          notification_settings.quiet_hours_updated_at,
          1,
          length(notification_settings.quiet_hours_updated_at) - 3
        ),
        ' ',
        'T'
      ) || 'Z'
    ELSE replace(notification_settings.quiet_hours_updated_at, ' ', 'T')
  END
)`;

function accountDeletionConflict(c: NotifSettingsContext) {
  return c.json({ error: "account_deletion_in_progress" }, 409);
}

type SettingsRow = {
  user_id: string;
  family_id: string | null;
  child_enabled: unknown;
  parent_enabled: unknown;
  location_enabled: unknown;
  registered_place_enabled: unknown;
  playdate_enabled: unknown;
  minutes_before: unknown;
  quiet_hours_enabled: unknown;
  quiet_hours_start_minute: unknown;
  quiet_hours_end_minute: unknown;
  quiet_hours_updated_at: string | null;
};

// D1 raw row → Supabase 형태(boolean·int[]). 클라 rowToSettings 의 입력 계약과 동일.
function toSupabaseRow(r: SettingsRow) {
  return {
    user_id: r.user_id,
    family_id: r.family_id ?? null,
    child_enabled: toBool(r.child_enabled),
    parent_enabled: toBool(r.parent_enabled),
    location_enabled: toBool(r.location_enabled),
    registered_place_enabled: toBool(r.registered_place_enabled),
    playdate_enabled: toBool(r.playdate_enabled),
    minutes_before: pgArray(r.minutes_before).map((n) => Number(n)).filter((n) => Number.isFinite(n)),
    quiet_hours: {
      enabled: toBool(r.quiet_hours_enabled),
      start_minute: Number(r.quiet_hours_start_minute ?? 1320),
      end_minute: Number(r.quiet_hours_end_minute ?? 420),
      updated_at: r.quiet_hours_updated_at ?? null,
      configured: r.quiet_hours_updated_at != null,
    },
  };
}

// GET /api/notif-settings — 호출자 본인 행(user_id = sub). 없으면 null(첫 실행 → 클라가 마이그).
notifSettings.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    `SELECT user_id, family_id, child_enabled, parent_enabled, location_enabled,
            registered_place_enabled, playdate_enabled, minutes_before,
            quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute,
            quiet_hours_updated_at
       FROM notification_settings
      WHERE user_id = ?`,
  )
    .bind(user.sub)
    .first<SettingsRow>();
  return c.json(row ? toSupabaseRow(row) : null);
});

// GET /api/notif-settings/child-status?family_id=...&child_user_id=...
// 부모 기기 상태 화면에는 아이의 앱 내부 일정 알림 허용 여부만 필요하다. 현재 정본
// 가족의 주보호자/활성 공동부모에게 같은 가족의 활성 자녀 최소 필드만 반환한다.
notifSettings.get("/child-status", requireAuth, async (c) => {
  const user = c.get("user");
  const familyId = c.req.query("family_id")?.trim() ?? "";
  const childUserId = c.req.query("child_user_id")?.trim() ?? "";
  if (!familyId || !childUserId) {
    return c.json({ error: "family_id_and_child_user_id_required" }, 400);
  }
  const canonical = await resolveCanonicalFamilyMembership(
    c.env.DB,
    user.sub,
    user.family_id ?? null,
  );
  if (!canonical || canonical.familyId !== familyId || canonical.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }
  const status = await loadChildNotificationStatus(c.env.DB, {
    callerUserId: user.sub,
    familyId,
    childUserId,
  });
  if (!status) return c.json({ error: "active_child_not_found" }, 404);
  return c.json(status);
});

// GET /api/notif-settings/family?family_id=...
// 호출 부모 본인과 같은 가족의 활성 아이만 반환한다. 다른 공동부모 설정은 노출하지 않는다.
notifSettings.get("/family", requireAuth, async (c) => {
  const user = c.get("user");
  const familyId = c.req.query("family_id")?.trim() ?? "";
  if (!familyId) return c.json({ error: "family_id_required" }, 400);
  const canonical = await resolveCanonicalFamilyMembership(
    c.env.DB,
    user.sub,
    user.family_id ?? null,
  );
  if (!canonical || canonical.familyId !== familyId || canonical.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }
  const recipients = await loadFamilyQuietHoursRecipients(c.env.DB, {
    callerUserId: user.sub,
    familyId,
  });
  if (!recipients) return c.json({ error: "forbidden" }, 403);
  return c.json({ family_id: familyId, recipients });
});

// POST /api/notif-settings — upsert(user_id PK). 복합 키 없이 select-then-write.
// user_id 는 항상 호출자(sub)로 고정(본인 행만). family_id 가 오면 소속 검증(아니면 403).
// body:{ family_id?, child_enabled, parent_enabled, location_enabled,
//        registered_place_enabled, playdate_enabled, minutes_before:number[] }
notifSettings.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();

  const expectedUserValidation = validateExpectedSettingsUser(b.expected_user_id, user.sub);
  if (expectedUserValidation === "required") {
    return c.json({ error: "expected_user_id_required" }, 400);
  }
  if (expectedUserValidation === "mismatch") {
    return c.json({ error: "session_user_changed" }, 409);
  }

  const familyId = b.family_id ? String(b.family_id) : null;
  if (familyId && !(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const bool01 = (v: unknown) => (v ? 1 : 0);
  const childEnabled = bool01(b.child_enabled);
  const parentEnabled = bool01(b.parent_enabled);
  const locationEnabled = bool01(b.location_enabled);
  const registeredPlaceEnabled = bool01(b.registered_place_enabled);
  const playdateEnabled = bool01(b.playdate_enabled);
  const minutesArr = Array.isArray(b.minutes_before)
    ? (b.minutes_before as unknown[]).map((n) => String(Number(n))).filter((n) => n !== "NaN")
    : [];
  const minutesBefore = toPgArray(minutesArr);
  const now = pgNow();

  const existing = await c.env.DB.prepare(
    `SELECT user_id, family_id FROM notification_settings WHERE user_id = ? LIMIT 1`,
  )
    .bind(user.sub)
    .first<{ user_id: string; family_id: string | null }>();
  const previousFamilyId = existing?.family_id ?? null;

  if (existing) {
    const result = await c.env.DB.prepare(
      `UPDATE notification_settings
          SET family_id = ?, child_enabled = ?, parent_enabled = ?, location_enabled = ?,
              registered_place_enabled = ?, playdate_enabled = ?, minutes_before = ?, updated_at = ?
        WHERE user_id = ?
          AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    )
      .bind(
        familyId, childEnabled, parentEnabled, locationEnabled,
        registeredPlaceEnabled, playdateEnabled, minutesBefore, now, user.sub,
        user.sub, user.sub,
        previousFamilyId, previousFamilyId,
        familyId, familyId,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) return accountDeletionConflict(c);
  } else {
    const result = await c.env.DB.prepare(
      `INSERT INTO notification_settings
         (user_id, family_id, child_enabled, parent_enabled, location_enabled,
          registered_place_enabled, playdate_enabled, minutes_before, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    )
      .bind(
        user.sub, familyId, childEnabled, parentEnabled, locationEnabled,
        registeredPlaceEnabled, playdateEnabled, minutesBefore, now,
        user.sub, user.sub,
        null, null,
        familyId, familyId,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) return accountDeletionConflict(c);
  }

  // 같은 사용자의 다른 기기에 변경 fan-out. FamilyRoom(family_id) 으로 통지하고
  // 클라가 user_id 로 필터한다(원본 user_id=eq 필터 의미 보존). family_id 가 null 이면 통지 생략.
  await notifyPg(
    c.env,
    familyId ?? "",
    "notification_settings",
    existing ? "UPDATE" : "INSERT",
    {
      user_id: user.sub,
      family_id: familyId,
      child_enabled: !!childEnabled,
      parent_enabled: !!parentEnabled,
      location_enabled: !!locationEnabled,
      registered_place_enabled: !!registeredPlaceEnabled,
      playdate_enabled: !!playdateEnabled,
      minutes_before: minutesArr.map((n) => Number(n)),
    },
    null,
  );

  return c.json({ ok: true });
});

// PUT /api/notif-settings/quiet-hours — 부모 본인 또는 같은 가족 활성 아이 한 명만 부분 수정.
notifSettings.put("/quiet-hours", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<Record<string, unknown>>();
  const expectedParentValidation = validateExpectedSettingsUser(
    body.expected_parent_user_id,
    user.sub,
  );
  if (expectedParentValidation === "required") {
    return c.json({ error: "expected_parent_user_id_required" }, 400);
  }
  if (expectedParentValidation === "mismatch") {
    return c.json({ error: "session_user_changed" }, 409);
  }

  const familyId = typeof body.family_id === "string" ? body.family_id.trim() : "";
  const targetUserId = typeof body.target_user_id === "string" ? body.target_user_id.trim() : "";
  if (!familyId || !targetUserId) {
    return c.json({ error: "family_id_and_target_user_id_required" }, 400);
  }
  const canonical = await resolveCanonicalFamilyMembership(
    c.env.DB,
    user.sub,
    user.family_id ?? null,
  );
  if (!canonical || canonical.familyId !== familyId || canonical.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }

  const enabled = body.enabled;
  const startMinute = body.start_minute;
  const endMinute = body.end_minute;
  if (
    typeof enabled !== "boolean"
    || !Number.isInteger(startMinute)
    || Number(startMinute) < 0
    || Number(startMinute) > 1439
    || !Number.isInteger(endMinute)
    || Number(endMinute) < 0
    || Number(endMinute) > 1439
    || startMinute === endMinute
  ) {
    return c.json({ error: "invalid_quiet_hours" }, 400);
  }

  const leaseResult = await acquireAccountMutationLeases(c.env.DB, [
    { userId: user.sub, familyId },
    { userId: targetUserId, familyId },
  ]);
  if (leaseResult.status === "blocked") {
    return c.json({ error: "account_mutation_blocked" }, 409);
  }
  if (leaseResult.status === "unavailable") {
    return c.json({ error: "account_mutation_unavailable" }, 503);
  }

  let leasesTransferred = false;
  try {
    const targetKind = await validateQuietHoursTarget(c.env.DB, {
      callerUserId: user.sub,
      familyId,
      targetUserId,
    });
    if (!targetKind) return c.json({ error: "quiet_hours_target_not_found" }, 403);

    const existing = await c.env.DB
      .prepare("SELECT user_id FROM notification_settings WHERE user_id = ? LIMIT 1")
      .bind(targetUserId)
      .first<{ user_id: string }>();
    const eventType: "INSERT" | "UPDATE" = existing ? "UPDATE" : "INSERT";
    const now = pgNow();
    const stored = await c.env.DB
      .prepare(
        `INSERT INTO notification_settings
          (user_id, family_id, child_enabled, parent_enabled, location_enabled,
           registered_place_enabled, playdate_enabled, minutes_before, updated_at,
           quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute,
           quiet_hours_updated_by, quiet_hours_updated_at)
         VALUES (?,?,1,1,1,1,1,'{15,5}',?,?,?,?,?,${QUIET_HOURS_DB_NOW_SQL})
         ON CONFLICT(user_id) DO UPDATE SET
           quiet_hours_enabled = excluded.quiet_hours_enabled,
           quiet_hours_start_minute = excluded.quiet_hours_start_minute,
           quiet_hours_end_minute = excluded.quiet_hours_end_minute,
           quiet_hours_updated_by = excluded.quiet_hours_updated_by,
           quiet_hours_updated_at = CASE
             WHEN ${QUIET_HOURS_CANONICAL_STORED_SQL} IS NULL
               THEN excluded.quiet_hours_updated_at
             WHEN excluded.quiet_hours_updated_at > ${QUIET_HOURS_CANONICAL_STORED_SQL}
               THEN excluded.quiet_hours_updated_at
             ELSE strftime(
               '%Y-%m-%dT%H:%M:%fZ',
               ${QUIET_HOURS_CANONICAL_STORED_SQL},
               '+0.001 seconds'
             )
           END
         RETURNING quiet_hours_enabled, quiet_hours_start_minute,
                   quiet_hours_end_minute, quiet_hours_updated_at`,
      )
      .bind(
        targetUserId,
        familyId,
        now,
        enabled ? 1 : 0,
        startMinute,
        endMinute,
        user.sub,
      )
      .first<{
        quiet_hours_enabled: unknown;
        quiet_hours_start_minute: number;
        quiet_hours_end_minute: number;
        quiet_hours_updated_at: string | null;
      }>();
    if (!stored) return c.json({ error: "quiet_hours_write_failed" }, 503);
    const savedRow: FamilyQuietHoursRecipient = {
      target_user_id: targetUserId,
      role: targetKind === "active_child" ? "child" : "parent",
      enabled: toBool(stored.quiet_hours_enabled),
      start_minute: Number(stored.quiet_hours_start_minute),
      end_minute: Number(stored.quiet_hours_end_minute),
      updated_at: stored.quiet_hours_updated_at ?? null,
      configured: stored.quiet_hours_updated_at != null,
    };
    const deliveryTask = (async () => {
      try {
        const currentTargetKind = await validateQuietHoursTarget(c.env.DB, {
          callerUserId: user.sub,
          familyId,
          targetUserId,
        });
        if (!currentTargetKind) return;

        await notifyPg(
          c.env,
          familyId,
          "notification_settings",
          eventType,
          { user_id: targetUserId, family_id: familyId },
          null,
          { targetUserIds: [user.sub, targetUserId] },
        );
        const delivery = await handleInstantNotification(
          c.env,
          c.env.DB,
          {
            action: "notification_quiet_hours_updated",
            familyId,
            targetUserId,
            enabled: savedRow.enabled,
            startMinute: savedRow.start_minute,
            endMinute: savedRow.end_minute,
            updatedAt: savedRow.updated_at,
          },
          user.sub,
          "parent",
          null,
        );
        if (!delivery.ok) {
          console.error("[notif-settings] quiet hours command delivery failed");
        }
      } catch (error) {
        console.error("[notif-settings] quiet hours command delivery failed");
      } finally {
        await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
      }
    })();
    c.executionCtx.waitUntil(deliveryTask);
    leasesTransferred = true;

    return c.json(savedRow);
  } finally {
    if (!leasesTransferred) {
      await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
    }
  }
});

export default notifSettings;
