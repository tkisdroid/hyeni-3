import type { AuthUser } from "../types";

export const REALTIME_TICKET_TTL_SECONDS = 45;
const REALTIME_TICKET_PREFIX = "realtime-ticket:";
const MAX_ACTIVE_TICKETS_PER_ROOM = 64;
export const MAX_ACTIVE_REALTIME_TICKETS_PER_USER = 8;
export const MAX_ACTIVE_REALTIME_SOCKETS_PER_ROOM = 64;
export const MAX_ACTIVE_REALTIME_SOCKETS_PER_USER = 8;
export const REALTIME_SOCKET_RETRY_AFTER_SECONDS = 30;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TICKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RealtimeTargetKind = "family" | "teacher";

export interface StoredRealtimeTicket {
  userId: string;
  role: AuthUser["role"];
  tokenExp: number;
  ticketExp: number;
}

export interface RealtimeTicketRequestBody {
  familyId?: unknown;
  teacherId?: unknown;
}

type RealtimeTicketStoreFailure =
  | { status: 429; error: "realtime_ticket_rate_limited"; retryAfterSeconds: number }
  | { status: 503; error: "realtime_ticket_unavailable" };

class RealtimeTicketCapacityError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("realtime_ticket_capacity");
    this.name = "RealtimeTicketCapacityError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isRealtimeTicketRequestBody(value: unknown): value is RealtimeTicketRequestBody {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseRealtimeTicketStoreRequest(
  request: Request,
): { ticketId: string; ticket: StoredRealtimeTicket } | null {
  const ticketId = normalizeRealtimeTicketId(request.headers.get("x-hyeni-ticket-id"));
  const userId = request.headers.get("x-hyeni-user-id")?.trim() ?? "";
  const role = request.headers.get("x-hyeni-user-role")?.trim() as AuthUser["role"];
  const tokenExp = Number(request.headers.get("x-hyeni-token-exp"));
  const ticketExp = Number(request.headers.get("x-hyeni-ticket-exp"));
  const ticket = { userId, role, tokenExp, ticketExp };
  return ticketId && validStoredTicket(ticket) ? { ticketId, ticket } : null;
}

export function normalizeRealtimeTargetId(value: unknown): string | null {
  const targetId = typeof value === "string" ? value.trim() : "";
  return TARGET_ID_PATTERN.test(targetId) ? targetId : null;
}

export function normalizeRealtimeTicketId(value: unknown): string | null {
  const ticketId = typeof value === "string" ? value.trim() : "";
  return TICKET_ID_PATTERN.test(ticketId) ? ticketId.toLowerCase() : null;
}

export function realtimeTicketCapacityRetryAfter(error: unknown): number | null {
  return error instanceof RealtimeTicketCapacityError ? error.retryAfterSeconds : null;
}

/** 미소비 ticket 제한을 소비해 우회해도 실제 DO 연결 수가 무한히 늘지 않게 한다. */
export function realtimeSocketCapacityExceeded(
  activeRoomSockets: number,
  activeUserSockets: number,
): "room" | "user" | null {
  if (!Number.isSafeInteger(activeRoomSockets) || activeRoomSockets < 0) return "room";
  if (!Number.isSafeInteger(activeUserSockets) || activeUserSockets < 0) return "user";
  if (activeUserSockets >= MAX_ACTIVE_REALTIME_SOCKETS_PER_USER) return "user";
  if (activeRoomSockets >= MAX_ACTIVE_REALTIME_SOCKETS_PER_ROOM) return "room";
  return null;
}

interface RealtimeSocketAttachment {
  tokenExp?: unknown;
}

export function isRealtimeSocketTokenExpired(
  socket: WebSocket,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return true;
  try {
    const attachment = socket.deserializeAttachment() as RealtimeSocketAttachment | null;
    const tokenExp = attachment?.tokenExp;
    return typeof tokenExp !== "number"
      || !Number.isSafeInteger(tokenExp)
      || tokenExp <= nowSeconds;
  } catch {
    return true;
  }
}

/**
 * Hibernation 저장소의 만료·손상 socket은 닫고 상한 계산에서 제외한다.
 * 호출부는 이 함수 반환 뒤 await 없이 capacity 검사와 acceptWebSocket을 연속 수행해야 한다.
 */
export function closeExpiredRealtimeSocketsAndCount(
  roomSockets: readonly WebSocket[],
  userSockets: readonly WebSocket[],
  nowSeconds = Math.floor(Date.now() / 1000),
): { activeRoomSockets: number; activeUserSockets: number } {
  const socketsForUser = new Set(userSockets);
  let activeRoomSockets = 0;
  let activeUserSockets = 0;
  for (const socket of roomSockets) {
    if (isRealtimeSocketTokenExpired(socket, nowSeconds)) {
      try {
        socket.close(1008, "token_expired");
      } catch {
        /* already closed */
      }
      continue;
    }
    activeRoomSockets += 1;
    if (socketsForUser.has(socket)) activeUserSockets += 1;
  }
  return { activeRoomSockets, activeUserSockets };
}

export function resolveRealtimeTicketStoreFailure(response: Response): RealtimeTicketStoreFailure | null {
  if (response.ok) return null;
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    return {
      status: 429,
      error: "realtime_ticket_rate_limited",
      retryAfterSeconds: Number.isSafeInteger(retryAfter)
        && retryAfter >= 1
        && retryAfter <= REALTIME_TICKET_TTL_SECONDS
        ? retryAfter
        : REALTIME_TICKET_TTL_SECONDS,
    };
  }
  return { status: 503, error: "realtime_ticket_unavailable" };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function hashRealtimeTarget(
  kind: RealtimeTargetKind,
  targetId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}:${targetId}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function validStoredTicket(value: unknown): value is StoredRealtimeTicket {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredRealtimeTicket>;
  return typeof row.userId === "string"
    && TARGET_ID_PATTERN.test(row.userId)
    && ["parent", "child", "teacher", "anonymous"].includes(String(row.role))
    && Number.isSafeInteger(row.tokenExp)
    && Number.isSafeInteger(row.ticketExp)
    && Number(row.ticketExp) <= Number(row.tokenExp);
}

export async function storeRealtimeTicket(
  storage: DurableObjectStorage,
  ticketId: string,
  ticket: StoredRealtimeTicket,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  const normalizedId = normalizeRealtimeTicketId(ticketId);
  if (!normalizedId || !validStoredTicket(ticket) || ticket.ticketExp <= nowSeconds) {
    throw new Error("invalid_realtime_ticket");
  }

  await storage.transaction(async (txn) => {
    const rows = await txn.list<StoredRealtimeTicket>({
      prefix: REALTIME_TICKET_PREFIX,
      limit: MAX_ACTIVE_TICKETS_PER_ROOM * 2,
    });
    const expired: string[] = [];
    let active = 0;
    let activeForUser = 0;
    let earliestActiveExpiry = Number.POSITIVE_INFINITY;
    let earliestUserExpiry = Number.POSITIVE_INFINITY;
    for (const [key, value] of rows) {
      if (!validStoredTicket(value) || value.ticketExp <= nowSeconds) expired.push(key);
      else {
        active += 1;
        earliestActiveExpiry = Math.min(earliestActiveExpiry, value.ticketExp);
        if (value.userId === ticket.userId) {
          activeForUser += 1;
          earliestUserExpiry = Math.min(earliestUserExpiry, value.ticketExp);
        }
      }
    }
    if (expired.length > 0) await txn.delete(expired);
    if (activeForUser >= MAX_ACTIVE_REALTIME_TICKETS_PER_USER) {
      throw new RealtimeTicketCapacityError(Math.max(1, earliestUserExpiry - nowSeconds));
    }
    if (active >= MAX_ACTIVE_TICKETS_PER_ROOM) {
      throw new RealtimeTicketCapacityError(Math.max(1, earliestActiveExpiry - nowSeconds));
    }
    await txn.put(`${REALTIME_TICKET_PREFIX}${normalizedId}`, ticket);
  });
}

export async function consumeRealtimeTicket(
  storage: DurableObjectStorage,
  ticketId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<StoredRealtimeTicket | null> {
  const normalizedId = normalizeRealtimeTicketId(ticketId);
  if (!normalizedId) return null;
  return storage.transaction(async (txn) => {
    const key = `${REALTIME_TICKET_PREFIX}${normalizedId}`;
    const value = await txn.get<StoredRealtimeTicket>(key);
    if (value !== undefined) await txn.delete(key);
    if (!validStoredTicket(value) || value.ticketExp <= nowSeconds) return null;
    return value;
  });
}
