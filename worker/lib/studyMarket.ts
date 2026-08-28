import { assertPrimaryParent } from "../db/authz";

type StudyMarket = "KR" | null;
type ServiceCountrySource = "edge_suggested" | "guardian_confirmed" | "guardian_changed";

export interface ConfirmServiceCountryInput {
  actorId: string;
  familyId: string;
  country: unknown;
  rowVersion: unknown;
  requestId: string;
  occurredAt: string;
}

export type ConfirmServiceCountryResult =
  | { status: 200; serviceCountry: string; studyMarket: StudyMarket; source: "guardian_confirmed" | "guardian_changed"; rowVersion: number }
  | { status: 400; error: "invalid_service_country" | "invalid_service_country_row_version" }
  | { status: 403; error: "primary_parent_required" }
  | { status: 409; error: "service_country_version_conflict"; rowVersion: number };

export function normalizeServiceCountry(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function studyMarketForCountry(country: string | null): StudyMarket {
  return country === "KR" ? "KR" : null;
}

function asInitialSource(
  confirmed: boolean,
  changed: boolean,
): ServiceCountrySource {
  if (!confirmed) return "edge_suggested";
  return changed ? "guardian_changed" : "guardian_confirmed";
}

export async function recordRegistrationCountry(
  db: D1Database,
  userId: string,
  edgeCountry: unknown,
): Promise<void> {
  const country = normalizeServiceCountry(edgeCountry);
  if (!userId || !country) return;
  try {
    await db.prepare(
      `UPDATE users
          SET registration_country=COALESCE(registration_country, ?)
        WHERE id=?`,
    ).bind(country, userId).run();
  } catch (error) {
    // expand-only migration이 아직 적용되지 않은 DB에서는 인증·세션 발급을 막지 않는다.
    if (!/no such column:\s*registration_country/i.test(String(error))) throw error;
  }
}

export async function storeInitialServiceCountry(
  db: D1Database,
  familyId: string,
  countryValue: unknown,
  guardianConfirmed: boolean,
  guardianChanged = false,
): Promise<{ serviceCountry: string | null; source: ServiceCountrySource | null; studyMarket: StudyMarket }> {
  const country = normalizeServiceCountry(countryValue);
  if (!familyId || !country) return { serviceCountry: null, source: null, studyMarket: null };
  const source = asInitialSource(guardianConfirmed, guardianChanged);
  const studyMarket = guardianConfirmed ? studyMarketForCountry(country) : null;
  const confirmedAt = guardianConfirmed ? new Date().toISOString() : null;
  await db.prepare(
    `UPDATE families
        SET service_country=?,
            service_country_source=?,
            service_country_confirmed_at=?,
            study_market=?,
            service_country_row_version=service_country_row_version+1
      WHERE id=? AND service_country IS NULL`,
  ).bind(country, source, confirmedAt, studyMarket, familyId).run();
  const stored = await db.prepare(
    `SELECT service_country, service_country_source, study_market
       FROM families WHERE id=? LIMIT 1`,
  ).bind(familyId).first<{ service_country: string | null; service_country_source: ServiceCountrySource | null; study_market: StudyMarket }>();
  return {
    serviceCountry: stored?.service_country ?? null,
    source: stored?.service_country_source ?? null,
    studyMarket: stored?.study_market ?? null,
  };
}

function validRowVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export async function confirmServiceCountry(
  db: D1Database,
  input: ConfirmServiceCountryInput,
): Promise<ConfirmServiceCountryResult> {
  const country = normalizeServiceCountry(input.country);
  if (!country) return { status: 400, error: "invalid_service_country" };
  if (!validRowVersion(input.rowVersion)) return { status: 400, error: "invalid_service_country_row_version" };
  if (!(await assertPrimaryParent(db, input.actorId, input.familyId))) {
    return { status: 403, error: "primary_parent_required" };
  }

  const existingAudit = await db.prepare(
    `SELECT next_value FROM study_setting_audit
      WHERE request_id=? AND family_id=? AND actor_user_id=? AND setting='service_country'
      LIMIT 1`,
  ).bind(input.requestId, input.familyId, input.actorId).first<{ next_value: string | null }>();
  if (existingAudit) {
    const storedCountry = normalizeServiceCountry(existingAudit.next_value) ?? country;
    return {
      status: 200,
      serviceCountry: storedCountry,
      studyMarket: studyMarketForCountry(storedCountry),
      source: "guardian_confirmed",
      rowVersion: input.rowVersion + 1,
    };
  }

  const current = await db.prepare(
    `SELECT service_country, service_country_confirmed_at, service_country_row_version
       FROM families WHERE id=? LIMIT 1`,
  ).bind(input.familyId).first<{
    service_country: string | null;
    service_country_confirmed_at: string | null;
    service_country_row_version: number;
  }>();
  if (!current) return { status: 403, error: "primary_parent_required" };
  const currentVersion = Number(current.service_country_row_version);
  if (currentVersion !== input.rowVersion) {
    return { status: 409, error: "service_country_version_conflict", rowVersion: currentVersion };
  }

  const source = current.service_country_confirmed_at ? "guardian_changed" : "guardian_confirmed";
  const studyMarket = studyMarketForCountry(country);
  const nextVersion = currentVersion + 1;
  const update = db.prepare(
    `UPDATE families
        SET service_country=?, service_country_source=?, service_country_confirmed_at=?,
            study_market=?, service_country_row_version=?
      WHERE id=? AND parent_id=? AND service_country_row_version=?`,
  ).bind(country, source, input.occurredAt, studyMarket, nextVersion, input.familyId, input.actorId, currentVersion);
  const audit = db.prepare(
    `INSERT INTO study_setting_audit
       (id, family_id, member_id, actor_user_id, setting, previous_value, next_value, request_id, occurred_at)
     VALUES (?,?,?,?, 'service_country', ?,?,?,?)`,
  ).bind(crypto.randomUUID(), input.familyId, null, input.actorId, current.service_country, country, input.requestId, input.occurredAt);
  try {
    const [updated] = await db.batch([update, audit]);
    if (Number(updated?.meta?.changes ?? 0) !== 1) {
      const latest = await db.prepare("SELECT service_country_row_version FROM families WHERE id=? LIMIT 1")
        .bind(input.familyId).first<{ service_country_row_version: number }>();
      return { status: 409, error: "service_country_version_conflict", rowVersion: Number(latest?.service_country_row_version ?? currentVersion) };
    }
  } catch {
    const retryAudit = await db.prepare(
      "SELECT next_value FROM study_setting_audit WHERE request_id=? AND family_id=? AND actor_user_id=? AND setting='service_country' LIMIT 1",
    ).bind(input.requestId, input.familyId, input.actorId).first<{ next_value: string | null }>();
    if (retryAudit) {
      const storedCountry = normalizeServiceCountry(retryAudit.next_value) ?? country;
      return { status: 200, serviceCountry: storedCountry, studyMarket: studyMarketForCountry(storedCountry), source: "guardian_confirmed", rowVersion: nextVersion };
    }
    throw new Error("service_country_write_failed");
  }
  return { status: 200, serviceCountry: country, studyMarket, source, rowVersion: nextVersion };
}

export async function studyMarketForMember(
  db: D1Database,
  memberId: string,
): Promise<StudyMarket> {
  const row = await db.prepare(
    `SELECT f.study_market
       FROM family_members fm
       JOIN families f ON f.id=fm.family_id
      WHERE fm.id=? AND fm.role='child' AND fm.is_active=1
      LIMIT 1`,
  ).bind(memberId).first<{ study_market: StudyMarket }>();
  return row?.study_market ?? null;
}
