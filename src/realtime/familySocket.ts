/**
 * 가족 Realtime WebSocket 클라이언트(hyeni-1 realtime/familySocket.js 이관).
 * 연결: {wsBase}/realtime?family_id=..&token=..  → FamilyRoom Durable Object
 * 수신: { kind:"pg", table, eventType, new, old } | { kind:"broadcast", event, payload }
 * 송신: { kind:"broadcast", event, payload } | "ping"
 * 자동 재연결(지수 백오프) + 30s ping + 연결 전 send 버퍼링.
 */
import { API_BASE } from "@/config/env";

const PING_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

export type FamilyMessage =
  | { kind: "pg"; table: string; eventType: string; new?: unknown; old?: unknown }
  | { kind: "broadcast"; event: string; payload?: unknown };

export interface FamilySocket {
  send: (data: unknown) => void;
  close: () => void;
}

function wsUrl(familyId: string, token: string): string {
  const base = API_BASE.replace(/^http/, "ws"); // http→ws, https→wss
  return `${base}/realtime?family_id=${encodeURIComponent(familyId)}&token=${encodeURIComponent(token)}`;
}

/**
 * @param getToken 재연결마다 최신 access token 을 읽기 위해 함수로 받음(만료 대응).
 * @param onMessage 파싱된 메시지 콜백.
 */
export function openFamilySocket(
  familyId: string,
  getToken: () => string | null,
  onMessage: (msg: FamilyMessage) => void,
): FamilySocket {
  let ws: WebSocket | null = null;
  let disposed = false;
  let retry = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const queue: string[] = []; // 연결 전 송신 버퍼

  function flush(): void {
    while (queue.length && ws && ws.readyState === WebSocket.OPEN) {
      const next = queue.shift();
      if (next !== undefined) ws.send(next);
    }
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer) return;
    const delay = Math.min(2000 * Math.pow(2, retry++), MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (disposed) return;
    const token = getToken();
    if (!token) {
      scheduleReconnect();
      return;
    }
    try {
      ws = new WebSocket(wsUrl(familyId, token));
    } catch (e) {
      console.warn("[familySocket] connect failed", e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      retry = 0;
      flush();
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

  function send(data: unknown): void {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(s);
    else queue.push(s);
  }

  function close(): void {
    disposed = true;
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      ws?.close();
    } catch {
      /* ignored */
    }
  }

  connect();
  return { send, close };
}
