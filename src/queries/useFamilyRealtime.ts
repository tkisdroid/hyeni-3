/**
 * 가족소켓(WS) 구독 → 수신 메시지의 table 에 따라 관련 queryKey 를 invalidate.
 * 인증된 셸에서 1회 마운트해 세션 동안 연결 유지. 토큰은 재연결마다 최신값을 읽는다.
 * (Slice 10에서 broadcast 이벤트·낙관적 업데이트까지 확장)
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { getApiAccessToken } from "@/lib/api/session";
import { openFamilySocket, type FamilyMessage } from "@/realtime/familySocket";
import { qk } from "./keys";

// pg 변경 table → invalidate 대상 queryKey 목록.
function keysForMessage(msg: FamilyMessage, familyId: string): (readonly unknown[])[] {
  if (msg.kind !== "pg") return [];
  switch (msg.table) {
    case "family_members":
    case "families":
      return [qk.family(familyId), qk.account(familyId)];
    case "events":
    case "events_children":
      return [qk.events(familyId)];
    case "academies":
      return [qk.academies(familyId)];
    case "daily_supplies":
      return [["dailySupplies", familyId]];
    case "memo_replies":
      return [["memoReplies", familyId]];
    case "child_locations":
      return [qk.childLocations(familyId)];
    case "saved_places":
      return [qk.savedPlaces(familyId)];
    case "danger_zones":
      return [qk.dangerZones(familyId)];
    case "parent_alerts":
      return [qk.parentAlerts(familyId)];
    case "family_subscriptions":
      return [qk.entitlement(familyId)];
    case "stickers":
      // 스티커 집계 + 받은목록. 수신자 userId 를 알 수 없어 received 프리픽스로 전체 무효화.
      return [qk.stickerSummary(familyId), ["stickers", "received", familyId]];
    default:
      return [];
  }
}

// 부모 앱을 즉시 가로채야 하는 최우선 안전 알림 유형.
const URGENT_ALERT_TYPES = new Set(["sos", "emergency"]);

function maybeCelebrateSticker(msg: FamilyMessage, role: string | null, userId: string | null): void {
  if (role !== "child" || !userId) return;
  if (msg.kind !== "pg" || msg.table !== "stickers" || msg.eventType !== "INSERT") return;
  const row = msg.new as { id?: string; user_id?: string; sticker_type?: string; emoji?: string; title?: string } | null | undefined;
  if (!row || row.user_id !== userId || row.sticker_type !== "praise") return;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("hy:sticker-celebration", {
      detail: {
        id: row.id,
        emoji: row.emoji,
        title: row.title,
      },
    }),
  );
}

/**
 * 부모에게 도착한 긴급 알림(SOS/emergency)이면 SOS 수신 화면으로 자동 전환한다.
 * WS 는 라우터 밖(App 최상위)에서 도므로 navigate 대신 HashRouter 해시를 직접 바꾼다.
 * 이미 수신 화면이면 재이동하지 않는다.
 */
function maybeInterruptForUrgentAlert(msg: FamilyMessage, role: string | null): void {
  if (role !== "parent") return;
  if (msg.kind !== "pg" || msg.table !== "parent_alerts" || msg.eventType !== "INSERT") return;
  const row = msg.new as { alert_type?: string } | null | undefined;
  if (!row || !URGENT_ALERT_TYPES.has(row.alert_type ?? "")) return;
  if (typeof window === "undefined") return;
  if (window.location.hash.includes("sos-receive")) return;
  window.location.hash = "#/sos-receive";
}

export function useFamilyRealtime(): void {
  const qc = useQueryClient();
  const { familyId, status, role, userId } = useAuth();

  useEffect(() => {
    if (status !== "authenticated" || !familyId) return;
    const socket = openFamilySocket(
      familyId,
      () => getApiAccessToken(),
      (msg) => {
        for (const key of keysForMessage(msg, familyId)) {
          qc.invalidateQueries({ queryKey: key });
        }
        maybeInterruptForUrgentAlert(msg, role);
        maybeCelebrateSticker(msg, role, userId);
      },
    );
    return () => socket.close();
  }, [familyId, status, role, userId, qc]);
}
