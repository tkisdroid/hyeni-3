import { pgArray, toPgArray } from "./serialize";
import {
  removeMapQuotaForFamily,
  removeMapQuotaForUser,
} from "./maps/requestControlCleanup.ts";

const D1_DELETE_BATCH_SIZE = 40;
const D1_SCHEMA_TABLES_PER_QUERY = 5;
const R2_DELETE_BATCH_SIZE = 1_000;

const USER_REFERENCE_COLUMNS = new Set([
  "user_id",
  "child_user_id",
  "parent_id",
  "initiator_user_id",
  "target_user_id",
  "sender_user_id",
  "requester_user_id",
  "requester_child_id",
  "receiver_child_id",
  "child_a_id",
  "child_b_id",
  "user_a_id",
  "user_b_id",
]);

const USER_REFERENCE_EXCLUDED_TABLES = new Set([
  "users",
  "auth_identities",
  "refresh_tokens",
  "account_device_sessions",
  "families",
  "family_members",
  "account_deletion_jobs",
  "account_deletion_scopes",
  "storage_invalid_upload_cleanup_jobs",
  "web_ai_credit_orders",
  "web_ai_credit_detached_balances",
  "web_billing_financial_records",
  "web_billing_refund_records",
  "ai_credit_balances",
]);

const EXTRA_USER_REFERENCE_COLUMNS = new Map<string, ReadonlySet<string>>([
  ["emergency_audio_chunks", new Set(["child_id"])],
  ["child_audio_chunks", new Set(["child_id"])],
]);

export interface AccountMemberReference {
  id: string;
  familyId: string;
  userId: string;
  role: string;
  photoUrl: string | null;
}

interface SqliteColumnRow {
  table_name: string;
  column_name: string;
}

interface SqliteTableRow {
  table_name: string;
}

type WebAiCreditDetachReason = "account_deleted" | "family_deleted" | "child_unpaired";
type WebAiCreditRestorationState = "blocked" | "closed";

const WEB_AI_CREDIT_ORDER_RETENTION_COLUMNS = new Set([
  "record_scope",
  "balance_scope",
  "detach_reason",
  "detached_at",
  "granted_credits",
  "grant_committed_at",
  "refunded_credits",
  "refund_committed_at",
  "retention_until",
]);
const WEB_AI_CREDIT_DETACHED_BALANCE_COLUMNS = new Set([
  "family_id",
  "child_user_id",
  "purchased_credits",
  "restoration_state",
  "detached_at",
  "updated_at",
  "retention_until",
]);

function columnsByTable(rows: readonly SqliteColumnRow[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = String(row.table_name ?? "");
    const column = String(row.column_name ?? "");
    if (!table || !column) continue;
    const columns = result.get(table) ?? new Set<string>();
    columns.add(column);
    result.set(table, columns);
  }
  return result;
}

function hasAllColumns(actual: ReadonlySet<string> | undefined, required: ReadonlySet<string>): boolean {
  return Boolean(actual && [...required].every((column) => actual.has(column)));
}

/** 결제 주문이 존재하는데 분리 금융 정본 스키마가 덜 적용된 상태에서는 삭제를 fail-closed한다. */
function assertWebAiCreditRetentionSchema(schema: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const orderColumns = schema.get("web_ai_credit_orders");
  if (!orderColumns) return false;
  if (
    !hasAllColumns(orderColumns, WEB_AI_CREDIT_ORDER_RETENTION_COLUMNS)
    || !hasAllColumns(
      schema.get("web_ai_credit_detached_balances"),
      WEB_AI_CREDIT_DETACHED_BALANCE_COLUMNS,
    )
    || !schema.has("ai_credit_balances")
    || !schema.has("ai_credit_ledger")
  ) {
    throw new Error("web_ai_credit_financial_retention_schema_unavailable");
  }
  return true;
}

function webAiCreditOrderSnapshotSetSql(
  balanceScopeSql: string,
  detachReason: WebAiCreditDetachReason,
): string {
  return `record_scope='detached',
          balance_scope=${balanceScopeSql},
          detach_reason='${detachReason}',
          detached_at=COALESCE(detached_at,CURRENT_TIMESTAMP),
          granted_credits=CASE
            WHEN granted_credits>0 THEN granted_credits
            WHEN EXISTS(
              SELECT 1 FROM ai_credit_ledger granted
               WHERE granted.transaction_id=web_ai_credit_orders.order_id
                 AND granted.delta=web_ai_credit_orders.credits
            ) THEN credits ELSE 0 END,
          grant_committed_at=COALESCE(grant_committed_at,(
            SELECT MIN(granted.created_at) FROM ai_credit_ledger granted
             WHERE granted.transaction_id=web_ai_credit_orders.order_id
               AND granted.delta=web_ai_credit_orders.credits
          )),
          refunded_credits=CASE
            WHEN refunded_credits>0 THEN refunded_credits
            WHEN EXISTS(
              SELECT 1 FROM ai_credit_ledger refunded
               WHERE refunded.transaction_id=web_ai_credit_orders.order_id
                 AND refunded.delta=-web_ai_credit_orders.credits
            ) THEN credits ELSE 0 END,
          refund_committed_at=COALESCE(refund_committed_at,(
            SELECT MIN(refunded.created_at) FROM ai_credit_ledger refunded
             WHERE refunded.transaction_id=web_ai_credit_orders.order_id
               AND refunded.delta=-web_ai_credit_orders.credits
          ),CASE WHEN status='refunded' THEN COALESCE(provider_checked_at,completed_at) END),
          retention_until=CASE
            WHEN status='refunded' THEN CASE
              WHEN retention_until IS NULL OR datetime(substr(retention_until,1,19))<datetime(substr(
                COALESCE(
                  refund_committed_at,
                  (SELECT MIN(refunded.created_at) FROM ai_credit_ledger refunded
                    WHERE refunded.transaction_id=web_ai_credit_orders.order_id
                      AND refunded.delta=-web_ai_credit_orders.credits),
                  provider_checked_at,completed_at,created_at
                ),1,19),'+5 years')
              THEN datetime(substr(
                COALESCE(
                  refund_committed_at,
                  (SELECT MIN(refunded.created_at) FROM ai_credit_ledger refunded
                    WHERE refunded.transaction_id=web_ai_credit_orders.order_id
                      AND refunded.delta=-web_ai_credit_orders.credits),
                  provider_checked_at,completed_at,created_at
                ),1,19),'+5 years')
              ELSE retention_until END
            WHEN status='done' THEN COALESCE(
              retention_until,
              datetime(substr(COALESCE(completed_at,created_at),1,19),'+5 years')
            )
            ELSE retention_until END`;
}

function buildWebAiCreditDetachedBalanceStmt(
  db: D1Database,
  predicateSql: string,
  bindings: readonly string[],
  restorationState: WebAiCreditRestorationState,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO web_ai_credit_detached_balances
       (family_id,child_user_id,purchased_credits,restoration_state,
        detached_at,updated_at,retention_until)
     SELECT balance.family_id,balance.child_user_id,balance.purchased_credits,
            '${restorationState}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
            datetime(CURRENT_TIMESTAMP,'+5 years')
       FROM ai_credit_balances balance
      WHERE ${predicateSql}
        AND (
          balance.purchased_credits<>0
          OR EXISTS(
            SELECT 1 FROM web_ai_credit_orders retained
             WHERE retained.family_id=balance.family_id
               AND retained.child_user_id=balance.child_user_id
               AND retained.granted_credits>0
          )
        )
     ON CONFLICT(family_id,child_user_id) DO NOTHING`,
  ).bind(...bindings);
}

function buildFamilyWebAiCreditRetentionStmts(
  db: D1Database,
  familyIds: readonly string[],
  schema: ReadonlyMap<string, ReadonlySet<string>>,
): D1PreparedStatement[] {
  if (!assertWebAiCreditRetentionSchema(schema)) return [];
  const ph = inClause(familyIds);
  return [
    db.prepare(
      `UPDATE web_ai_credit_orders
          SET ${webAiCreditOrderSnapshotSetSql("'detached'", "family_deleted")}
        WHERE family_id IN (${ph})`,
    ).bind(...familyIds),
    buildWebAiCreditDetachedBalanceStmt(
      db,
      `balance.family_id IN (${ph})`,
      familyIds,
      "closed",
    ),
  ];
}

function buildChildWebAiCreditRetentionStmts(
  db: D1Database,
  familyId: string,
  childUserId: string,
  schema: ReadonlyMap<string, ReadonlySet<string>>,
): D1PreparedStatement[] {
  if (!assertWebAiCreditRetentionSchema(schema)) return [];
  return [
    db.prepare(
      `UPDATE web_ai_credit_orders
          SET ${webAiCreditOrderSnapshotSetSql("'detached'", "child_unpaired")}
        WHERE family_id=? AND child_user_id=?`,
    ).bind(familyId, childUserId),
    buildWebAiCreditDetachedBalanceStmt(
      db,
      "balance.family_id=? AND balance.child_user_id=?",
      [familyId, childUserId],
      "blocked",
    ),
    db.prepare(
      "DELETE FROM ai_credit_balances WHERE family_id=? AND child_user_id=?",
    ).bind(familyId, childUserId),
  ];
}

function buildUserWebAiCreditRetentionStmts(
  db: D1Database,
  userIds: readonly string[],
  schema: ReadonlyMap<string, ReadonlySet<string>>,
): D1PreparedStatement[] {
  if (!assertWebAiCreditRetentionSchema(schema)) return [];
  const ph = inClause(userIds);
  return [
    db.prepare(
      `UPDATE web_ai_credit_orders
          SET ${webAiCreditOrderSnapshotSetSql(
            `CASE WHEN child_user_id IN (${ph}) THEN 'detached' ELSE balance_scope END`,
            "account_deleted",
          )}
        WHERE parent_id IN (${ph}) OR child_user_id IN (${ph})`,
    ).bind(...userIds, ...userIds, ...userIds),
    buildWebAiCreditDetachedBalanceStmt(
      db,
      `balance.child_user_id IN (${ph})`,
      userIds,
      "blocked",
    ),
    db.prepare(`DELETE FROM ai_credit_balances WHERE child_user_id IN (${ph})`).bind(...userIds),
    db.prepare(
      `UPDATE ai_credit_balances
          SET parent_id=(
                SELECT family.parent_id FROM families family
                 WHERE family.id=ai_credit_balances.family_id
                   AND family.parent_id NOT IN (${ph})
                 LIMIT 1
              ),
              updated_at=CURRENT_TIMESTAMP
        WHERE parent_id IN (${ph}) AND child_user_id NOT IN (${ph})`,
    ).bind(...userIds, ...userIds, ...userIds),
  ];
}

function uniqueNonEmpty(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function inClause(values: readonly string[]): string {
  return values.map(() => "?").join(",");
}

async function loadSqliteTableColumns(db: D1Database): Promise<SqliteColumnRow[]> {
  const { results: tableRows } = await db
    .prepare(
      `SELECT name AS table_name
         FROM sqlite_master
        WHERE type='table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT GLOB '_cf_*'
        ORDER BY name`,
    )
    .all<SqliteTableRow>();
  const tables = uniqueNonEmpty((tableRows ?? []).map((row) => row.table_name));
  if (tables.length === 0) return [];
  const columns: SqliteColumnRow[] = [];
  for (let index = 0; index < tables.length; index += D1_SCHEMA_TABLES_PER_QUERY) {
    const sql = tables.slice(index, index + D1_SCHEMA_TABLES_PER_QUERY).map((table) => {
      const literal = quoteSqlString(table);
      return `SELECT ${literal} AS table_name, name AS column_name FROM pragma_table_info(${literal})`;
    }).join(" UNION ALL ");
    const { results } = await db.prepare(sql).all<SqliteColumnRow>();
    columns.push(...(results ?? []));
  }
  return columns;
}

function safeChildPhotoKey(raw: string | null | undefined, familyIds: ReadonlySet<string>): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const routed = value.match(
    /\/(?:storage\/v1\/object\/(?:public|sign)|api\/storage)\/child-photos\/([^?#]+)/,
  );
  let candidate = value;
  if (routed) {
    try {
      candidate = decodeURIComponent(routed[1]);
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(value)) {
    return null;
  }
  const key = candidate.replace(/^\/+/, "").trim();
  if (!key || key.includes("..") || key.includes("\\")) return null;
  const familyId = key.split("/")[0] ?? "";
  return familyIds.has(familyId) && key.startsWith(`${familyId}/`) ? key : null;
}

export async function listMembersForUsers(
  db: D1Database,
  userIds: readonly string[],
): Promise<AccountMemberReference[]> {
  const ids = uniqueNonEmpty(userIds);
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT id, family_id, user_id, role, photo_url
         FROM family_members
        WHERE user_id IN (${inClause(ids)})`,
    )
    .bind(...ids)
    .all<{ id: string; family_id: string; user_id: string; role: string; photo_url: string | null }>();
  return (results ?? []).map((row) => ({
    id: String(row.id),
    familyId: String(row.family_id),
    userId: String(row.user_id),
    role: String(row.role),
    photoUrl: row.photo_url ? String(row.photo_url) : null,
  }));
}

export async function listMembersForFamilies(
  db: D1Database,
  familyIds: readonly string[],
): Promise<AccountMemberReference[]> {
  const ids = uniqueNonEmpty(familyIds);
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT id, family_id, user_id, role, photo_url
         FROM family_members
        WHERE family_id IN (${inClause(ids)})`,
    )
    .bind(...ids)
    .all<{ id: string; family_id: string; user_id: string | null; role: string; photo_url: string | null }>();
  return (results ?? []).map((row) => ({
    id: String(row.id),
    familyId: String(row.family_id),
    userId: row.user_id ? String(row.user_id) : "",
    role: String(row.role),
    photoUrl: row.photo_url ? String(row.photo_url) : null,
  }));
}

export async function listTeacherIdsForUsers(
  db: D1Database,
  userIds: readonly string[],
): Promise<string[]> {
  const ids = uniqueNonEmpty(userIds);
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare(`SELECT id FROM teacher_profiles WHERE user_id IN (${inClause(ids)})`)
    .bind(...ids)
    .all<{ id: string }>();
  return uniqueNonEmpty((results ?? []).map((row) => row.id));
}

export async function collectChildPhotoKeys(
  db: D1Database,
  members: readonly AccountMemberReference[],
): Promise<string[]> {
  const memberIds = uniqueNonEmpty(members.map((member) => member.id));
  const userIds = uniqueNonEmpty(members.map((member) => member.userId));
  const familyIds = new Set(uniqueNonEmpty(members.map((member) => member.familyId)));
  const keys = new Set<string>();
  for (const member of members) {
    const key = safeChildPhotoKey(member.photoUrl, familyIds);
    if (key) keys.add(key);
  }

  const deletedMemoConditions: string[] = [];
  const deletedMemoBindings: string[] = [];
  if (memberIds.length > 0) {
    deletedMemoConditions.push(`child_id IN (${inClause(memberIds)})`);
    deletedMemoBindings.push(...memberIds);
  }
  if (userIds.length > 0) {
    deletedMemoConditions.push(`user_id IN (${inClause(userIds)})`);
    deletedMemoBindings.push(...userIds);
  }

  const imageMarker = /\[\[img:([^\]]+)\]\]/g;
  if (deletedMemoConditions.length > 0) {
    const { results } = await db
      .prepare(`SELECT content FROM memo_replies WHERE ${deletedMemoConditions.join(" OR ")}`)
      .bind(...deletedMemoBindings)
      .all<{ content: string }>();
    for (const row of results ?? []) {
      const content = String(row.content ?? "");
      for (const match of content.matchAll(imageMarker)) {
        const key = safeChildPhotoKey(match[1], familyIds);
        if (key) keys.add(key);
      }
    }
  }

  if (keys.size === 0) return [];

  // 삭제 뒤 남아 있는 정확한 참조가 하나라도 있으면 공유 R2 객체를 보존한다.
  const retainedKeys = new Set<string>();
  const retainedMemberCondition = memberIds.length > 0
    ? `id NOT IN (${inClause(memberIds)})`
    : "1 = 1";
  const { results: retainedMembers } = await db
    .prepare(`SELECT photo_url FROM family_members WHERE ${retainedMemberCondition} AND photo_url IS NOT NULL`)
    .bind(...memberIds)
    .all<{ photo_url: string }>();
  for (const row of retainedMembers ?? []) {
    const key = safeChildPhotoKey(row.photo_url, familyIds);
    if (key && keys.has(key)) retainedKeys.add(key);
  }

  const retainedMemoConditions: string[] = ["content LIKE '%[[img:%'"];
  const retainedMemoBindings: string[] = [];
  if (memberIds.length > 0) {
    retainedMemoConditions.push(`(child_id IS NULL OR child_id NOT IN (${inClause(memberIds)}))`);
    retainedMemoBindings.push(...memberIds);
  }
  if (userIds.length > 0) {
    retainedMemoConditions.push(`(user_id IS NULL OR user_id NOT IN (${inClause(userIds)}))`);
    retainedMemoBindings.push(...userIds);
  }
  const { results: retainedMemos } = await db
    .prepare(`SELECT content FROM memo_replies WHERE ${retainedMemoConditions.join(" AND ")}`)
    .bind(...retainedMemoBindings)
    .all<{ content: string }>();
  for (const row of retainedMemos ?? []) {
    const content = String(row.content ?? "");
    for (const match of content.matchAll(imageMarker)) {
      const key = safeChildPhotoKey(match[1], familyIds);
      if (key && keys.has(key)) retainedKeys.add(key);
    }
  }

  return [...keys].filter((key) => !retainedKeys.has(key));
}

export async function collectRetainedChildPhotoKeys(
  db: D1Database,
  members: readonly AccountMemberReference[],
): Promise<string[]> {
  const memberIds = uniqueNonEmpty(members.map((member) => member.id));
  const userIds = uniqueNonEmpty(members.map((member) => member.userId));
  const familyIdValues = uniqueNonEmpty(members.map((member) => member.familyId));
  const familyIds = new Set(familyIdValues);
  if (familyIds.size === 0) return [];

  const retainedKeys = new Set<string>();
  const memberConditions = [
    `family_id IN (${inClause(familyIdValues)})`,
    "photo_url IS NOT NULL",
  ];
  const memberBindings: string[] = [...familyIdValues];
  if (memberIds.length > 0) {
    memberConditions.push(`id NOT IN (${inClause(memberIds)})`);
    memberBindings.push(...memberIds);
  }
  const { results: retainedMembers } = await db
    .prepare(`SELECT photo_url FROM family_members WHERE ${memberConditions.join(" AND ")}`)
    .bind(...memberBindings)
    .all<{ photo_url: string }>();
  for (const row of retainedMembers ?? []) {
    const key = safeChildPhotoKey(row.photo_url, familyIds);
    if (key) retainedKeys.add(key);
  }

  const memoConditions = [
    `family_id IN (${inClause(familyIdValues)})`,
    "content LIKE '%[[img:%'",
  ];
  const memoBindings: string[] = [...familyIdValues];
  if (memberIds.length > 0) {
    memoConditions.push(`(child_id IS NULL OR child_id NOT IN (${inClause(memberIds)}))`);
    memoBindings.push(...memberIds);
  }
  if (userIds.length > 0) {
    memoConditions.push(`(user_id IS NULL OR user_id NOT IN (${inClause(userIds)}))`);
    memoBindings.push(...userIds);
  }
  const { results: retainedMemos } = await db
    .prepare(`SELECT content FROM memo_replies WHERE ${memoConditions.join(" AND ")}`)
    .bind(...memoBindings)
    .all<{ content: string }>();
  const imageMarker = /\[\[img:([^\]]+)\]\]/g;
  for (const row of retainedMemos ?? []) {
    for (const match of String(row.content ?? "").matchAll(imageMarker)) {
      const key = safeChildPhotoKey(match[1], familyIds);
      if (key) retainedKeys.add(key);
    }
  }
  return [...retainedKeys];
}

async function deleteR2Prefix(
  bucket: R2Bucket,
  prefix: string,
  preserveKeys: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (!prefix || !prefix.endsWith("/") || prefix.includes("..") || prefix.includes("\\")) {
    throw new Error("unsafe_r2_prefix");
  }
  let startAfter: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, limit: R2_DELETE_BATCH_SIZE, startAfter });
    const keys = uniqueNonEmpty((page.objects ?? []).map((object) => object.key))
      .filter((key) => key.startsWith(prefix));
    if (keys.length === 0) return;
    const deleteKeys = keys.filter((key) => !preserveKeys.has(key));
    for (let index = 0; index < deleteKeys.length; index += R2_DELETE_BATCH_SIZE) {
      await bucket.delete(deleteKeys.slice(index, index + R2_DELETE_BATCH_SIZE));
    }
    if (!page.truncated) return;
    const nextStartAfter = keys.at(-1);
    if (!nextStartAfter || nextStartAfter === startAfter) throw new Error("invalid_r2_pagination");
    startAfter = nextStartAfter;
  }
}

export interface AccountUserUploadScope {
  familyId: string;
  userId: string;
}

function userUploadPrefix(scope: AccountUserUploadScope): string {
  const familyId = String(scope.familyId ?? "").trim();
  const userId = String(scope.userId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(familyId) || !/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
    throw new Error("unsafe_r2_upload_scope");
  }
  return `${familyId}/uploads/${userId}/`;
}

async function deleteLegacyOwnerObjects(
  bucket: R2Bucket,
  scope: AccountUserUploadScope,
  preserveKeys: ReadonlySet<string>,
): Promise<void> {
  // userUploadPrefix가 두 식별자를 검증한다. legacy는 이름을 추정하지 않고 Worker가
  // 기록한 immutable owner metadata가 정확히 일치하는 객체만 회수한다.
  userUploadPrefix(scope);
  const familyPrefix = `${scope.familyId}/`;
  let startAfter: string | undefined;
  for (;;) {
    const page = await bucket.list({
      prefix: familyPrefix,
      limit: R2_DELETE_BATCH_SIZE,
      startAfter,
      include: ["customMetadata"],
    } as R2ListOptions & { include: ["customMetadata"] });
    const objects = page.objects ?? [];
    const keys = objects.map((object) => object.key).filter((key) => key.startsWith(familyPrefix));
    const deleteKeys = objects
      .filter((object) =>
        object.key.startsWith(familyPrefix)
        && !preserveKeys.has(object.key)
        && object.customMetadata?.familyId === scope.familyId
        && object.customMetadata?.ownerUserId === scope.userId
        && object.customMetadata?.purpose === "legacy"
      )
      .map((object) => object.key);
    for (let index = 0; index < deleteKeys.length; index += R2_DELETE_BATCH_SIZE) {
      await bucket.delete(deleteKeys.slice(index, index + R2_DELETE_BATCH_SIZE));
    }
    if (!page.truncated) return;
    const nextStartAfter = keys.at(-1);
    if (!nextStartAfter || nextStartAfter === startAfter) throw new Error("invalid_r2_pagination");
    startAfter = nextStartAfter;
  }
}

export async function deleteAccountPhotoObjects(
  bucket: R2Bucket,
  input: {
    familyPrefixes?: readonly string[];
    teacherUserIds?: readonly string[];
    userUploadScopes?: readonly AccountUserUploadScope[];
    exactKeys?: readonly string[];
    preserveKeys?: readonly string[];
  },
): Promise<void> {
  const destructivePrefixes = uniqueNonEmpty([
    ...(input.familyPrefixes ?? []).map((familyId) => `${familyId}/`),
    ...(input.teacherUserIds ?? []).map((userId) => `teacher-notices/${userId}/`),
  ]);
  for (const prefix of destructivePrefixes) await deleteR2Prefix(bucket, prefix);

  const preserveKeys = new Set(uniqueNonEmpty(input.preserveKeys ?? []));
  const userPrefixes = uniqueNonEmpty(
    (input.userUploadScopes ?? []).map((scope) => userUploadPrefix(scope)),
  ).filter((prefix) => !destructivePrefixes.some((destructive) => prefix.startsWith(destructive)));
  for (const prefix of userPrefixes) await deleteR2Prefix(bucket, prefix, preserveKeys);
  const legacyOwnerScopes = (input.userUploadScopes ?? []).filter((scope) => {
    const prefix = userUploadPrefix(scope);
    return !destructivePrefixes.some((destructive) => prefix.startsWith(destructive));
  });
  for (const scope of legacyOwnerScopes) {
    await deleteLegacyOwnerObjects(bucket, scope, preserveKeys);
  }

  const exactKeys = uniqueNonEmpty(input.exactKeys ?? []).filter((key) =>
    !destructivePrefixes.some((prefix) => key.startsWith(prefix))
      && !userPrefixes.some((prefix) => key.startsWith(prefix))
      && !preserveKeys.has(key),
  );
  for (let index = 0; index < exactKeys.length; index += R2_DELETE_BATCH_SIZE) {
    await bucket.delete(exactKeys.slice(index, index + R2_DELETE_BATCH_SIZE));
  }
}

export async function buildUserReferenceDeleteStmts(
  db: D1Database,
  userIds: readonly string[],
): Promise<D1PreparedStatement[]> {
  const ids = uniqueNonEmpty(userIds);
  if (ids.length === 0) return [];
  const results = await loadSqliteTableColumns(db);
  const schema = columnsByTable(results ?? []);
  const byTable = new Map<string, string[]>();
  for (const row of results ?? []) {
    const table = String(row.table_name ?? "");
    const column = String(row.column_name ?? "");
    const isUserReference = USER_REFERENCE_COLUMNS.has(column)
      || EXTRA_USER_REFERENCE_COLUMNS.get(table)?.has(column) === true;
    if (!table || !isUserReference || USER_REFERENCE_EXCLUDED_TABLES.has(table)) continue;
    const columns = byTable.get(table) ?? [];
    columns.push(column);
    byTable.set(table, columns);
  }
  const statements: D1PreparedStatement[] = buildUserWebAiCreditRetentionStmts(db, ids, schema);
  for (const [table, rawColumns] of byTable) {
    const columns = uniqueNonEmpty(rawColumns);
    const predicates = columns.map((column) => `${quoteIdentifier(column)} IN (${inClause(ids)})`);
    const bindings = columns.flatMap(() => ids);
    statements.push(
      db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE ${predicates.join(" OR ")}`).bind(...bindings),
    );
  }
  return statements;
}

export function buildMemberReferenceDeleteStmts(
  db: D1Database,
  memberIds: readonly string[],
): D1PreparedStatement[] {
  const ids = uniqueNonEmpty(memberIds);
  if (ids.length === 0) return [];
  const ph = inClause(ids);
  const specs: Array<[string, string]> = [
    ["teacher_class_children", "child_member_id"],
    ["teacher_notice_recipients", "child_member_id"],
    ["teacher_attendance_logs", "child_member_id"],
    ["teacher_schedule_notes", "child_member_id"],
    ["teacher_child_pairings", "child_member_id"],
    ["events_children", "child_id"],
    ["daily_supplies", "child_id"],
    ["memo_replies", "child_id"],
    ["subscriptions", "child_id"],
    ["point_transactions", "member_id"],
  ];
  return specs.map(([table, column]) =>
    db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} IN (${ph})`).bind(...ids),
  );
}

const FAMILY_USER_REFERENCE_EXCLUDED_TABLES = new Set([
  "family_members",
  "family_unpair_cleanup_jobs",
  "fcm_tokens",
  "push_subscriptions",
  "refresh_tokens",
  "account_device_sessions",
  "account_deletion_jobs",
  "account_deletion_scopes",
  "storage_invalid_upload_cleanup_jobs",
  "web_ai_credit_orders",
  "web_ai_credit_detached_balances",
  "web_billing_financial_records",
  "web_billing_refund_records",
  "ai_credit_balances",
]);

/** 연결 해제 대상 사용자의 해당 가족 내 비-FK 참조를 스키마 기준으로 전수 정리한다. */
export async function buildFamilyUserReferenceDeleteStmts(
  db: D1Database,
  familyId: string,
  userId: string,
): Promise<D1PreparedStatement[]> {
  if (!familyId || !userId) return [];
  const allColumns = await loadSqliteTableColumns(db);
  const schemaByTable = columnsByTable(allColumns);
  const results = allColumns.filter((row) => schemaByTable.get(row.table_name)?.has("family_id"));
  const schema = columnsByTable(results ?? []);
  const byTable = new Map<string, string[]>();
  for (const row of results ?? []) {
    if (FAMILY_USER_REFERENCE_EXCLUDED_TABLES.has(row.table_name)) continue;
    const extra = EXTRA_USER_REFERENCE_COLUMNS.get(row.table_name);
    if (!USER_REFERENCE_COLUMNS.has(row.column_name) && !extra?.has(row.column_name)) continue;
    const columns = byTable.get(row.table_name) ?? [];
    columns.push(row.column_name);
    byTable.set(row.table_name, columns);
  }
  const statements = buildChildWebAiCreditRetentionStmts(db, familyId, userId, schema);
  statements.push(...[...byTable.entries()].map(([table, columns]) => {
    const condition = columns
      .map((column) => `${quoteIdentifier(column)} = ?`)
      .join(" OR ");
    return db
      .prepare(
        `DELETE FROM ${quoteIdentifier(table)}
          WHERE "family_id" = ? AND (${condition})`,
      )
      .bind(familyId, ...columns.map(() => userId));
  }));
  return statements;
}

export function buildTeacherGraphDeleteStmts(
  db: D1Database,
  teacherIds: readonly string[],
): D1PreparedStatement[] {
  const ids = uniqueNonEmpty(teacherIds);
  if (ids.length === 0) return [];
  const ph = inClause(ids);
  return [
    db.prepare(
      `DELETE FROM teacher_class_children
        WHERE pairing_id IN (SELECT id FROM teacher_child_pairings WHERE teacher_id IN (${ph}))
           OR class_id IN (SELECT id FROM teacher_classes WHERE teacher_id IN (${ph}))`,
    ).bind(...ids, ...ids),
    db.prepare(
      `DELETE FROM teacher_notice_recipients
        WHERE notice_id IN (SELECT id FROM teacher_notices WHERE teacher_id IN (${ph}))`,
    ).bind(...ids),
    db.prepare(`DELETE FROM teacher_attendance_logs WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_schedule_notes WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_notification_batches WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_pairing_attempts WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_child_pairings WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_notices WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_classes WHERE teacher_id IN (${ph})`).bind(...ids),
    db.prepare(`DELETE FROM teacher_profiles WHERE id IN (${ph})`).bind(...ids),
  ];
}

export function buildUserCreatedEventDeleteStmts(
  db: D1Database,
  userIds: readonly string[],
): D1PreparedStatement[] {
  const ids = uniqueNonEmpty(userIds);
  if (ids.length === 0) return [];
  const ph = inClause(ids);
  return [
    db.prepare(
      `DELETE FROM push_sent WHERE event_id IN (SELECT id FROM events WHERE created_by IN (${ph}))`,
    ).bind(...ids),
    db.prepare(
      `DELETE FROM events_children WHERE event_id IN (SELECT id FROM events WHERE created_by IN (${ph}))`,
    ).bind(...ids),
    db.prepare(`DELETE FROM events WHERE created_by IN (${ph})`).bind(...ids),
  ];
}

export function buildUserReferenceNullingStmts(
  db: D1Database,
  userIds: readonly string[],
): D1PreparedStatement[] {
  const ids = uniqueNonEmpty(userIds);
  if (ids.length === 0) return [];
  const ph = inClause(ids);
  return [
    db.prepare(
      `UPDATE daily_supplies
          SET created_by=CASE WHEN created_by IN (${ph}) THEN NULL ELSE created_by END,
              updated_by=CASE WHEN updated_by IN (${ph}) THEN NULL ELSE updated_by END
        WHERE created_by IN (${ph}) OR updated_by IN (${ph})`,
    ).bind(...ids, ...ids, ...ids, ...ids),
    db.prepare(`UPDATE ai_chat_settings SET updated_by=NULL WHERE updated_by IN (${ph})`).bind(...ids),
    db.prepare(`UPDATE ai_parent_settings SET updated_by=NULL WHERE updated_by IN (${ph})`).bind(...ids),
    db.prepare(
      `UPDATE teacher_child_pairings
          SET requested_by=CASE WHEN requested_by IN (${ph}) THEN NULL ELSE requested_by END,
              approved_by=CASE WHEN approved_by IN (${ph}) THEN NULL ELSE approved_by END
        WHERE requested_by IN (${ph}) OR approved_by IN (${ph})`,
    ).bind(...ids, ...ids, ...ids, ...ids),
    db.prepare(`UPDATE friend_playdate_invites SET responded_by=NULL WHERE responded_by IN (${ph})`).bind(...ids),
  ];
}

export function buildFamilyIndirectDeleteStmts(
  db: D1Database,
  familyIds: readonly string[],
): D1PreparedStatement[] {
  const ids = uniqueNonEmpty(familyIds);
  if (ids.length === 0) return [];
  const ph = inClause(ids);
  return [
    db.prepare(
      `DELETE FROM push_sent WHERE event_id IN (SELECT id FROM events WHERE family_id IN (${ph}))`,
    ).bind(...ids),
    db.prepare(
      `DELETE FROM events_children WHERE event_id IN (SELECT id FROM events WHERE family_id IN (${ph}))`,
    ).bind(...ids),
    db.prepare(`DELETE FROM friend_playdate_sessions WHERE family_a_id IN (${ph}) OR family_b_id IN (${ph})`)
      .bind(...ids, ...ids),
    db.prepare(
      `DELETE FROM friend_playdate_invites
        WHERE requester_family_id IN (${ph}) OR receiver_family_id IN (${ph})`,
    ).bind(...ids, ...ids),
    db.prepare(
      `DELETE FROM referral_completions
        WHERE referrer_family_id IN (${ph}) OR referee_family_id IN (${ph})`,
    ).bind(...ids, ...ids),
    db.prepare(`UPDATE families SET referred_by_family_id=NULL WHERE referred_by_family_id IN (${ph})`)
      .bind(...ids),
  ];
}

export async function buildFamilyScopedDeleteStmts(
  db: D1Database,
  familyIds: readonly string[],
): Promise<D1PreparedStatement[]> {
  const ids = uniqueNonEmpty(familyIds);
  if (ids.length === 0) return [];
  const allColumns = await loadSqliteTableColumns(db);
  const schemaByTable = columnsByTable(allColumns);
  const results = allColumns.filter((row) => schemaByTable.get(row.table_name)?.has("family_id"));
  const schema = columnsByTable(results ?? []);
  const ph = inClause(ids);
  const excludedTables = new Set([
    "families",
    "family_members",
    "refresh_tokens",
    "account_deletion_jobs",
    "account_deletion_scopes",
    "storage_invalid_upload_cleanup_jobs",
    "web_ai_credit_orders",
    "web_ai_credit_detached_balances",
    "web_billing_financial_records",
    "web_billing_refund_records",
  ]);
  const statements = buildFamilyWebAiCreditRetentionStmts(db, ids, schema);
  const scopedDeletes = uniqueNonEmpty((results ?? []).map((row) => row.table_name))
    .filter((table) => !excludedTables.has(table))
    .map((table) =>
    db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE family_id IN (${ph})`).bind(...ids),
  );
  const referralV2 = await db
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
        WHERE type='table' AND name='referral_completions_v2' LIMIT 1`,
    )
    .first<{ present: number }>();
  if (referralV2) {
    statements.push(
      db.prepare(
        `DELETE FROM referral_completions_v2
          WHERE referrer_family_id IN (${ph}) OR referee_family_id IN (${ph})`,
      ).bind(...ids, ...ids),
    );
  }
  statements.push(...scopedDeletes);
  return statements;
}

interface PgArrayReferenceSpec {
  table: string;
  idColumn: string;
  valueColumn: string;
  values: readonly string[];
}

export async function buildPgArrayReferenceCleanupStmts(
  db: D1Database,
  userIds: readonly string[],
  memberIds: readonly string[],
): Promise<D1PreparedStatement[]> {
  const specs: PgArrayReferenceSpec[] = [
    { table: "memo_replies", idColumn: "id", valueColumn: "read_by", values: userIds },
    { table: "memos", idColumn: "id", valueColumn: "read_by", values: userIds },
    { table: "parent_alerts", idColumn: "id", valueColumn: "read_by", values: userIds },
    { table: "teacher_notice_recipients", idColumn: "id", valueColumn: "read_by", values: userIds },
    { table: "sos_events", idColumn: "id", valueColumn: "receiver_user_ids", values: userIds },
    {
      table: "teacher_notification_batches",
      idColumn: "id",
      valueColumn: "child_member_ids",
      values: memberIds,
    },
  ];
  const statements: D1PreparedStatement[] = [];
  for (const spec of specs) {
    const remove = new Set(uniqueNonEmpty(spec.values));
    if (remove.size === 0) continue;
    const { results } = await db
      .prepare(
        `SELECT ${quoteIdentifier(spec.idColumn)} AS id, ${quoteIdentifier(spec.valueColumn)} AS value
           FROM ${quoteIdentifier(spec.table)}`,
      )
      .all<{ id: string; value: string | null }>();
    for (const row of results ?? []) {
      const current = pgArray(row.value);
      const next = current.filter((value) => !remove.has(value));
      if (next.length === current.length) continue;
      statements.push(
        db.prepare(
          `UPDATE ${quoteIdentifier(spec.table)}
              SET ${quoteIdentifier(spec.valueColumn)}=?
            WHERE ${quoteIdentifier(spec.idColumn)}=?`,
        ).bind(toPgArray(next), row.id),
      );
    }
  }
  return statements;
}

export async function cleanupMapRequestControlForAccountDeletion(input: {
  db: D1Database;
  secret?: string;
  userIds: readonly string[];
  familyIds: readonly string[];
  deleteFamilyIds?: readonly string[];
}): Promise<void> {
  const secret = String(input.secret ?? "").trim();
  if (!secret) return;
  const deletedFamilies = new Set(uniqueNonEmpty(input.deleteFamilyIds ?? []));
  for (const familyId of deletedFamilies) {
    await removeMapQuotaForFamily({ db: input.db, secret, familyId });
  }
  for (const familyId of uniqueNonEmpty(input.familyIds)) {
    if (deletedFamilies.has(familyId)) continue;
    for (const userId of uniqueNonEmpty(input.userIds)) {
      await removeMapQuotaForUser({ db: input.db, secret, userId, familyId });
    }
  }
}

export async function runAccountDeletionBatches(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<void> {
  for (let index = 0; index < statements.length; index += D1_DELETE_BATCH_SIZE) {
    await db.batch(statements.slice(index, index + D1_DELETE_BATCH_SIZE));
  }
}
