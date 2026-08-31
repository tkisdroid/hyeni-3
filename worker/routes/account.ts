// delete-account Edge Function 직역 — 계정/가족 영구 삭제.
//   POST /api/account/delete  ← auth.js deleteAccount
//
// 원본은 service_role + auth.admin.deleteUser + purge_family_data RPC 조합이었다.
// Worker 에는 GoTrue 가 없고 auth user 가 D1 users/auth_identities/refresh_tokens 에
// 있으므로, RPC(purge_family_data)와 admin 삭제를 D1 직접 삭제로 직역한다.
//
// 삭제 순서: R2 정리 → D1 데이터 청크 → 마지막 auth/family batch. R2 또는 D1이 실패하면
// auth user를 남겨 동일 호출자가 재시도할 수 있게 한다. family_id/user_id 테이블은 런타임
// introspection으로 잡고, member/teacher 간접 참조는 명시적으로 정리한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { deleteUserNotificationStateStmts } from "../lib/accountNotificationCleanup";
import { deleteUserContentSafetyStateStmts } from "../lib/contentSafety";
import {
  buildFamilyIndirectDeleteStmts,
  buildFamilyScopedDeleteStmts,
  buildMemberReferenceDeleteStmts,
  buildPgArrayReferenceCleanupStmts,
  buildTeacherGraphDeleteStmts,
  buildUserCreatedEventDeleteStmts,
  buildUserReferenceDeleteStmts,
  buildUserReferenceNullingStmts,
  collectChildPhotoKeys,
  collectRetainedChildPhotoKeys,
  cleanupMapRequestControlForAccountDeletion,
  deleteAccountPhotoObjects,
  listMembersForFamilies,
  listMembersForUsers,
  listTeacherIdsForUsers,
  runAccountDeletionBatches,
} from "../lib/accountDeletion";
import { revokeFamilyRealtimeUsers } from "../lib/realtime";
import {
  beginAccountDeletionClaim,
  claimManagedChildForAccountDeletion,
  completeAccountDeletionClaimStmts,
  hasIndependentManagedChildEvidence,
  markAccountDeletionFailure,
  releaseManagedChildAccountDeletionClaim,
} from "../lib/accountDeletionClaims";
import { revokeWebBillingBeforeAccountDeletion } from "../lib/webBillingService";

export { deleteUserNotificationStateStmts } from "../lib/accountNotificationCleanup";

const account = new Hono<{ Bindings: Env; Variables: Vars }>();

// auth user(D1) 삭제 statement 묶음 — refresh/identities/users.
function deleteAuthUserStmts(db: D1Database, uid: string): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM account_device_sessions WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM users WHERE id = ?").bind(uid),
  ];
}

function uniqueIds(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

async function deleteIdentityRateLimitStateStmts(
  db: D1Database,
  userIds: readonly string[],
): Promise<D1PreparedStatement[]> {
  if (userIds.length === 0) return [];
  const ph = userIds.map(() => "?").join(",");
  const { results: profileRows } = await db
    .prepare(`SELECT login_id FROM user_profiles WHERE user_id IN (${ph}) AND login_id IS NOT NULL`)
    .bind(...userIds)
    .all<{ login_id: string }>();
  const { results: userRows } = await db
    .prepare(`SELECT phone FROM users WHERE id IN (${ph}) AND phone IS NOT NULL`)
    .bind(...userIds)
    .all<{ phone: string }>();
  const loginIds = uniqueIds((profileRows ?? []).map((row) => row.login_id));
  const phones = uniqueIds((userRows ?? []).map((row) => row.phone));
  const statements: D1PreparedStatement[] = [];
  if (loginIds.length > 0) {
    statements.push(
      db.prepare(`DELETE FROM login_attempts WHERE login_id IN (${loginIds.map(() => "?").join(",")})`)
        .bind(...loginIds),
    );
  }
  if (phones.length > 0) {
    statements.push(
      db.prepare(`DELETE FROM phone_otp WHERE phone IN (${phones.map(() => "?").join(",")})`)
        .bind(...phones),
    );
  }
  return statements;
}

async function revokeDeletedRealtimeUsers(
  env: Env,
  familyIds: readonly string[],
  userIds: readonly string[],
): Promise<void> {
  for (const familyId of uniqueIds(familyIds)) {
    try {
      await revokeFamilyRealtimeUsers(env, familyId, userIds);
    } catch (error) {
      console.error("[account-delete] realtime revoke failed");
    }
  }
}

async function listHistoricalRefreshFamilyIds(db: D1Database, userId: string): Promise<string[]> {
  const familyIds: string[] = [];
  let cursor = "";
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT family_id
           FROM refresh_tokens
          WHERE user_id=? AND family_id IS NOT NULL AND family_id<>'' AND family_id>?
          ORDER BY family_id ASC
          LIMIT 64`,
      )
      .bind(userId, cursor)
      .all<{ family_id: string }>();
    const page = uniqueIds((results ?? []).map((row) => row.family_id));
    if (page.length === 0) break;
    familyIds.push(...page);
    cursor = page[page.length - 1]!;
    if (page.length < 64) break;
  }
  return uniqueIds(familyIds);
}

interface OwnedFamilyChildRow {
  user_id: string;
  is_active: number;
}

account.post("/delete", requireAuth, async (c) => {
  const db = c.env.DB;
  const callerId = c.get("user").sub;

  const claimResult = await beginAccountDeletionClaim(db, {
    ownerUserId: callerId,
  });
  if (claimResult.status === "conflict") {
    return c.json({ error: "account_deletion_conflict" }, 409);
  }
  if (claimResult.status !== "claimed") {
    return c.json({ error: "account_deletion_unavailable" }, 503);
  }
  const deletionClaim = claimResult.claim;
  if (deletionClaim.status === "completed") {
    return c.json({ ok: true, mode: deletionClaim.mode, alreadyDeleted: true });
  }
  const ownedFamilyIds = deletionClaim.familyIds;

  // 삭제 claim이 cron 신규 lease를 막은 뒤 Toss 자동결제 키를 먼저 폐기한다.
  // 404는 이미 폐기된 멱등 성공이며, 그 외 실패에서는 auth/family/R2 삭제를 시작하지 않는다.
  try {
    await revokeWebBillingBeforeAccountDeletion(c.env, {
      ownerUserId: callerId,
      familyIds: ownedFamilyIds,
    });
  } catch (error) {
    await markAccountDeletionFailure(db, deletionClaim.jobId, "web_billing_key_revoke_failed");
    console.error("[account-delete] web billing key revoke failed");
    return c.json({ error: "account_deletion_retryable" }, 503);
  }

  // ── primary 경로 — 가족 전체 완전 삭제 ──
  if (deletionClaim.mode === "family" && ownedFamilyIds.length > 0) {
    const familyPh = ownedFamilyIds.map(() => "?").join(",");
    const { results: childRows } = await db
      .prepare(
        `SELECT user_id, is_active
           FROM family_members
          WHERE family_id IN (${familyPh}) AND role = 'child' AND user_id IS NOT NULL`,
      )
      .bind(...ownedFamilyIds)
      .all<OwnedFamilyChildRow>();
    const childIds = uniqueIds((childRows ?? []).map((row) => row.user_id));
    const managedChildCandidates = uniqueIds(
      (childRows ?? [])
        .filter((row) => Number(row.is_active) === 1)
        .map((row) => row.user_id),
    );
    const claimedManagedChildIds: string[] = [];
    try {
      for (const childUserId of managedChildCandidates) {
        if (await claimManagedChildForAccountDeletion(db, {
          jobId: deletionClaim.jobId,
          ownerUserId: callerId,
          childUserId,
        })) claimedManagedChildIds.push(childUserId);
      }
    } catch (error) {
      await markAccountDeletionFailure(db, deletionClaim.jobId, "managed_child_claim_failed");
      console.error("[account-delete] managed child claim failed");
      return c.json({ error: "account_deletion_retryable" }, 503);
    }
    let deletedUserIds = uniqueIds([
      callerId,
      ...deletionClaim.userIds.filter((userId) => userId !== callerId),
      ...claimedManagedChildIds,
    ]);
    const ownedFamilyMembers = await listMembersForFamilies(db, ownedFamilyIds);
    const r2DeletedUserMembers = await listMembersForUsers(db, deletedUserIds);
    const r2Members = [...new Map(
      [...ownedFamilyMembers, ...r2DeletedUserMembers].map((member) => [member.id, member]),
    ).values()];
    const exactPhotoKeys = await collectChildPhotoKeys(db, r2Members);
    const retainedPhotoKeys = await collectRetainedChildPhotoKeys(db, r2Members);
    const deletedUserIdSet = new Set(deletedUserIds);
    const userUploadScopes = r2Members
      .filter((member) => member.userId && deletedUserIdSet.has(member.userId))
      .map((member) => ({ familyId: member.familyId, userId: member.userId }));

    try {
      await deleteAccountPhotoObjects(c.env.PHOTOS, {
        familyPrefixes: ownedFamilyIds,
        teacherUserIds: deletedUserIds,
        userUploadScopes,
        exactKeys: exactPhotoKeys,
        preserveKeys: retainedPhotoKeys,
      });
    } catch (error) {
      await markAccountDeletionFailure(db, deletionClaim.jobId, "r2_cleanup_failed");
      console.error("[account-delete] R2 cleanup failed");
      return c.json({ error: "account_deletion_retryable" }, 503);
    }

    // 구버전 Worker/직접 D1 writer가 claim 직전 경합에서 외부 가족 참조를 만든 경우에도
    // R2 뒤 최종 D1 삭제 전에 다시 확인해 managed child를 전역 삭제 대상에서 분리한다.
    try {
      const preserved: string[] = [];
      for (const childUserId of deletedUserIds.filter((userId) => userId !== callerId)) {
        if (await hasIndependentManagedChildEvidence(db, callerId, childUserId)) {
          await releaseManagedChildAccountDeletionClaim(db, deletionClaim.jobId, childUserId);
          preserved.push(childUserId);
        }
      }
      const preservedSet = new Set(preserved);
      deletedUserIds = deletedUserIds.filter((userId) => !preservedSet.has(userId));
    } catch (error) {
      await markAccountDeletionFailure(db, deletionClaim.jobId, "managed_child_revalidation_failed");
      console.error("[account-delete] managed child revalidation failed");
      return c.json({ error: "account_deletion_retryable" }, 503);
    }

    const deletedUserMembers = await listMembersForUsers(db, deletedUserIds);
    const members = [...new Map(
      [...ownedFamilyMembers, ...deletedUserMembers].map((member) => [member.id, member]),
    ).values()];
    const memberIds = uniqueIds(members.map((member) => member.id));
    const realtimeUserIds = uniqueIds([
      ...deletedUserIds,
      ...ownedFamilyMembers.map((member) => member.userId),
    ]);
    const realtimeFamilyIds = uniqueIds([
      ...ownedFamilyIds,
      ...members.map((member) => member.familyId),
    ]);
    const teacherIds = await listTeacherIdsForUsers(db, deletedUserIds);

    const statements: D1PreparedStatement[] = [
      ...(await buildPgArrayReferenceCleanupStmts(db, deletedUserIds, memberIds)),
      ...buildMemberReferenceDeleteStmts(db, memberIds),
      ...buildUserCreatedEventDeleteStmts(db, deletedUserIds),
      ...buildTeacherGraphDeleteStmts(db, teacherIds),
      ...buildFamilyIndirectDeleteStmts(db, ownedFamilyIds),
      ...buildUserReferenceNullingStmts(db, deletedUserIds),
      ...(await buildUserReferenceDeleteStmts(db, deletedUserIds)),
      ...(await deleteIdentityRateLimitStateStmts(db, deletedUserIds)),
    ];
    for (const userId of deletedUserIds) {
      statements.push(...deleteUserNotificationStateStmts(db, userId));
      statements.push(...deleteUserContentSafetyStateStmts(db, userId));
    }
    statements.push(...(await buildFamilyScopedDeleteStmts(db, ownedFamilyIds)));
    try {
      await cleanupMapRequestControlForAccountDeletion({
        db,
        secret: c.env.MAPS_SESSION_HMAC_SECRET,
        userIds: deletedUserIds,
        familyIds: realtimeFamilyIds,
        deleteFamilyIds: ownedFamilyIds,
      });
      await runAccountDeletionBatches(db, statements);
      const ownedPh = ownedFamilyIds.map(() => "?").join(",");
      const userPh = deletedUserIds.map(() => "?").join(",");
      const finalStatements: D1PreparedStatement[] = [
        db.prepare(
          `DELETE FROM family_members
            WHERE family_id IN (${ownedPh}) OR user_id IN (${userPh})`,
        ).bind(...ownedFamilyIds, ...deletedUserIds),
        db.prepare(`DELETE FROM refresh_tokens WHERE family_id IN (${ownedPh})`).bind(...ownedFamilyIds),
        ...ownedFamilyIds.map((familyId) => db.prepare("DELETE FROM families WHERE id = ?").bind(familyId)),
      ];
      for (const userId of deletedUserIds) finalStatements.push(...deleteAuthUserStmts(db, userId));
      finalStatements.push(...completeAccountDeletionClaimStmts(db, deletionClaim.jobId));
      await db.batch(finalStatements);
    } catch (error) {
      await markAccountDeletionFailure(db, deletionClaim.jobId, "d1_cleanup_failed");
      console.error("[account-delete] D1 cleanup failed");
      return c.json({ error: "account_deletion_retryable" }, 503);
    }
    await revokeDeletedRealtimeUsers(c.env, realtimeFamilyIds, realtimeUserIds);
    return c.json({
      ok: true,
      mode: "family",
      deletedChildren: childIds.length,
      deletedFamilies: ownedFamilyIds.length,
    });
  }

  // ── self/co-parent/child/teacher 경로 — 다른 가족·사용자 데이터는 보존 ──
  const deletedUserIds = [callerId];
  const members = await listMembersForUsers(db, deletedUserIds);
  const historicalFamilyIds = await listHistoricalRefreshFamilyIds(db, callerId);
  const knownFamilyIds = new Set(members.map((member) => member.familyId));
  const cleanupMembers = [
    ...members,
    ...historicalFamilyIds
      .filter((familyId) => !knownFamilyIds.has(familyId))
      .map((familyId) => ({
        id: "",
        familyId,
        userId: callerId,
        role: "child",
        photoUrl: null,
      })),
  ];
  const memberIds = uniqueIds(members.map((member) => member.id));
  const realtimeFamilyIds = uniqueIds(cleanupMembers.map((member) => member.familyId));
  const teacherIds = await listTeacherIdsForUsers(db, deletedUserIds);
  const exactPhotoKeys = await collectChildPhotoKeys(db, cleanupMembers);
  const retainedPhotoKeys = await collectRetainedChildPhotoKeys(db, cleanupMembers);
  const userUploadScopes = uniqueIds(cleanupMembers.map((member) => member.familyId))
    .map((familyId) => ({ familyId, userId: callerId }));
  try {
    await deleteAccountPhotoObjects(c.env.PHOTOS, {
      teacherUserIds: deletedUserIds,
      userUploadScopes,
      exactKeys: exactPhotoKeys,
      preserveKeys: retainedPhotoKeys,
    });
  } catch (error) {
    await markAccountDeletionFailure(db, deletionClaim.jobId, "r2_cleanup_failed");
    console.error("[account-delete] R2 cleanup failed");
    return c.json({ error: "account_deletion_retryable" }, 503);
  }

  const statements: D1PreparedStatement[] = [
    ...(await buildPgArrayReferenceCleanupStmts(db, deletedUserIds, memberIds)),
    ...buildMemberReferenceDeleteStmts(db, memberIds),
    ...buildUserCreatedEventDeleteStmts(db, deletedUserIds),
    ...buildTeacherGraphDeleteStmts(db, teacherIds),
    ...buildUserReferenceNullingStmts(db, deletedUserIds),
    ...(await buildUserReferenceDeleteStmts(db, deletedUserIds)),
    ...(await deleteIdentityRateLimitStateStmts(db, deletedUserIds)),
    ...deleteUserNotificationStateStmts(db, callerId),
    ...deleteUserContentSafetyStateStmts(db, callerId),
  ];
  try {
    await cleanupMapRequestControlForAccountDeletion({
      db,
      secret: c.env.MAPS_SESSION_HMAC_SECRET,
      userIds: deletedUserIds,
      familyIds: realtimeFamilyIds,
    });
    await runAccountDeletionBatches(db, statements);
    await db.batch([
      db.prepare("DELETE FROM family_members WHERE user_id = ?").bind(callerId),
      ...deleteAuthUserStmts(db, callerId),
      ...completeAccountDeletionClaimStmts(db, deletionClaim.jobId),
    ]);
  } catch (error) {
    await markAccountDeletionFailure(db, deletionClaim.jobId, "d1_cleanup_failed");
    console.error("[account-delete] D1 cleanup failed");
    return c.json({ error: "account_deletion_retryable" }, 503);
  }
  await revokeDeletedRealtimeUsers(c.env, realtimeFamilyIds, deletedUserIds);
  return c.json({ ok: true, mode: "self" });
});

export default account;
