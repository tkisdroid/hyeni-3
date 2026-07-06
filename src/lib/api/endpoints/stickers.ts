/**
 * 스티커(칭찬) 도메인 엔드포인트.
 * hyeni-1 worker/routes/stickers.ts 의 read 3종 + write 1종 이관.
 *   GET  /api/stickers/summary   — 사용자별 집계(GROUP BY user_id)
 *   GET  /api/stickers/received  — 특정 사용자가 받은 칭찬 스티커(praise/early/on_time)
 *   GET  /api/stickers/date      — 특정 날짜의 스티커
 *   POST /api/stickers           — 스티커 전송(부모→자녀 praise / 자녀→본인 early·on_time·late)
 */
import { apiGet, apiPost } from "../client";

/** 사용자별 스티커 집계(전체 기간). user_id 당 1행. */
export interface StickerSummaryRow {
  user_id: string;
  total_count: number;
  early_count: number;
  on_time_count: number;
  late_count: number;
}

/** 받은 칭찬 스티커 1건. earned_at 내림차순. */
export interface ReceivedSticker {
  id: string;
  emoji: string;
  title: string;
  sticker_type: string; // "praise" | "early" | "on_time" 등
  date_key: string;
  earned_at: string;
}

/** 특정 날짜에 붙은 스티커 1건. */
export interface StickerOnDate {
  id: string;
  user_id: string;
  event_id: string | null;
  sticker_type: string;
  emoji: string;
  title: string;
  earned_at: string;
}

/** 전송 body(POST /api/stickers). */
export interface NewSticker {
  user_id: string;
  family_id: string;
  event_id: string;
  date_key: string;
  sticker_type: string;
  emoji: string;
  title: string;
}

/** 가족 스티커 집계(사용자별). */
export function fetchStickerSummary(familyId: string): Promise<StickerSummaryRow[]> {
  return apiGet<StickerSummaryRow[]>(
    `/api/stickers/summary?family_id=${encodeURIComponent(familyId)}`,
  );
}

/** 특정 사용자가 받은 칭찬 스티커 목록. */
export function fetchReceivedStickers(
  familyId: string,
  userId: string,
): Promise<ReceivedSticker[]> {
  return apiGet<ReceivedSticker[]>(
    `/api/stickers/received?family_id=${encodeURIComponent(familyId)}&user_id=${encodeURIComponent(userId)}`,
  );
}

/** 특정 날짜의 스티커 목록. */
export function fetchStickersByDate(familyId: string, dateKey: string): Promise<StickerOnDate[]> {
  return apiGet<StickerOnDate[]>(
    `/api/stickers/date?family_id=${encodeURIComponent(familyId)}&date_key=${encodeURIComponent(dateKey)}`,
  );
}

/** 스티커 전송. 서버가 role 기반 권한 + (user_id,event_id,sticker_type) dedup 수행. */
export function sendSticker(input: NewSticker): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/api/stickers", input);
}
