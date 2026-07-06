/**
 * 아이 기기 상태(배터리·충전·네트워크) 수집 — Web API 기반.
 *
 * `DeviceStatusReporter` 네이티브 플러그인은 등록된 JS 플러그인이 아니므로 네이티브 호출을
 * 쓰지 않고 웹 표준 API 로 수집한다: navigator.getBattery() / navigator.onLine /
 * navigator.connection.effectiveType. Android WebView 에서도 그대로 동작한다.
 *
 * 미지원 브라우저(getBattery 없음 등)에선 batteryLevel/isCharging = null → 부모 화면이 "—"
 * 로 정직 처리한다(가짜 숫자 금지). 화면시간·앱 사용시간은 네이티브 UsageStats 가 필요해
 * 이 수집에는 포함되지 않는다.
 */
import type { DeviceHealth } from "@/lib/api/endpoints/family";
import { getOrCreateDeviceInstallId } from "@/lib/native/deviceIdentity";

// navigator.getBattery() 가 반환하는 BatteryManager 의 사용 부분만(표준 타입 미제공 대비).
interface BatteryLike {
  level: number; // 0..1
  charging: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

type BatterySource = { getBattery?: () => Promise<BatteryLike> };
type ConnectionSource = { connection?: { effectiveType?: string } };

// getBattery 는 Promise 반환 + 일부 브라우저 미지원 → 가드/폴백. 실패 시 배터리값 null.
async function readBattery(): Promise<{ batteryLevel: number | null; isCharging: boolean | null }> {
  try {
    const getBattery = (navigator as unknown as BatterySource).getBattery;
    if (typeof getBattery !== "function") return { batteryLevel: null, isCharging: null };
    const battery = await getBattery.call(navigator);
    if (!battery) return { batteryLevel: null, isCharging: null };
    const level =
      typeof battery.level === "number"
        ? Math.max(0, Math.min(100, Math.round(battery.level * 100)))
        : null;
    return { batteryLevel: level, isCharging: typeof battery.charging === "boolean" ? battery.charging : null };
  } catch {
    return { batteryLevel: null, isCharging: null };
  }
}

// navigator.onLine + connection.effectiveType(있으면). 미지원 시 networkType=null(연결됨으로 표기).
function readNetwork(): { networkConnected: boolean; networkType: string | null } {
  const networkConnected = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
  let networkType: string | null = null;
  try {
    networkType = (navigator as unknown as ConnectionSource).connection?.effectiveType ?? null;
  } catch {
    networkType = null;
  }
  return { networkConnected, networkType };
}

/**
 * 현재 기기 상태 스냅샷 수집. 시각은 Date.now 를 직접 부르지 않고 호출부가 넘긴 now(ms)를
 * lastReportedAt(ISO)로 기록한다(테스트·일관성).
 */
export async function collectDeviceHealth(now: number): Promise<DeviceHealth> {
  const { batteryLevel, isCharging } = await readBattery();
  const { networkConnected, networkType } = readNetwork();
  return {
    batteryLevel,
    isCharging,
    networkConnected,
    networkType,
    deviceInstallId: getOrCreateDeviceInstallId(),
    lastReportedAt: new Date(now).toISOString(),
  };
}

/**
 * 배터리 상태 변화(충전 시작/종료·레벨 변동)에 콜백을 붙인다. Promise<정리함수|null>.
 * getBattery 미지원이면 no-op(null). 반환 함수 호출로 리스너를 해제한다.
 */
export async function attachBatteryChange(onChange: () => void): Promise<(() => void) | null> {
  try {
    const getBattery = (navigator as unknown as BatterySource).getBattery;
    if (typeof getBattery !== "function") return null;
    const battery = await getBattery.call(navigator);
    if (!battery || typeof battery.addEventListener !== "function") return null;
    battery.addEventListener("chargingchange", onChange);
    battery.addEventListener("levelchange", onChange);
    return () => {
      try {
        battery.removeEventListener?.("chargingchange", onChange);
        battery.removeEventListener?.("levelchange", onChange);
      } catch {
        /* 정리 실패는 무시(리스너 누수보다 크래시 방지 우선) */
      }
    };
  } catch {
    return null;
  }
}
