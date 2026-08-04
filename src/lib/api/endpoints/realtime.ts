import { apiPost } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

export interface RealtimeConnectionTicket {
  ticket: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export function parseRealtimeConnectionTicket(value: unknown): RealtimeConnectionTicket {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const ticket = typeof row?.ticket === "string" ? row.ticket.trim() : "";
  const expiresAt = typeof row?.expires_at === "string" ? row.expires_at.trim() : "";
  const expiresInSeconds = typeof row?.expires_in === "number" ? row.expires_in : Number.NaN;
  if (
    ticket.length < 80
    || ticket.length > 2_048
    || ticket.split(".").length !== 3
    || !Number.isFinite(Date.parse(expiresAt))
    || !Number.isSafeInteger(expiresInSeconds)
    || Number(expiresInSeconds) < 1
    || Number(expiresInSeconds) > 45
  ) {
    throw new ApiError("invalid_realtime_ticket_response", 502);
  }
  return { ticket, expiresAt, expiresInSeconds: Number(expiresInSeconds) };
}

export async function createFamilyRealtimeTicket(
  familyId: string,
  signal?: AbortSignal,
): Promise<RealtimeConnectionTicket> {
  const normalizedFamilyId = familyId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedFamilyId)) {
    throw new ApiError("invalid_realtime_family", 400);
  }
  const response = await apiPost<unknown>(
    "/api/realtime/ticket",
    { familyId: normalizedFamilyId },
    { signal },
  );
  return parseRealtimeConnectionTicket(response);
}
