export type TierAlertInactiveReason = "premium_required";

export interface TierAlertActivationFields {
  tier_alert_active: boolean;
  tier_alert_inactive_reason: TierAlertInactiveReason | null;
}

interface TierAlertRow {
  id: unknown;
  created_at?: unknown;
}

interface FamilyTierAlertRow extends TierAlertRow {
  family_id: unknown;
}

function familyTierAlertRowKey(row: FamilyTierAlertRow): string {
  return JSON.stringify([
    String(row.family_id ?? ""),
    String(row.id ?? ""),
  ]);
}

function compareStableText(left: unknown, right: unknown): number {
  const a = typeof left === "string" ? left : String(left ?? "");
  const b = typeof right === "string" ? right : String(right ?? "");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stableCreatedAt(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.slice(0, 19);
}

/**
 * 저장 데이터는 보존하면서 현재 티어에서 실제 알림 대상인 항목을 안정적으로 표시한다.
 * created_at이 같은 경우 id로 순서를 고정해 API와 cron의 선택 결과가 달라지지 않게 한다.
 */
export function annotateTierAlertActivation<T extends TierAlertRow>(
  rows: readonly T[],
  limit: number | null,
): Array<T & TierAlertActivationFields> {
  const ordered = [...rows].sort((left, right) => {
    const createdAtOrder = compareStableText(
      stableCreatedAt(left.created_at),
      stableCreatedAt(right.created_at),
    );
    return createdAtOrder !== 0 ? createdAtOrder : compareStableText(left.id, right.id);
  });
  const normalizedLimit = limit == null ? null : Math.max(0, Math.floor(limit));

  return ordered.map((row, index) => {
    const active = normalizedLimit == null || index < normalizedLimit;
    return {
      ...row,
      tier_alert_active: active,
      tier_alert_inactive_reason: active ? null : "premium_required",
    };
  });
}

/**
 * PostgREST 호환 조회처럼 여러 가족 행이 섞일 수 있는 응답에 가족별 한도를 합친다.
 * 실제 반환 순서는 호출자가 지정한 order 계약을 보존하고, 대상 선정만 안정적 순서를 쓴다.
 */
export function annotateTierAlertActivationByFamily<T extends FamilyTierAlertRow>(
  rows: readonly T[],
  limitsByFamily: ReadonlyMap<string, number | null>,
): Array<T & TierAlertActivationFields> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const familyId = String(row.family_id ?? "");
    const group = grouped.get(familyId) ?? [];
    group.push(row);
    grouped.set(familyId, group);
  }

  const statusByRow = new Map<string, TierAlertActivationFields>();
  for (const [familyId, familyRows] of grouped) {
    const limit = limitsByFamily.has(familyId) ? limitsByFamily.get(familyId)! : 0;
    for (const row of annotateTierAlertActivation(familyRows, limit)) {
      statusByRow.set(familyTierAlertRowKey(row), {
        tier_alert_active: row.tier_alert_active,
        tier_alert_inactive_reason: row.tier_alert_inactive_reason,
      });
    }
  }

  return rows.map((row) => ({
    ...row,
    ...(statusByRow.get(familyTierAlertRowKey(row)) ?? {
      tier_alert_active: false,
      tier_alert_inactive_reason: "premium_required" as const,
    }),
  }));
}

/** 필터·limit이 적용된 선택 응답에도 가족 전체 정본에서 계산한 상태를 합친다. */
export function annotateTierAlertActivationSelection<
  TSelected extends FamilyTierAlertRow,
  TCanonical extends FamilyTierAlertRow,
>(
  selectedRows: readonly TSelected[],
  canonicalRows: readonly TCanonical[],
  limitsByFamily: ReadonlyMap<string, number | null>,
): Array<TSelected & TierAlertActivationFields> {
  const canonical = annotateTierAlertActivationByFamily(canonicalRows, limitsByFamily);
  const statusByRow = new Map<string, TierAlertActivationFields>();
  for (const row of canonical) {
    statusByRow.set(familyTierAlertRowKey(row), {
      tier_alert_active: row.tier_alert_active,
      tier_alert_inactive_reason: row.tier_alert_inactive_reason,
    });
  }

  return selectedRows.map((row) => ({
    ...row,
    ...(statusByRow.get(familyTierAlertRowKey(row)) ?? {
      tier_alert_active: false,
      tier_alert_inactive_reason: "premium_required" as const,
    }),
  }));
}
