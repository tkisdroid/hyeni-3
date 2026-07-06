/**
 * 자녀 SOS 발송 엔드포인트.
 * hyeni-1 sendSos(§5 1~4단계)를 hyeni-3 계약으로 이관.
 * 순서: (1) 자녀 위치 upsert + 이력 → (2) parent_alert(sos) → (3) sos_events audit.
 *
 * 설계 원칙(hyeni-1 동일):
 *  - 각 단계는 fire-and-forget. 한 단계 실패가 다음 단계를 막지 않고 성패만 결과에 담는다.
 *  - 부모 긴급 알림이 최우선. 위치는 알림 발송을 막지 않도록 병렬(await 지연)로 수집한다.
 *  - 위치가 없으면(권한 거부 등) 위치 단계만 skip 하고 알림은 반드시 보낸다.
 *
 * ⚠️ 이 함수는 오직 사용자의 SOS 버튼 onClick(꾹 누르기/보내기)에서만 호출한다.
 *    컴포넌트 마운트·타 effect·타이머 단독으로는 절대 호출 금지.
 */
import { apiPost } from "../client";

/** 알림함/부모 오버레이에 뜨는 SOS 제목(hyeni-1 동일 문안). */
const SOS_TITLE = "🆘 도와줘요!";

export interface SendSosInput {
  familyId: string;
  /** 발신 자녀 user_id(= sender). 자녀 앱의 로그인 사용자. */
  childUserId: string;
  /** 자녀 현재 위도. 없으면(null) 위치 단계 skip. */
  lat?: number | null;
  /** 자녀 현재 경도. 없으면(null) 위치 단계 skip. */
  lng?: number | null;
  /** sos_events.receiver_user_ids 용 부모 user_id 목록. */
  parentUserIds?: string[];
  /** 알림 메시지에 쓸 자녀 이름(없으면 "아이"). */
  childName?: string;
}

export interface SendSosResult {
  locationSent: boolean;
  alertSent: boolean;
  auditSent: boolean;
}

/** sos_events 멱등키(client_request_hash). crypto.randomUUID 우선, 폴백 합성. */
function makeRequestHash(childUserId: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${childUserId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/**
 * 1단계: 자녀 현재위치 즉시 갱신(멱등 upsert) + 이력 1행.
 * hyeni-1 saveChildLocation/saveLocationHistory 를 그대로 이관(rest-shim-rpc 계약).
 * 내부에서 모든 에러를 catch 해 항상 boolean 을 resolve — reject 되지 않는다.
 */
async function upsertChildLocation(
  childUserId: string,
  familyId: string,
  lat: number,
  lng: number,
): Promise<boolean> {
  try {
    await apiPost("/rest/v1/rpc/upsert_child_location", {
      p_user_id: childUserId,
      p_family_id: familyId,
      p_lat: lat,
      p_lng: lng,
    });
    await apiPost("/rest/v1/rpc/record_location_history_rows", {
      p_rows: [{ user_id: childUserId, family_id: familyId, lat, lng }],
    });
    return true;
  } catch (err) {
    console.warn("[sendSos] 위치 갱신 실패:", err);
    return false;
  }
}

/**
 * SOS 발송. 단계별 성패를 담은 결과를 반환한다(전 단계 실패해도 reject 되지 않음).
 * 실제 부모 긴급 알림을 유발하므로 호출은 사용자 액션에서만.
 */
export async function sendSos(input: SendSosInput): Promise<SendSosResult> {
  const { familyId, childUserId, lat, lng, parentUserIds = [], childName } = input;
  if (!familyId || !childUserId) {
    return { locationSent: false, alertSent: false, auditSent: false };
  }

  const requestHash = makeRequestHash(childUserId);
  const message = `${childName || "아이"}님이 SOS를 보냈어요`;

  // 1단계: 자녀 위치 갱신 — 유효 좌표가 있을 때만. await 를 뒤로 미뤄 알림을 막지 않는다.
  const hasPosition =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  const locationPromise: Promise<boolean> = hasPosition
    ? upsertChildLocation(childUserId, familyId, lat as number, lng as number)
    : Promise.resolve(false);

  // 2단계: parent_alerts(sos) — "sos"는 서버 URGENT_TYPES → 부모 전체화면 오버레이. 최우선 신호.
  let alertSent = false;
  try {
    await apiPost("/api/parent-alerts", {
      family_id: familyId,
      alert_type: "sos",
      title: SOS_TITLE,
      message,
      severity: "urgent",
      event_id: null,
      // 다자녀 가정에서 어느 자녀의 SOS 인지 알림함에 표시되도록 발신 자녀 user_id 를 채운다.
      child_user_id: childUserId,
    });
    alertSent = true;
  } catch (err) {
    console.warn("[sendSos] 부모 알림 생성 실패:", err);
  }

  // 위치 결과 수집(알림은 이미 dispatch됨 — 여기서 기다려도 긴급 신호 도달을 더는 막지 않음).
  const locationSent = await locationPromise;

  // 3단계: sos_events audit insert — fire-and-forget. 실패해도 SOS 신호를 막지 않는다.
  let auditSent = false;
  try {
    await apiPost("/api/sos/events", {
      family_id: familyId,
      sender_user_id: childUserId,
      receiver_user_ids: parentUserIds,
      delivery_status: {
        alert: alertSent ? "sent" : "failed",
        location: locationSent ? "sent" : "failed",
      },
      client_request_hash: requestHash,
    });
    auditSent = true;
  } catch (err) {
    console.warn("[sendSos] sos_events 기록 실패:", err);
  }

  return { locationSent, alertSent, auditSent };
}
