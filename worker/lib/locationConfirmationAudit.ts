import type { Env } from "../types";
import { writeOperationalLog } from "./safeOperationalLog";

export const LOCATION_CONFIRMATION_RETENTION_MONTHS = 6;
export const LOCATION_CONFIRMATION_DELETE_BATCH = 5_000;

const LOCATION_CONFIRMATION_BINDINGS_PER_ROW = 16;
const D1_MAX_BOUND_PARAMETERS_PER_STATEMENT = 100;
const LOCATION_CONFIRMATION_ROWS_PER_STATEMENT = Math.floor(
  D1_MAX_BOUND_PARAMETERS_PER_STATEMENT / LOCATION_CONFIRMATION_BINDINGS_PER_ROW,
);

export const LOCATION_CONFIRMATION_ACTIONS = ["collect", "use", "provide"] as const;
export const LOCATION_CONFIRMATION_REQUESTER_KINDS = ["subject", "parent", "system"] as const;
export const LOCATION_CONFIRMATION_RECIPIENT_KINDS = ["none", "subject", "family_parent"] as const;
export const LOCATION_CONFIRMATION_COLLECTION_METHODS = ["android_fused_location", "not_applicable"] as const;
export const LOCATION_CONFIRMATION_ACQUISITION_PATHS = [
  "android_native_app",
  "location_upload_payload",
  "current_location_store",
  "location_history_store",
  "location_alert_store",
] as const;
export const LOCATION_CONFIRMATION_SERVICE_CODES = [
  "current_location_ingest",
  "location_history_ingest",
  "child_self_location",
  "parent_live_map",
  "parent_location_history",
  "location_incident_history",
  "registered_place_monitor",
  "danger_zone_monitor",
  "location_staleness_monitor",
  "unregistered_stay_monitor",
  "playdate_auto_end",
  "arbitrary_arrival_monitor",
  "schedule_arrival_monitor",
  "playdate_matching",
  "schedule_not_arrived_monitor",
  "location_alert_delivery",
] as const;
export const LOCATION_CONFIRMATION_DELIVERY_METHODS = [
  "https_worker_api",
  "worker_internal",
  "push_notification",
] as const;
export const LOCATION_CONFIRMATION_PURPOSE_CODES = [
  "family_location_safety",
  "family_location_display",
  "route_history_display",
  "incident_history_display",
  "arrival_departure_alert",
  "danger_zone_alert",
  "location_staleness_alert",
  "unregistered_stay_alert",
  "playdate_safety",
  "schedule_arrival_alert",
  "schedule_suggestion",
] as const;

type LocationAlertConfirmation = {
  acquisitionPath: OneOf<typeof LOCATION_CONFIRMATION_ACQUISITION_PATHS>;
  purposeCode: OneOf<typeof LOCATION_CONFIRMATION_PURPOSE_CODES>;
};

const LOCATION_ALERT_CONFIRMATION = new Map<string, LocationAlertConfirmation>([
  ["arrived", { acquisitionPath: "current_location_store", purposeCode: "arrival_departure_alert" }],
  ["late_arrived", { acquisitionPath: "current_location_store", purposeCode: "arrival_departure_alert" }],
  ["place_arrived", { acquisitionPath: "location_history_store", purposeCode: "arrival_departure_alert" }],
  ["place_left", { acquisitionPath: "location_history_store", purposeCode: "arrival_departure_alert" }],
  ["danger_zone", { acquisitionPath: "current_location_store", purposeCode: "danger_zone_alert" }],
  ["danger_enter", { acquisitionPath: "current_location_store", purposeCode: "danger_zone_alert" }],
  ["danger_entry", { acquisitionPath: "current_location_store", purposeCode: "danger_zone_alert" }],
  ["danger_exit", { acquisitionPath: "current_location_store", purposeCode: "danger_zone_alert" }],
  ["location_stale", { acquisitionPath: "current_location_store", purposeCode: "location_staleness_alert" }],
  ["location_recovered", { acquisitionPath: "current_location_store", purposeCode: "location_staleness_alert" }],
  ["child_unpair_suspected", { acquisitionPath: "current_location_store", purposeCode: "location_staleness_alert" }],
  ["unregistered_stay", { acquisitionPath: "location_history_store", purposeCode: "unregistered_stay_alert" }],
  ["unregistered_stay_left", { acquisitionPath: "location_history_store", purposeCode: "unregistered_stay_alert" }],
  ["schedule_suggestion", { acquisitionPath: "location_history_store", purposeCode: "schedule_suggestion" }],
  ["not_arrived", { acquisitionPath: "current_location_store", purposeCode: "schedule_arrival_alert" }],
  ["missed_arrival", { acquisitionPath: "current_location_store", purposeCode: "schedule_arrival_alert" }],
]);

type OneOf<T extends readonly string[]> = T[number];

export interface LocationConfirmationInput {
  familyId: string;
  subjectUserId: string;
  action: OneOf<typeof LOCATION_CONFIRMATION_ACTIONS>;
  requesterKind: OneOf<typeof LOCATION_CONFIRMATION_REQUESTER_KINDS>;
  requesterUserId: string | null;
  recipientKind: OneOf<typeof LOCATION_CONFIRMATION_RECIPIENT_KINDS>;
  recipientUserId: string | null;
  collectionMethod: OneOf<typeof LOCATION_CONFIRMATION_COLLECTION_METHODS>;
  acquisitionPath: OneOf<typeof LOCATION_CONFIRMATION_ACQUISITION_PATHS>;
  serviceCode: OneOf<typeof LOCATION_CONFIRMATION_SERVICE_CODES>;
  deliveryMethod: OneOf<typeof LOCATION_CONFIRMATION_DELIVERY_METHODS>;
  purposeCode: OneOf<typeof LOCATION_CONFIRMATION_PURPOSE_CODES>;
  occurredAt?: string;
  completedAt?: string;
}

export type LocationConfirmationSubject = Pick<LocationConfirmationInput, "familyId" | "subjectUserId">;
export type LocationConfirmationDetails = Omit<LocationConfirmationInput, "familyId" | "subjectUserId">;

const allowed = <T extends readonly string[]>(values: T, value: unknown): value is OneOf<T> =>
  typeof value === "string" && (values as readonly string[]).includes(value);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function d1Timestamp(value: string | undefined, fallback: Date): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback.toISOString().replace("T", " ").slice(0, 19);
  }
  const parsed = Date.parse(value.replace(" ", "T").replace(/\+00$/, "Z"));
  if (!Number.isFinite(parsed)) throw new Error("invalid_location_confirmation_time");
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 19);
}

function validate(input: LocationConfirmationInput): void {
  if (!nonEmpty(input.familyId) || !nonEmpty(input.subjectUserId)) {
    throw new Error("invalid_location_confirmation_identity");
  }
  if (
    !allowed(LOCATION_CONFIRMATION_ACTIONS, input.action)
    || !allowed(LOCATION_CONFIRMATION_REQUESTER_KINDS, input.requesterKind)
    || !allowed(LOCATION_CONFIRMATION_RECIPIENT_KINDS, input.recipientKind)
    || !allowed(LOCATION_CONFIRMATION_COLLECTION_METHODS, input.collectionMethod)
    || !allowed(LOCATION_CONFIRMATION_ACQUISITION_PATHS, input.acquisitionPath)
    || !allowed(LOCATION_CONFIRMATION_SERVICE_CODES, input.serviceCode)
    || !allowed(LOCATION_CONFIRMATION_DELIVERY_METHODS, input.deliveryMethod)
    || !allowed(LOCATION_CONFIRMATION_PURPOSE_CODES, input.purposeCode)
  ) {
    throw new Error("invalid_location_confirmation_code");
  }
  if (input.requesterKind === "system") {
    if (input.requesterUserId != null) throw new Error("invalid_location_confirmation_requester");
  } else if (!nonEmpty(input.requesterUserId)) {
    throw new Error("invalid_location_confirmation_requester");
  }
  if (input.recipientKind === "none") {
    if (input.recipientUserId != null) throw new Error("invalid_location_confirmation_recipient");
  } else if (!nonEmpty(input.recipientUserId)) {
    throw new Error("invalid_location_confirmation_recipient");
  }
  if (input.action === "collect") {
    if (
      input.collectionMethod !== "android_fused_location"
      || input.acquisitionPath !== "android_native_app"
      || input.recipientKind !== "none"
    ) throw new Error("invalid_location_confirmation_collection");
  } else if (input.collectionMethod !== "not_applicable") {
    throw new Error("invalid_location_confirmation_collection");
  }
  if (input.action === "provide" && input.recipientKind === "none") {
    throw new Error("invalid_location_confirmation_recipient");
  }
  if (input.action === "use" && input.recipientKind !== "none") {
    throw new Error("invalid_location_confirmation_recipient");
  }
}

async function recordLocationConfirmations(
  db: D1Database,
  inputs: readonly LocationConfirmationInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const now = new Date();
  const recordedAt = now.toISOString().replace("T", " ").slice(0, 19);
  const statements: D1PreparedStatement[] = [];
  let valuesSql: string[] = [];
  let bindings: unknown[] = [];
  const queueStatement = () => {
    if (valuesSql.length === 0) return;
    statements.push(
      db.prepare(
        `INSERT INTO location_confirmation_records
           (id,family_id,subject_user_id,action,requester_kind,requester_user_id,
            recipient_kind,recipient_user_id,collection_method,acquisition_path,
            service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at)
         VALUES ${valuesSql.join(",")}`,
      ).bind(...bindings),
    );
    valuesSql = [];
    bindings = [];
  };
  for (const rawInput of inputs) {
    const occurredAt = d1Timestamp(rawInput.occurredAt, now);
    const completedAt = d1Timestamp(rawInput.completedAt ?? rawInput.occurredAt, now);
    const input: LocationConfirmationInput = {
      ...rawInput,
      familyId: rawInput.familyId.trim(),
      subjectUserId: rawInput.subjectUserId.trim(),
      requesterUserId: rawInput.requesterUserId?.trim() ?? null,
      recipientUserId: rawInput.recipientUserId?.trim() ?? null,
      occurredAt,
      completedAt,
    };
    validate(input);
    valuesSql.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    bindings.push(
      crypto.randomUUID(),
      input.familyId,
      input.subjectUserId,
      input.action,
      input.requesterKind,
      input.requesterUserId,
      input.recipientKind,
      input.recipientUserId,
      input.collectionMethod,
      input.acquisitionPath,
      input.serviceCode,
      input.deliveryMethod,
      input.purposeCode,
      occurredAt,
      completedAt,
      recordedAt,
    );
    if (valuesSql.length === LOCATION_CONFIRMATION_ROWS_PER_STATEMENT) {
      queueStatement();
    }
  }
  queueStatement();

  if (statements.length === 1) {
    const result = await statements[0].run();
    return Number(result.meta?.changes ?? 0);
  }
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
}

export async function recordLocationConfirmationForSubjects(
  db: D1Database,
  subjects: readonly LocationConfirmationSubject[],
  details: LocationConfirmationDetails,
): Promise<number> {
  const unique = new Map<string, LocationConfirmationSubject>();
  for (const subject of subjects) {
    if (!nonEmpty(subject.familyId) || !nonEmpty(subject.subjectUserId)) continue;
    unique.set(`${subject.familyId}:${subject.subjectUserId}`, {
      familyId: subject.familyId.trim(),
      subjectUserId: subject.subjectUserId.trim(),
    });
  }
  return await recordLocationConfirmations(
    db,
    [...unique.values()].map((subject) => ({ ...subject, ...details })),
  );
}

export async function recordLocationConfirmation(
  db: D1Database,
  input: LocationConfirmationInput,
): Promise<void> {
  await recordLocationConfirmations(db, [input]);
}

export function resolveLocationAlertConfirmation(
  alertType: string,
): LocationAlertConfirmation | null {
  return LOCATION_ALERT_CONFIRMATION.get(alertType.trim().toLowerCase()) ?? null;
}

export async function recordLocationAlertProvisionToParents(
  db: D1Database,
  input: {
    familyId: string;
    childUserIds?: readonly string[];
    alertType: string;
    occurredAt?: string;
  },
): Promise<number> {
  const confirmation = resolveLocationAlertConfirmation(input.alertType);
  if (!confirmation || !nonEmpty(input.familyId)) {
    throw new Error("invalid_location_alert_confirmation");
  }

  const requestedChildIds = [...new Set(
    (input.childUserIds ?? []).filter(nonEmpty).map((value) => value.trim()),
  )];
  let subjectSql = `SELECT user_id FROM family_members
                     WHERE family_id = ? AND role = 'child' AND is_active = 1
                       AND user_id IS NOT NULL`;
  const subjectBindings: string[] = [input.familyId];
  if (requestedChildIds.length > 0) {
    subjectSql += ` AND user_id IN (${requestedChildIds.map(() => "?").join(",")})`;
    subjectBindings.push(...requestedChildIds);
  }
  subjectSql += " ORDER BY user_id ASC";
  const { results: subjects } = await db
    .prepare(subjectSql)
    .bind(...subjectBindings)
    .all<{ user_id: string }>();

  const { results: parents } = await db
    .prepare(
      `SELECT parent_user_id FROM (
         SELECT parent_id AS parent_user_id FROM families WHERE id = ?1
         UNION
         SELECT user_id AS parent_user_id FROM family_members
          WHERE family_id = ?1 AND role = 'parent' AND is_active = 1
            AND user_id IS NOT NULL
       )
       WHERE parent_user_id IS NOT NULL AND length(parent_user_id) > 0
       ORDER BY parent_user_id ASC`,
    )
    .bind(input.familyId)
    .all<{ parent_user_id: string }>();

  const activeSubjects = subjects ?? [];
  const activeParents = parents ?? [];
  if (
    activeSubjects.length === 0
    || activeParents.length === 0
    || (requestedChildIds.length > 0 && activeSubjects.length !== requestedChildIds.length)
  ) {
    throw new Error("location_alert_audience_unavailable");
  }

  const confirmations: LocationConfirmationInput[] = [];
  for (const subject of activeSubjects) {
    for (const parent of activeParents) {
      confirmations.push({
        familyId: input.familyId,
        subjectUserId: String(subject.user_id),
        action: "provide",
        requesterKind: "system",
        requesterUserId: null,
        recipientKind: "family_parent",
        recipientUserId: String(parent.parent_user_id),
        collectionMethod: "not_applicable",
        acquisitionPath: confirmation.acquisitionPath,
        serviceCode: "location_alert_delivery",
        deliveryMethod: "push_notification",
        purposeCode: confirmation.purposeCode,
        occurredAt: input.occurredAt,
      });
    }
  }
  return await recordLocationConfirmations(db, confirmations);
}

export function locationConfirmationRetentionCutoff(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - LOCATION_CONFIRMATION_RETENTION_MONTHS;
  const targetMonthStart = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  return new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth(),
    Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  ));
}

export async function cleanupLocationConfirmationRecords(
  db: D1Database,
  now = new Date(),
): Promise<{ removedRows: number }> {
  const cutoff = locationConfirmationRetentionCutoff(now)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const result = await db
    .prepare(
      `DELETE FROM location_confirmation_records
        WHERE id IN (
          SELECT record.id FROM location_confirmation_records record
           WHERE substr(record.recorded_at,1,19) < ?1
           ORDER BY substr(record.recorded_at,1,19) ASC, record.id ASC
           LIMIT ?2
        )`,
    )
    .bind(cutoff, LOCATION_CONFIRMATION_DELETE_BATCH)
    .run();
  return { removedRows: Number(result.meta?.changes ?? 0) };
}

export async function runLocationConfirmationRetention(
  env: Pick<Env, "DB">,
): Promise<{ removedRows: number }> {
  const result = await cleanupLocationConfirmationRecords(env.DB);
  if (result.removedRows >= LOCATION_CONFIRMATION_DELETE_BATCH) {
    writeOperationalLog("warn", "location_confirmation_retention_batch_saturated", {
      count: result.removedRows,
    });
  }
  return result;
}
