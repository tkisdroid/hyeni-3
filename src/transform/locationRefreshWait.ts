import type { ChildLocation } from "@/lib/api/endpoints/location";
import { hasNewerLocationUpdate } from "./locationView.ts";

export const LOCATION_REFRESH_POLL_MS = 2_500;
// FCM TTL 120초 + native 전체 측위/업로드 상한 85초 + 마지막 조회 여유를 함께 관찰한다.
export const LOCATION_REFRESH_TIMEOUT_MS = 215_000;

export type LocationRefreshWaitResult = "updated" | "timeout" | "error" | "cancelled";

interface RefetchResult {
  isError: boolean;
  data: ChildLocation[] | undefined;
}

type RefetchWaitOutcome =
  | { kind: "result"; value: RefetchResult }
  | { kind: "timeout" }
  | { kind: "cancelled" };

async function waitForRefetchWithinDeadline({
  refetch,
  isCancelled,
  sleep,
  now,
  deadline,
}: {
  refetch: () => Promise<RefetchResult>;
  isCancelled: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  deadline: number;
}): Promise<RefetchWaitOutcome> {
  const pending = refetch().then(
    (value) => ({ kind: "result" as const, value }),
    () => ({ kind: "result" as const, value: { isError: true, data: undefined } }),
  );
  while (now() < deadline) {
    if (isCancelled()) return { kind: "cancelled" };
    const remainingMs = Math.max(1, deadline - now());
    const outcome = await Promise.race([
      pending,
      sleep(Math.min(250, remainingMs)).then(() => ({ kind: "tick" as const })),
    ]);
    if (outcome.kind === "result") return outcome;
  }
  return isCancelled() ? { kind: "cancelled" } : { kind: "timeout" };
}

export async function waitForNewChildLocation({
  before,
  targetUserId,
  refetch,
  isCancelled = () => false,
  sleep = (ms) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = LOCATION_REFRESH_TIMEOUT_MS,
  pollMs = LOCATION_REFRESH_POLL_MS,
}: {
  before: Pick<ChildLocation, "updated_at"> | null | undefined;
  targetUserId: string;
  refetch: () => Promise<RefetchResult>;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<LocationRefreshWaitResult> {
  const deadline = now() + timeoutMs;
  let hadSuccessfulRead = false;

  while (now() < deadline) {
    if (isCancelled()) return "cancelled";
    await sleep(Math.min(pollMs, Math.max(1, deadline - now())));
    if (isCancelled()) return "cancelled";
    if (now() >= deadline) break;
    const refetchOutcome = await waitForRefetchWithinDeadline({
      refetch,
      isCancelled,
      sleep,
      now,
      deadline,
    });
    if (refetchOutcome.kind === "cancelled") return "cancelled";
    if (refetchOutcome.kind === "timeout") return "timeout";
    const result = refetchOutcome.value;
    if (result.isError) continue;
    hadSuccessfulRead = true;
    const after = result.data?.find((location) => location.user_id === targetUserId) ?? null;
    if (hasNewerLocationUpdate(before, after)) return "updated";
  }

  return hadSuccessfulRead ? "timeout" : "error";
}
