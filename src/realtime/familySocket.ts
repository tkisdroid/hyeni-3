/**
 * 가족 Realtime WebSocket 클라이언트(hyeni-1 realtime/familySocket.js 이관).
 * 연결: Authorization POST로 1회용 ticket 발급 → {wsBase}/realtime?family_id=..&ticket=..
 *       → FamilyRoom Durable Object
 * 수신: { kind:"pg", table, eventType, new, old } | { kind:"broadcast", event, payload }
 * 송신: 연결 유지용 "ping"만 허용한다. 데이터 fan-out은 인증된 Worker 경로 전용이다.
 * 자동 재연결(지수 백오프) + 30s ping.
 */
import { API_BASE } from "@/config/env";
import { createFamilyRealtimeTicket } from "@/lib/api/endpoints/realtime";
import {
  createBoundedRealtimeTicketRequest,
  type BoundedRealtimeTicketRequest,
} from "./realtimeTicketRequest";

const PING_MS = 30_000;
const RECONNECT_BASE_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const TICKET_TIMEOUT_MS = 10_000;

export type FamilyMessage =
  | { kind: "pg"; table: string; eventType: string; new?: unknown; old?: unknown }
  | { kind: "broadcast"; event: string; payload?: unknown };

export interface FamilySocket {
  close: () => void;
}

export interface FamilySocketOptions {
  ticketTimeoutMs?: number;
  reconnectBaseMs?: number;
  maxBackoffMs?: number;
}

function positiveMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

export function familySocketUrl(familyId: string, ticket: string): string {
  const base = API_BASE.replace(/^http/, "ws"); // http→ws, https→wss
  return `${base}/realtime?family_id=${encodeURIComponent(familyId)}&ticket=${encodeURIComponent(ticket)}`;
}

/**
 * @param onMessage 파싱된 메시지 콜백.
 */
export function openFamilySocket(
  familyId: string,
  onMessage: (msg: FamilyMessage) => void,
  options: FamilySocketOptions = {},
): FamilySocket {
  let ws: WebSocket | null = null;
  let disposed = false;
  let retry = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connecting = false;
  let activeTicketRequest: BoundedRealtimeTicketRequest<Awaited<ReturnType<typeof createFamilyRealtimeTicket>>> | null = null;
  const ticketTimeoutMs = positiveMs(options.ticketTimeoutMs, TICKET_TIMEOUT_MS);
  const reconnectBaseMs = positiveMs(options.reconnectBaseMs, RECONNECT_BASE_MS);
  const maxBackoffMs = Math.max(
    reconnectBaseMs,
    positiveMs(options.maxBackoffMs, MAX_BACKOFF_MS),
  );

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer) return;
    const delay = Math.min(reconnectBaseMs * Math.pow(2, retry++), maxBackoffMs);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  async function connect(): Promise<void> {
    if (disposed || connecting) return;
    connecting = true;
    const ticketRequest = createBoundedRealtimeTicketRequest(
      (signal) => createFamilyRealtimeTicket(familyId, signal),
      ticketTimeoutMs,
    );
    activeTicketRequest = ticketRequest;
    try {
      const { ticket } = await ticketRequest.promise;
      if (disposed) return;
      ws = new WebSocket(familySocketUrl(familyId, ticket));
    } catch {
      console.warn("[familySocket] ticket connection failed");
      scheduleReconnect();
      return;
    } finally {
      if (activeTicketRequest === ticketRequest) activeTicketRequest = null;
      connecting = false;
    }

    ws.onopen = () => {
      retry = 0;
      pingTimer = setInterval(() => {
        try {
          ws?.send("ping");
        } catch {
          /* ignored */
        }
      }, PING_MS);
    };
    ws.onmessage = (e: MessageEvent) => {
      let msg: FamilyMessage;
      try {
        msg = JSON.parse(e.data as string) as FamilyMessage;
      } catch {
        return;
      }
      try {
        onMessage(msg);
      } catch (err) {
        console.warn("[familySocket] onMessage threw", err);
      }
    };
    ws.onclose = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (!disposed) scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignored */
      }
    };
  }

  function close(): void {
    disposed = true;
    activeTicketRequest?.abort();
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      ws?.close();
    } catch {
      /* ignored */
    }
  }

  void connect();
  return { close };
}
