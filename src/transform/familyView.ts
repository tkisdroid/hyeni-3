/**
 * 실 가족 멤버(FamilyMember) → 가족 화면 뷰모델 매핑(순수).
 * 도메인 데이터(이름/역할/사진)는 실값, 표현(기본 아바타/배경)은 파생.
 * 배터리는 아이 기기 자기-리포트(device_health)에서 반영(미리포트면 null).
 */
import type { DeviceHealth, FamilyMember } from "@/lib/api/endpoints/family";
import { unlockCountLabel } from "./deviceUnlock";
import { childAvatarPath } from "@/lib/avatar";
import {
  buildDeviceAppUsageView,
  type DeviceAppUsageItemView,
} from "./deviceAppUsageView";
import { formatFreshness } from "./locationView";

export interface ParentView {
  id: string;
  name: string;
  roleLabel: string;
  avatar: string;
  isMe: boolean;
}

export interface ChildView {
  id: string;
  name: string;
  info: string;
  avatar: string;
  soft: string;
  battery: number | null;
  place: string | null;
  /** 아이 기기가 리포트한 기기명(예: "삼성 SM-A175N"). 미리포트면 null. */
  deviceLabel: string | null;
  /** 아이 계정 user_id(연결 해제·삭제 대상 식별). 미연결 placeholder 면 null. */
  userId: string | null;
}

const CHILD_SOFTS = ["#FDE7F1", "#E6F2FB", "#E7F8F0", "#FDF0DA"];

function parentRoleLabel(gender: string | null | undefined): string {
  if (gender === "mom") return "엄마 · 보호자";
  if (gender === "dad") return "아빠 · 보호자";
  return "보호자";
}

function parentAvatar(gender: string | null | undefined): string {
  if (gender === "dad") return "family/dad.webp";
  return "family/mom.webp";
}

export interface FamilyView {
  parents: ParentView[];
  children: ChildView[];
}

/** members → {parents, children}. currentUserId 로 "나" 표시. */
export function mapFamilyToView(members: FamilyMember[], currentUserId: string | null): FamilyView {
  const parents: ParentView[] = members
    .filter((m) => m.role === "parent")
    .map((m) => ({
      id: m.id,
      name: m.name || "보호자",
      roleLabel: parentRoleLabel(m.gender),
      avatar: parentAvatar(m.gender),
      isMe: !!currentUserId && m.user_id === currentUserId,
    }));

  const childMembers = members
    .filter((m) => m.role === "child")
    .sort((a, b) => (a.child_order ?? 99) - (b.child_order ?? 99));

  const children: ChildView[] = childMembers.map((m, i) => ({
    id: m.id,
    name: m.name || "아이",
    info: "",
    avatar: childAvatarPath(m.photo_url),
    soft: CHILD_SOFTS[i % CHILD_SOFTS.length],
    battery: m.device_health?.batteryLevel ?? null, // 아이 기기 리포트 반영(미리포트=null)
    place: null,
    deviceLabel: m.device_label?.trim() || null, // 아이 기기 자기-리포트(미리포트=null)
    userId: m.user_id || null,
  }));

  return { parents, children };
}

// ── 안전 지표(아이 기기 상태) 뷰 ───────────────────────────────────────────────
// 부모 홈 '안전 지표' 섹션이 쓰는 라벨. device_health 없으면 hasData=false + 정직 문구
// ("아이 기기 연동 대기 중")로 표기하고 가짜 숫자를 절대 만들지 않는다.

export interface DeviceStatusView {
  /** device_health 존재 여부(없으면 화면이 대기 안내로 전환). */
  hasData: boolean;
  batteryLevel: number | null;
  batteryLabel: string; // "82%" | "—"
  unlockCountLabel: string; // 오늘 화면잠금 해제 "N회" | "0회"(권한없음/미보고). 알림 화면켜짐은 미포함
  networkLabel: string; // "Wi-Fi"/"4G"/"연결됨" | "오프라인" | "—"
  screenTimeLabel: string; // 네이티브 deviceScreenOnMs → "N시간 M분"; 웹은 "—"
  recentAppLabel: string | null; // 네이티브 recentApp(최근 사용앱). 없거나 권한없으면 null
  mostUsedApp: DeviceRecentAppView | null;
  topApps: DeviceRecentAppView[];
  recentApps: DeviceRecentAppView[];
  freshnessLabel: string; // "방금 업데이트" | "N분 전" | "아이 기기 연동 대기 중"
  safetyLabel: string; // "양호" | "주의 필요" | "확인 중"
}

export type DeviceRecentAppView = DeviceAppUsageItemView;

// 오늘 화면 사용시간(ms) → "N시간 M분" / "N분". 없거나 0이면 null.
function screenTimeLabelFrom(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

// 저배터리 임계(주의). hyeni-1 deviceSafety 규칙과 동일.
const LOW_BATTERY_THRESHOLD = 15;

// connection.effectiveType → 사람이 읽는 네트워크 라벨.
function networkTypeLabel(networkType: string | null): string {
  const t = (networkType || "").trim().toLowerCase();
  if (t === "wifi" || t === "wi-fi" || t === "wlan") return "Wi-Fi";
  if (t === "slow-2g" || t === "2g") return "2G";
  if (t === "3g") return "3G";
  if (t === "4g") return "4G";
  if (t === "5g") return "5G";
  return "연결됨";
}

/**
 * 자녀 device_health → 안전 지표 뷰(라벨). 미리포트면 hasData=false + 모두 "—"/대기 문구.
 * 화면시간은 웹 수집 불가라 항상 "—". 배터리 ≤ 15% = "주의 필요", 데이터 없으면 "확인 중".
 */
export function deviceStatusView(
  health: DeviceHealth | null | undefined,
  now: Date = new Date(),
): DeviceStatusView {
  if (!health) {
    return {
      hasData: false,
      batteryLevel: null,
      batteryLabel: "—",
      unlockCountLabel: "0회",
      networkLabel: "—",
      screenTimeLabel: "—",
      recentAppLabel: null,
      mostUsedApp: null,
      topApps: [],
      recentApps: [],
      freshnessLabel: "아이 기기 연동 대기 중",
      safetyLabel: "확인 중",
    };
  }
  const level = typeof health.batteryLevel === "number" ? health.batteryLevel : null;
  // 네이티브(LocationService) 리포트는 connectionType, 웹 리포트는 networkType 을 준다.
  const netType = health.connectionType ?? health.networkType;
  const screen = screenTimeLabelFrom(health.deviceScreenOnMs);
  const appUsage = buildDeviceAppUsageView(health);
  return {
    hasData: true,
    batteryLevel: level,
    batteryLabel: level == null ? "—" : `${level}%`,
    unlockCountLabel: unlockCountLabel(health.deviceUnlockCount),
    networkLabel: health.networkConnected ? networkTypeLabel(netType) : "오프라인",
    screenTimeLabel: screen ?? "—",
    recentAppLabel: appUsage.recentAppLabel,
    mostUsedApp: appUsage.mostUsedApp,
    topApps: appUsage.topApps,
    recentApps: appUsage.topApps,
    freshnessLabel: health.lastReportedAt ? formatFreshness(health.lastReportedAt, now).label : "방금 업데이트",
    safetyLabel: level != null && level <= LOW_BATTERY_THRESHOLD ? "주의 필요" : "양호",
  };
}
