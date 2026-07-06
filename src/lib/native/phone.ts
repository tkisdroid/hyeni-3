/**
 * 전화 걸기 네이티브 브리지(hyeni-1 nativePhoneCall.js 이관).
 *
 * - 네이티브(안드로이드): 커스텀 `PhoneCall` 플러그인의 `placeCall` — CALL_PHONE 권한
 *   보유 시 즉시 발신(ACTION_CALL), 미보유 시 통화 직전 권한 요청 후 거부하면
 *   다이얼러(ACTION_DIAL)로 폴백한다.
 * - 그 외(웹/PWA·플러그인 미탑재): `window.location` 의 `tel:` 로 다이얼러를 연다.
 *
 * 어떤 경로든 예외를 삼키고 결과 객체로 성패를 반환한다 — SOS 등 긴급 흐름이
 * 전화 한 단계 실패로 막혀선 안 된다.
 */
import { getNativePlugin } from "./plugins";

/** PhoneCall 커스텀 플러그인 계약(Java PhoneCallPlugin, name="PhoneCall"). */
interface PhoneCallPlugin {
  placeCall(options: { number: string }): Promise<{ called?: boolean; dialed?: boolean }>;
  checkPermission?(): Promise<{ granted: boolean }>;
  requestPermission?(): Promise<{ granted: boolean }>;
}

/** placePhoneCall 결과. */
export interface PlaceCallResult {
  /** 발신 또는 다이얼러 열기 중 하나라도 성공. */
  ok: boolean;
  /** 자동 발신됨(네이티브 ACTION_CALL). */
  called: boolean;
  /** 다이얼러만 열림(ACTION_DIAL 또는 웹 tel:). */
  dialed: boolean;
  /** 웹 tel: 폴백 경로 사용. */
  web: boolean;
}

/** tel: URI 에 안전한 문자(숫자·+)만 남긴다. */
export function sanitizePhoneNumber(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^0-9+]/g, "");
}

/**
 * 지정한 번호로 전화를 시도한다. 네이티브면 자동 발신(권한 시), 아니면 tel: 다이얼러.
 * @param rawNumber 원본 전화번호(하이픈 등 포함 가능)
 */
export async function placePhoneCall(rawNumber: string): Promise<PlaceCallResult> {
  const number = sanitizePhoneNumber(rawNumber);
  const fail: PlaceCallResult = { ok: false, called: false, dialed: false, web: false };
  if (!number || number.length < 3) return fail;

  // 네이티브(안드로이드): PhoneCall.placeCall. 웹이면 getNativePlugin 이 null → 건너뜀.
  try {
    const plugin = getNativePlugin<PhoneCallPlugin>("PhoneCall");
    if (plugin && typeof plugin.placeCall === "function") {
      const res = await plugin.placeCall({ number });
      return { ok: true, called: !!res?.called, dialed: !!res?.dialed, web: false };
    }
  } catch (err) {
    console.warn("[placePhoneCall] 네이티브 발신 실패, tel: 폴백:", err instanceof Error ? err.message : err);
  }

  // 웹/폴백: 다이얼러 열기(tel:). 데스크톱 웹에선 사실상 no-op 이나 앱은 깨지지 않는다.
  try {
    if (typeof window !== "undefined" && window.location) {
      window.location.href = `tel:${number}`;
      return { ok: true, called: false, dialed: true, web: true };
    }
  } catch (err) {
    console.warn("[placePhoneCall] tel: 폴백 실패:", err instanceof Error ? err.message : err);
  }
  return fail;
}
