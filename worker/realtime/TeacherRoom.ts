// 선생님 Realtime 룸 (Supabase Realtime 대체). idFromName(teacherId)로 선생님당 1 인스턴스.
// teacher_notification_batches 는 teacher_id 키(가족 무관)라 FamilyRoom(family_id)으로는
// 격리가 안 맞는다 → 선생님 전용 룸으로 분리. FamilyRoom 과 동일 패턴(클론)이다.
// WebSocket Hibernation API 사용 — 유휴 시 메모리 evict, 메시지 도착 시 재개(비용 절감).
//
// 두 입력 경로:
//   1. WS upgrade (클라 구독)           — index.ts /realtime 가 인증 후 위임
//   2. POST /notify (cron 적재 통지)     — 묶음 INSERT 를 구독 클라에 fan-out
//
// 메시지 종류(클라 teacherSocket 이 분기):
//   { kind: "pg", table, eventType, new, old }   ← postgres_changes 대체
import type { Env } from "../types";
import { getMyTeacherId } from "../db/authz.ts";
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

interface TeacherSocketAttachment {
  tokenExp?: unknown;
}

export class TeacherRoom {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1) cron 적재 라우트 → 변경 통지 → 구독 클라에 fan-out
    if (request.method === "POST" && url.pathname === "/notify") {
      const body = await request.text();
      this.broadcast(body, null);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/ticket") {
      const parsed = parseRealtimeTicketStoreRequest(request);
      if (!parsed || parsed.ticket.role !== "teacher") {
        return new Response("invalid_ticket", { status: 400 });
      }
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
      if (!ticket || ticket.role !== "teacher") {
        return new Response("invalid_or_used_ticket", { status: 401 });
      }
      const teacherId = url.searchParams.get("teacher_id")?.trim() ?? "";
      try {
        const ownTeacherId = await getMyTeacherId(this.env.DB, ticket.userId);
        if (!ownTeacherId || ownTeacherId !== teacherId) {
          return new Response("teacher_membership_required", { status: 403 });
        }
      } catch {
        return new Response("teacher_membership_unavailable", { status: 503 });
      }
      const userTag = `user:${ticket.userId}`;
      // membership 조회 이후에는 await 없이 만료 socket 정리→상한 검사→accept를
      // 같은 DO 요청에서 연속 수행해 FamilyRoom과 같은 상한 계약을 지킨다.
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
      server.serializeAttachment({ tokenExp: ticket.tokenExp } satisfies TeacherSocketAttachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not_found", { status: 404 });
  }

  // 클라가 보낸 메시지 — teacher 룸은 클라 broadcast 발신을 쓰지 않는다.
  // ping 은 연결 유지용 — relay 하지 않는다. 그 외도 fan-out 대상은 cron 뿐이라 relay.
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const text = typeof message === "string" ? message : "";
    if (this.isExpired(ws)) {
      this.closeSocket(ws, "token_expired");
      return;
    }
    if (text === "ping") return;
    this.closeSocket(ws, "client_messages_not_allowed");
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "error");
    } catch {
      /* already closed */
    }
  }

  // 모든 구독 WebSocket 으로 data 전송. exclude(발신자)는 건너뛴다.
  private broadcast(data: string, exclude: WebSocket | null): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
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
