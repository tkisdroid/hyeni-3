const SAFE_ASCII_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const MEMO_INTERACTION_LEASE_TTL_MS = 120_000;
export const MEMO_DELIVERY_NETWORK_DEADLINE_MS = 90_000;

export interface MemoInteractionPair {
  familyId: string;
  userAId: string;
  userBId: string;
}

export interface MemoInteractionLease extends MemoInteractionPair {
  leaseToken: string;
  expiresAt: string;
}

export type MemoInteractionLeaseResult =
  | { status: "acquired"; lease: MemoInteractionLease }
  | { status: "busy" | "unavailable" };

export type MemoInteractionLeasesResult =
  | { status: "acquired"; leases: MemoInteractionLease[] }
  | { status: "busy" | "unavailable"; leases: [] };

export function canonicalizeMemoInteractionPair(
  familyIdValue: string,
  userIdValue: string,
  peerUserIdValue: string,
): MemoInteractionPair | null {
  const familyId = String(familyIdValue ?? "").trim();
  const userId = String(userIdValue ?? "").trim();
  const peerUserId = String(peerUserIdValue ?? "").trim();
  if (
    !SAFE_ASCII_ID.test(familyId)
    || !SAFE_ASCII_ID.test(userId)
    || !SAFE_ASCII_ID.test(peerUserId)
    || userId === peerUserId
  ) {
    return null;
  }
  const [userAId, userBId] = userId < peerUserId
    ? [userId, peerUserId]
    : [peerUserId, userId];
  return { familyId, userAId, userBId };
}

export async function acquireMemoInteractionLease(
  db: D1Database,
  input: {
    familyId: string;
    userId: string;
    peerUserId: string;
    now?: Date;
  },
): Promise<MemoInteractionLeaseResult> {
  const pair = canonicalizeMemoInteractionPair(input.familyId, input.userId, input.peerUserId);
  if (!pair) return { status: "unavailable" };
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseToken = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + MEMO_INTERACTION_LEASE_TTL_MS).toISOString();
  try {
    const row = await db
      .prepare(
        `INSERT INTO memo_interaction_leases
           (family_id,user_a_id,user_b_id,lease_token,expires_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(family_id,user_a_id,user_b_id) DO UPDATE SET
           lease_token=excluded.lease_token,
           expires_at=excluded.expires_at,
           created_at=excluded.created_at,
           updated_at=excluded.updated_at
         WHERE memo_interaction_leases.expires_at<=?
         RETURNING lease_token`,
      )
      .bind(
        pair.familyId,
        pair.userAId,
        pair.userBId,
        leaseToken,
        expiresAt,
        nowIso,
        nowIso,
        nowIso,
      )
      .first<{ lease_token: string }>();
    if (row?.lease_token !== leaseToken) return { status: "busy" };
    return {
      status: "acquired",
      lease: { ...pair, leaseToken, expiresAt },
    };
  } catch (error) {
    console.error("[memo-interaction-lease] acquire failed");
    return { status: "unavailable" };
  }
}

export async function releaseMemoInteractionLease(
  db: D1Database,
  lease: MemoInteractionLease,
): Promise<boolean> {
  const pair = canonicalizeMemoInteractionPair(lease.familyId, lease.userAId, lease.userBId);
  if (!pair || !SAFE_ASCII_ID.test(lease.leaseToken)) return false;
  const result = await db
    .prepare(
      `DELETE FROM memo_interaction_leases
        WHERE family_id=? AND user_a_id=? AND user_b_id=? AND lease_token=?`,
    )
    .bind(pair.familyId, pair.userAId, pair.userBId, lease.leaseToken)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function releaseMemoInteractionLeases(
  db: D1Database,
  leases: ReadonlyArray<MemoInteractionLease>,
): Promise<void> {
  for (const lease of [...leases].reverse()) {
    try {
      await releaseMemoInteractionLease(db, lease);
    } catch (error) {
      console.error("[memo-interaction-lease] release failed");
    }
  }
}

export async function acquireMemoInteractionLeases(
  db: D1Database,
  input: {
    familyId: string;
    senderUserId: string;
    recipientUserIds: Iterable<string>;
    now?: Date;
  },
): Promise<MemoInteractionLeasesResult> {
  const pairs = new Map<string, MemoInteractionPair>();
  for (const recipientUserId of input.recipientUserIds) {
    if (recipientUserId === input.senderUserId) continue;
    const pair = canonicalizeMemoInteractionPair(
      input.familyId,
      input.senderUserId,
      recipientUserId,
    );
    if (!pair) return { status: "unavailable", leases: [] };
    pairs.set(`${pair.familyId}\u0000${pair.userAId}\u0000${pair.userBId}`, pair);
  }
  const orderedPairs = [...pairs.values()].sort((left, right) => {
    const leftKey = `${left.familyId}\u0000${left.userAId}\u0000${left.userBId}`;
    const rightKey = `${right.familyId}\u0000${right.userAId}\u0000${right.userBId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const leases: MemoInteractionLease[] = [];
  for (const pair of orderedPairs) {
    const result = await acquireMemoInteractionLease(db, {
      familyId: pair.familyId,
      userId: pair.userAId,
      peerUserId: pair.userBId,
      now: input.now,
    });
    if (result.status === "acquired") {
      leases.push(result.lease);
      continue;
    }
    await releaseMemoInteractionLeases(db, leases);
    return { status: result.status, leases: [] };
  }
  return { status: "acquired", leases };
}

export async function loadUnblockedMemoRecipientIds(
  db: D1Database,
  input: {
    familyId: string;
    senderUserId: string;
    recipientUserIds: Iterable<string>;
  },
): Promise<string[]> {
  const recipients = [...new Set(
    [...input.recipientUserIds]
      .map((recipientUserId) => String(recipientUserId ?? "").trim())
      .filter((recipientUserId) => recipientUserId && recipientUserId !== input.senderUserId),
  )].sort();
  if (
    !SAFE_ASCII_ID.test(input.familyId)
    || !SAFE_ASCII_ID.test(input.senderUserId)
    || recipients.some((recipientUserId) => !SAFE_ASCII_ID.test(recipientUserId))
  ) {
    throw new Error("invalid_memo_interaction_scope");
  }
  if (recipients.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT blocker_user_id,blocked_user_id
         FROM user_interaction_blocks
        WHERE family_id=?
          AND (blocker_user_id=? OR blocked_user_id=?)`,
    )
    .bind(input.familyId, input.senderUserId, input.senderUserId)
    .all<{ blocker_user_id: string; blocked_user_id: string }>();
  const blockedPeerIds = new Set<string>();
  for (const row of results ?? []) {
    if (row.blocker_user_id === input.senderUserId) blockedPeerIds.add(row.blocked_user_id);
    if (row.blocked_user_id === input.senderUserId) blockedPeerIds.add(row.blocker_user_id);
  }
  return recipients.filter((recipientUserId) => !blockedPeerIds.has(recipientUserId));
}

export async function cleanupExpiredMemoInteractionLeases(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM memo_interaction_leases WHERE expires_at<=?")
    .bind(now.toISOString())
    .run();
  return Number(result.meta?.changes ?? 0);
}
