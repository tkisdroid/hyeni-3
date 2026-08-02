import { pgNow } from "./time.ts";

export const COMMERCE_RUNTIME_CONTROLS_KEY = "commerce_runtime_controls_v1";

export interface CommerceRuntimeControls {
  webSubscriptionNewCheckoutsEnabled: boolean;
  webAiCreditNewCheckoutsEnabled: boolean;
}

export interface CommerceRuntimeControlsState {
  controls: CommerceRuntimeControls;
  configured: boolean;
}

const CLOSED_CONTROLS: CommerceRuntimeControls = Object.freeze({
  webSubscriptionNewCheckoutsEnabled: false,
  webAiCreditNewCheckoutsEnabled: false,
});

function parseControls(value: unknown): CommerceRuntimeControls | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.webSubscriptionNewCheckoutsEnabled !== "boolean"
    || typeof record.webAiCreditNewCheckoutsEnabled !== "boolean"
  ) return null;
  return {
    webSubscriptionNewCheckoutsEnabled: record.webSubscriptionNewCheckoutsEnabled,
    webAiCreditNewCheckoutsEnabled: record.webAiCreditNewCheckoutsEnabled,
  };
}

function parseStoredControls(value: unknown): CommerceRuntimeControls | null {
  if (typeof value !== "string") return null;
  try {
    return parseControls(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseCommerceRuntimeControls(value: unknown): CommerceRuntimeControls {
  return parseStoredControls(value) ?? CLOSED_CONTROLS;
}

/**
 * 운영 화면용 진단 조회다. 행 누락·형식 오류는 configured=false로 구분하고,
 * D1 장애는 호출자에게 전파해 정상적인 전체 중지 상태로 오인하지 않게 한다.
 */
export async function inspectCommerceRuntimeControls(
  db: D1Database,
): Promise<CommerceRuntimeControlsState> {
  const row = await db.prepare(
    "SELECT value FROM app_global_settings WHERE key=? LIMIT 1",
  ).bind(COMMERCE_RUNTIME_CONTROLS_KEY).first<{ value: string }>();
  const controls = parseStoredControls(row?.value);
  return controls
    ? { controls, configured: true }
    : { controls: CLOSED_CONTROLS, configured: false };
}

/**
 * 신규 결제 개방 여부는 행 누락·형식 오류·D1 오류에서 모두 닫는다.
 * 기존 주문 완료·대사·해지·환불 경로는 이 설정을 읽지 않는다.
 */
export async function readCommerceRuntimeControls(
  db: D1Database,
): Promise<CommerceRuntimeControls> {
  try {
    return (await inspectCommerceRuntimeControls(db)).controls;
  } catch {
    console.error("[commerce-controls] read failed");
    return CLOSED_CONTROLS;
  }
}

/** 관리자 전용 라우트에서 두 결제 채널을 한 행으로 원자 갱신한다. */
export async function writeCommerceRuntimeControls(
  db: D1Database,
  controls: CommerceRuntimeControls,
  updatedBy: string,
): Promise<CommerceRuntimeControls> {
  const value = JSON.stringify(controls);
  await db.prepare(
    `INSERT INTO app_global_settings (key,value,updated_by,updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_by=excluded.updated_by,
       updated_at=excluded.updated_at`,
  ).bind(COMMERCE_RUNTIME_CONTROLS_KEY, value, updatedBy, pgNow()).run();
  return controls;
}
