export function deleteUserNotificationStateStmts(
  db: D1Database,
  userId: string,
): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM fcm_tokens WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(userId),
    db
      .prepare(
        "UPDATE notification_settings SET quiet_hours_updated_by = NULL WHERE quiet_hours_updated_by = ? AND user_id <> ?",
      )
      .bind(userId, userId),
    db.prepare("DELETE FROM notification_settings WHERE user_id = ?").bind(userId),
    db
      .prepare(
        `DELETE FROM pending_notifications
          WHERE CASE
            WHEN json_valid(data) THEN COALESCE(json_extract(data,'$.targetUserId'),'')
            ELSE ''
          END = ?`,
      )
      .bind(userId),
  ];
}
