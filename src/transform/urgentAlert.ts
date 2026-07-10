/**
 * 부모 앱을 즉시 가로채(전면 SOS 수신 화면으로 전환) 할 알림인지 판정.
 *
 * SosReceive 화면은 "아이가 도움을 요청했어요" 전제로 설계돼 있다(전화·주변소리·안전확인).
 * 미도착(not_arrived)·도착 확인 필요 같은 알림까지 이 화면으로 보내면, 아이가 SOS 를 누른 것처럼
 * 보여 부모를 불필요하게 놀라게 한다. 특히 위치가 오래된 경우의 `not_arrived` 는 severity=warning
 * 으로 강등돼 나가므로(서버 partitionNotArrivedByFreshness) 더더욱 전면 전환 대상이 아니다.
 *
 * 미도착은 서버가 보내는 FCM(전체화면 인텐트)과 알림 목록으로 충분히 전달된다.
 */
export const URGENT_ALERT_TYPES = new Set(["sos", "emergency"]);

export interface UrgentAlertInput {
  role: string | null;
  alertType: string | null | undefined;
  currentHash: string;
}

export function shouldInterruptForUrgentAlert({ role, alertType, currentHash }: UrgentAlertInput): boolean {
  if (role !== "parent") return false;
  if (!alertType || !URGENT_ALERT_TYPES.has(alertType)) return false;
  // 이미 수신 화면이면 재이동하지 않는다(해시 재설정으로 화면이 깜빡이는 것 방지).
  if (currentHash.includes("sos-receive")) return false;
  return true;
}
