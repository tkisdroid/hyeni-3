// 가족 Realtime 룸 (Supabase Realtime 대체). idFromName(familyId)로 가족당 1 인스턴스.
// WebSocket Hibernation API 사용 — 유휴 시 메모리 evict, 메시지 도착 시 재개(비용 절감).
//
// 두 입력 경로:
//   1. WS upgrade (클라 구독)           — index.ts /realtime 가 인증 후 위임
//   2. POST /notify (write 라우트 통지)  — DB 변경을 구독 클라에 fan-out
//
// 두 메시지 종류(클라 familySocket 이 분기):
//   { kind: "pg", table, eventType, new, old }   ← postgres_changes 대체
//   { kind: "broadcast", event, payload }         ← Supabase broadcast 대체(.send())
//
// 클라 송신은 ping만 허용한다. 모든 데이터 fan-out은 Worker가 계산한 user audience가 필수다.
import type { Env } from "../types";
import { resolveVerifiedFamilyMembership } from "../db/authz.ts";
import {
  closeExpiredRealtimeSocketsAndCount,
  consumeRealtimeTicket,
  isRealtimeSocketTokenExpired,
  parseRealtimeTicketStoreRequest,
  REALTIME_SOCKET_RETRY_AFTER_SECONDS,
  realtimeTicketCapacityRetryAfter,
  realtimeSocketCapacityExceeded,
  storeRealtimeTicket,
} from "../lib/realtimeTicket.ts";

interface FamilyRoomNotifyMessage {
  kind?: unknown;
  event?: unknown;
  payload?: unknown;
  targetUserId?: unknown;
  targetUserIds?: unknown;
  [key: string]: unknown;
}

interface FamilySocketAttachment {
  userId?: unknown;
  tokenExp?: unknown;
}

export class FamilyRoom {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1) write 라우트 → 변경 통지 → 구독 클라에 fan-out
    if (request.method === "POST" && url.pathname === "/notify") {
      const body = await request.text();
      let parsed: FamilyRoomNotifyMessage | null = null;
      try {
        parsed = JSON.parse(body) as FamilyRoomNotifyMessage;
      } catch {
        return new Response("invalid_json", { status: 400 });
      }
      const targetUserIds = this.parseTargetUserIds(parsed);
      if (targetUserIds.length === 0) {
        return new Response("realtime_audience_required", { status: 403 });
      }
      const outbound = { ...parsed };
      delete outbound.targetUserId;
      delete outbound.targetUserIds;
      this.broadcastToUsers(JSON.stringify(outbound), targetUserIds);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/revoke-user") {
      let userId = "";
      try {
        const body = await request.json<{ userId?: unknown }>();
        userId = typeof body.userId === "string" ? body.userId.trim() : "";
      } catch {
        return new Response("invalid_json", { status: 400 });
      }
      if (!userId) return new Response("user_required", { status: 400 });
      for (const ws of this.state.getWebSockets(`user:${userId}`)) {
        this.closeSocket(ws, "membership_revoked");
      }
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/ticket") {
      const parsed = parseRealtimeTicketStoreRequest(request);
      if (!parsed) return new Response("invalid_ticket", { status: 400 });
      try {
        await storeRealtimeTicket(this.state.storage, parsed.ticketId, parsed.ticket);
        return new Response(null, { status: 204 });
      } catch (error) {
        const retryAfterSeconds = realtimeTicketCapacityRetryAfter(error);
        if (retryAfterSeconds !== null) {
          return new Response("realtime_ticket_capacity", {
            status: 429,
            headers: { "Retry-After": String(retryAfterSeconds) },
          });
        }
        return new Response("ticket_store_failed", { status: 503 });
      }
    }

    // 2) 클라 WebSocket 구독 (Hibernation)
    if (request.headers.get("Upgrade") === "websocket") {
      const ticketId = request.headers.get("x-hyeni-ticket-id")?.trim() ?? "";
      const ticket = await consumeRealtimeTicket(this.state.storage, ticketId);
      if (!ticket) return new Response("invalid_or_used_ticket", { status: 401 });
      const familyId = url.searchParams.get("family_id")?.trim() ?? "";
      try {
        const membership = await resolveVerifiedFamilyMembership(this.env.DB, ticket.userId, familyId);
        if (!membership) return new Response("membership_required", { status: 403 });
      } catch {
        return new Response("membership_unavailable", { status: 503 });
      }
      const userTag = `user:${ticket.userId}`;
      // membership 조회 이후에는 await 없이 만료 socket 정리→상한 검사→accept를
      // 같은 DO 요청에서 연속 수행해 병렬 ticket 소비로 상한을 넘지 못하게 한다.
      const activeSockets = closeExpiredRealtimeSocketsAndCount(
        this.state.getWebSockets(),
        this.state.getWebSockets(userTag),
      );
      const socketCapacity = realtimeSocketCapacityExceeded(
        activeSockets.activeRoomSockets,
        activeSockets.activeUserSockets,
      );
      if (socketCapacity) {
        return new Response(`realtime_socket_${socketCapacity}_capacity`, {
          status: 429,
          headers: { "Retry-After": String(REALTIME_SOCKET_RETRY_AFTER_SECONDS) },
        });
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server, [userTag]);
      server.serializeAttachment({
        userId: ticket.userId,
        tokenExp: ticket.tokenExp,
      } satisfies FamilySocketAttachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not_found", { status: 404 });
  }

  // 클라이언트는 연결 유지 ping만 보낼 수 있다. 데이터 fan-out은 인증·검증을 마친
  // Worker의 /notify 경로만 수행해 family socket을 임의 주입 통로로 쓰지 못하게 한다.
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const text = typeof message === "string" ? message : "";
    if (this.isExpired(ws)) {
      this.closeSocket(ws, "token_expired");
      return;
    }
    if (text === "ping") return;
    try {
      ws.close(1008, "client_messages_not_allowed");
    } catch {
      /* already closed */
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "error");
    } catch {
      /* already closed */
    }
  }

  private parseTargetUserIds(message: FamilyRoomNotifyMessage): string[] {
    const candidates = Array.isArray(message.targetUserIds)
      ? message.targetUserIds
      : [message.targetUserId];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const value of candidates) {
      if (typeof value !== "string") continue;
      const userId = value.trim();
      if (!userId || userId.length > 128 || seen.has(userId)) continue;
      seen.add(userId);
      ids.push(userId);
      if (ids.length >= 64) break;
    }
    return ids;
  }

  private broadcastToUsers(data: string, userIds: string[]): void {
    const delivered = new Set<WebSocket>();
    for (const userId of userIds) {
      for (const ws of this.state.getWebSockets(`user:${userId}`)) {
        if (delivered.has(ws)) continue;
        delivered.add(ws);
        if (this.isExpired(ws)) {
          this.closeSocket(ws, "token_expired");
          continue;
        }
        try {
          ws.send(data);
        } catch {
          // 끊긴 소켓은 무시 — Hibernation 이 정리한다.
        }
      }
    }
  }

  private isExpired(ws: WebSocket): boolean {
    return isRealtimeSocketTokenExpired(ws);
  }

  private closeSocket(ws: WebSocket, reason: string): void {
    try {
      ws.close(1008, reason);
    } catch {
      /* already closed */
    }
  }

}
