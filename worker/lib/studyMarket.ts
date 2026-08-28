import { assertPrimaryParent } from "../db/authz";

type StudyMarket = "KR" | null;
type ServiceCountrySource = "edge_suggested" | "guardian_confirmed" | "guardian_changed";

// ISO 3166-1 alpha-2 중 사용자 서비스 국가로 저장 가능한 값만 고정한다.
// access-region의 ZZ fallback은 화면 힌트일 뿐 이 목록에 포함하지 않는다.
const SERVICE_COUNTRY_CODE_LIST = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU
MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA
SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM
US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/);
const ISO_3166_1_ALPHA_2_CODE_COUNT = 249;

if (
  SERVICE_COUNTRY_CODE_LIST.length !== ISO_3166_1_ALPHA_2_CODE_COUNT
  || new Set(SERVICE_COUNTRY_CODE_LIST).size !== ISO_3166_1_ALPHA_2_CODE_COUNT
) {
  throw new Error("service_country_iso_3166_1_alpha_2_list_invalid");
}

const SERVICE_COUNTRY_CODES = new Set(SERVICE_COUNTRY_CODE_LIST);

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
  | { status: 409; error: "service_country_version_conflict"; rowVersion: number }
  | { status: 409; error: "service_country_request_id_conflict" };

export interface InitialServiceCountry {
  country: string;
  source: ServiceCountrySource;
  studyMarket: StudyMarket;
  confirmedAt: string | null;
}

export function normalizeServiceCountry(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SERVICE_COUNTRY_CODES.has(code) ? code : null;
}

export function studyMarketForCountry(country: string | null): StudyMarket {
  return country === "KR" ? "KR" : null;
}

export function resolveInitialServiceCountry(
  explicitValue: unknown,
  hasExplicitValue: boolean,
  matchedEdge: boolean,
  edgeValue: unknown,
  occurredAt: string,
): { initial: InitialServiceCountry | null; error: "invalid_service_country" | null } {
  if (hasExplicitValue) {
    const country = normalizeServiceCountry(explicitValue);
    if (!country) return { initial: null, error: "invalid_service_country" };
    return {
      initial: {
        country,
        source: matchedEdge ? "guardian_confirmed" : "guardian_changed",
        studyMarket: studyMarketForCountry(country),
        confirmedAt: occurredAt,
      },
      error: null,
    };
  }
  const edgeCountry = normalizeServiceCountry(edgeValue);
  return edgeCountry
    ? { initial: { country: edgeCountry, source: "edge_suggested", studyMarket: null, confirmedAt: null }, error: null }
    : { initial: null, error: null };
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

export async function hasRegistrationCountryColumn(db: D1Database): Promise<boolean> {
  const { results } = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  return (results ?? []).some((column) => column.name === "registration_country");
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

async function canonicalFamilyServiceCountry(
  db: D1Database,
  familyId: string,
): Promise<{ serviceCountry: string; studyMarket: StudyMarket; source: "guardian_confirmed" | "guardian_changed"; rowVersion: number } | null> {
  const row = await db.prepare(
    `SELECT service_country, service_country_source, study_market, service_country_row_version
       FROM families WHERE id=? LIMIT 1`,
  ).bind(familyId).first<{
    service_country: string | null;
    service_country_source: ServiceCountrySource | null;
    study_market: StudyMarket;
    service_country_row_version: number;
  }>();
  if (
    !row?.service_country
    || (row.service_country_source !== "guardian_confirmed" && row.service_country_source !== "guardian_changed")
  ) return null;
  return {
    serviceCountry: row.service_country,
    studyMarket: row.study_market,
    source: row.service_country_source,
    rowVersion: Number(row.service_country_row_version),
  };
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
    `SELECT family_id, actor_user_id, setting, next_value, request_row_version
       FROM study_setting_audit WHERE request_id=? LIMIT 1`,
  ).bind(input.requestId).first<{
    family_id: string;
    actor_user_id: string;
    setting: string;
    next_value: string | null;
    request_row_version: number;
  }>();
  if (existingAudit) {
    if (
      existingAudit.family_id !== input.familyId
      || existingAudit.actor_user_id !== input.actorId
      || existingAudit.setting !== "service_country"
      || existingAudit.next_value !== country
      || Number(existingAudit.request_row_version) !== input.rowVersion
    ) return { status: 409, error: "service_country_request_id_conflict" };
    const canonical = await canonicalFamilyServiceCountry(db, input.familyId);
    return canonical
      ? { status: 200, ...canonical }
      : { status: 409, error: "service_country_version_conflict", rowVersion: input.rowVersion };
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
       (id, family_id, member_id, actor_user_id, setting, previous_value, next_value, request_id, request_row_version, occurred_at)
     SELECT ?,?,?,?, 'service_country', ?,?,?,?,?
      WHERE changes()=1`,
  ).bind(crypto.randomUUID(), input.familyId, null, input.actorId, current.service_country, country, input.requestId, currentVersion, input.occurredAt);
  try {
    const [updated, audited] = await db.batch([update, audit]);
    if (Number(updated?.meta?.changes ?? 0) !== 1 || Number(audited?.meta?.changes ?? 0) !== 1) {
      const retryAudit = await db.prepare(
        "SELECT family_id, actor_user_id, setting, next_value, request_row_version FROM study_setting_audit WHERE request_id=? LIMIT 1",
      ).bind(input.requestId).first<{ family_id: string; actor_user_id: string; setting: string; next_value: string | null; request_row_version: number }>();
      if (retryAudit) {
        if (
          retryAudit.family_id !== input.familyId
          || retryAudit.actor_user_id !== input.actorId
          || retryAudit.setting !== "service_country"
          || retryAudit.next_value !== country
          || Number(retryAudit.request_row_version) !== input.rowVersion
        ) return { status: 409, error: "service_country_request_id_conflict" };
        const canonical = await canonicalFamilyServiceCountry(db, input.familyId);
        if (canonical) return { status: 200, ...canonical };
      }
      const latest = await db.prepare("SELECT service_country_row_version FROM families WHERE id=? LIMIT 1")
        .bind(input.familyId).first<{ service_country_row_version: number }>();
      return { status: 409, error: "service_country_version_conflict", rowVersion: Number(latest?.service_country_row_version ?? currentVersion) };
    }
  } catch {
    const retryAudit = await db.prepare(
      "SELECT family_id, actor_user_id, setting, next_value, request_row_version FROM study_setting_audit WHERE request_id=? LIMIT 1",
    ).bind(input.requestId).first<{ family_id: string; actor_user_id: string; setting: string; next_value: string | null; request_row_version: number }>();
    if (retryAudit) {
      if (
        retryAudit.family_id !== input.familyId
        || retryAudit.actor_user_id !== input.actorId
        || retryAudit.setting !== "service_country"
        || retryAudit.next_value !== country
        || Number(retryAudit.request_row_version) !== input.rowVersion
      ) return { status: 409, error: "service_country_request_id_conflict" };
      const canonical = await canonicalFamilyServiceCountry(db, input.familyId);
      if (canonical) return { status: 200, ...canonical };
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
