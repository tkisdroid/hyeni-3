export const LOCATION_HISTORY_INGEST_USAGE_RETENTION_DAYS = 35;
export const LOCATION_HISTORY_INGEST_USAGE_DELETE_BATCH = 5_000;

function kstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

export async function cleanupLocationHistoryIngestDailyUsage(
  db: D1Database,
  now = new Date(),
): Promise<{ removedRows: number }> {
  const cutoff = kstDateKey(new Date(
    now.getTime() - LOCATION_HISTORY_INGEST_USAGE_RETENTION_DAYS * 24 * 60 * 60_000,
  ));
  const result = await db.prepare(
    `DELETE FROM location_history_ingest_daily_usage
      WHERE rowid IN (
        SELECT rowid FROM location_history_ingest_daily_usage
         WHERE date_key<? ORDER BY date_key ASC,user_id ASC LIMIT ?
      )`,
  ).bind(cutoff, LOCATION_HISTORY_INGEST_USAGE_DELETE_BATCH).run();
  return { removedRows: Number(result.meta?.changes ?? 0) };
}
