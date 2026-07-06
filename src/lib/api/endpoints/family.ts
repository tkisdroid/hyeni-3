/**
 * 가족 도메인 엔드포인트.
 * 온보딩(setup/join)과 가족 화면(mine/profile/pair-code)이 공용.
 * join/join-as-parent 는 서버가 세션을 재발급하므로 applyApiSession + setApiUser 필수.
 */
import { apiGet, apiPost, apiPatch, childPhotoProxyUrl } from "../client";
import { applyApiSession, setApiUser, type ApiUser } from "../session";
import { normalizePhoneForStorage } from "@/transform/phone";

/**
 * 아이 기기 상태(웹 수집 부분집합). 서버 family_members.device_health(jsonb)에 저장.
 * 아이 기기가 스스로 리포트하고(PATCH /member/device) 부모는 /mine 응답에서 파싱된 객체로 읽는다.
 * - batteryLevel/isCharging: navigator.getBattery() 미지원 브라우저에선 null.
 * - networkConnected/networkType: navigator.onLine / connection.effectiveType.
 * - 화면시간·앱 사용시간은 네이티브 UsageStats 가 필요 → 이 부분집합에는 없음(부모 화면 "—").
 */
export interface DeviceHealth {
  batteryLevel: number | null;
  isCharging: boolean | null;
  networkConnected: boolean;
  networkType: string | null;
  /** 마지막 리포트 시각(ISO). 웹 리포트에만 확실히 존재. */
  lastReportedAt?: string;
  /** 네이티브(LocationService) 리치 리포트에만: 연결타입·오늘 화면사용(ms)·최근 사용앱. */
  connectionType?: string | null;
  deviceScreenOnMs?: number | null;
  recentApp?: string | null;
}

export interface FamilyMember {
  id: string;
  user_id: string | null;
  role: "parent" | "child";
  name?: string;
  phone?: string | null;
  gender?: string | null;
  emoji?: string | null;
  photo_url?: string | null;
  child_order?: number | null;
  color_hex?: string | null;
  birthdate?: string | null;
  device_label?: string | null;
  /** 아이 기기 자기-리포트 상태(부모 안전 지표원). 미리포트면 없음/null. */
  device_health?: DeviceHealth | null;
}

export interface FamilyInfo {
  familyId: string;
  pairCode?: string | null;
  pairCodeExpiresAt: Date | null;
  members: FamilyMember[];
  /** 내 멤버 역할(서버 /mine 판정). */
  myRole: "parent" | "child" | null;
  /** 내 표시 이름. */
  myName: string;
  /** 가족 대표(부모) 이름. */
  parentName: string;
  /** 주 보호자 user_id(연결 해제·아이 프로필 수정 권한 게이트). */
  primaryParentId: string | null;
  /** 내가 주 보호자인가(unpair·member/profile 은 주 보호자만). */
  isPrimaryParent: boolean;
  /** 내가 보조 보호자(co-parent)인가. */
  isCoParent: boolean;
}

interface FamilyMineResponse {
  familyId: string;
  pairCode?: string | null;
  pairCodeExpiresAt?: string | null;
  members?: FamilyMember[];
  myRole?: "parent" | "child";
  myName?: string;
  parentName?: string | null;
  primaryParentId?: string | null;
  isPrimaryParent?: boolean;
  isCoParent?: boolean;
}

interface SessionResponse {
  session?: { access_token?: string; refresh_token?: string };
  user?: ApiUser;
  family_id?: string | null;
}

// join 계열 응답의 세션 재발급 반영(익명→child/parent 플립 포함).
function adoptSession(data: SessionResponse): void {
  if (data.session?.access_token) {
    applyApiSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token ?? null });
  }
  if (data.user) setApiUser(data.user);
}

// photo_url(raw 경로/URL) → R2 proxy URL 로 재합성.
function enrichPhotos(members: FamilyMember[]): FamilyMember[] {
  return members.map((m) => {
    if (!m.photo_url) return m;
    const proxied = childPhotoProxyUrl(extractPhotoPath(m.photo_url));
    return proxied ? { ...m, photo_url: proxied } : m;
  });
}

function extractPhotoPath(urlOrPath: string): string | null {
  const m = urlOrPath.match(/\/(?:storage\/v1\/object\/(?:public|sign)|api\/storage)\/child-photos\/([^?]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (urlOrPath.startsWith("http")) return null;
  return urlOrPath;
}

/** 현재 user 의 가족 정보. 비로그인/가족없음이면 null. */
export async function getMyFamily(): Promise<FamilyInfo | null> {
  const data = await apiGet<FamilyMineResponse | null>("/api/family/mine");
  if (!data) return null;
  return {
    familyId: data.familyId,
    pairCode: data.pairCode ?? null,
    pairCodeExpiresAt: data.pairCodeExpiresAt ? new Date(data.pairCodeExpiresAt) : null,
    members: enrichPhotos(data.members || []),
    myRole: data.myRole ?? null,
    myName: data.myName ?? "",
    parentName: data.parentName ?? "",
    primaryParentId: data.primaryParentId ?? null,
    isPrimaryParent: data.isPrimaryParent === true,
    isCoParent: data.isCoParent === true,
  };
}

export interface SetupFamilyInput {
  parentName: string;
  familyName?: string;
  plannedChildCount?: number;
  children?: Array<{ name: string; birthdate?: string; color_hex?: string; photo_url?: string }>;
  parentPhone?: string;
  parentGender?: string;
}

/**
 * 아이 테마색 기본 팔레트 — 색상 선택 UI 제거에 따라 child_order/index 로 자동 배정한다.
 * (tokens.css data-accent 계열과 동일. 서버 color_hex 필수 계약을 코드가 채운다.)
 */
export const DEFAULT_CHILD_COLORS = [
  "#F76BA6",
  "#4FB2E8",
  "#31C48D",
  "#A78BFA",
  "#FF9E7A",
  "#F5C542",
] as const;

/** index(0-base) 또는 child_order-1 기반 기본 테마색. 팔레트를 순환한다. */
export function defaultChildColor(index: number): string {
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return DEFAULT_CHILD_COLORS[i % DEFAULT_CHILD_COLORS.length];
}

/** 로그인 후 새 가족 생성. { id, pair_code } 반환. */
export async function setupFamily(input: SetupFamilyInput): Promise<{ id: string; pair_code: string }> {
  let parentPhone = "";
  try {
    parentPhone = input.parentPhone ? normalizePhoneForStorage(input.parentPhone) : "";
  } catch {
    parentPhone = "";
  }
  return apiPost("/api/family/setup", {
    parentName: input.parentName,
    familyName: input.familyName ?? "",
    plannedChildCount: input.plannedChildCount ?? 1,
    children: input.children ?? [],
    parentPhone,
    parentGender: input.parentGender ?? "",
  });
}

/** 아이가 KID 페어링 코드로 가족 합류. 익명→child 세션 재발급. family_id 반환. */
export async function joinFamily(pairCode: string, childName?: string): Promise<string | null> {
  const code = String(pairCode || "").toUpperCase().trim();
  if (!code) throw new Error("연결 코드를 입력해주세요");
  const data = await apiPost<SessionResponse>("/api/family/join", { pairCode: code, name: childName || "아이" });
  adoptSession(data);
  return data.family_id ?? null;
}

/** 보조 보호자(co-parent) 합류. 세션 재발급. family_id 반환. */
export async function joinFamilyAsParent(pairCode: string, parentName?: string): Promise<string> {
  const code = String(pairCode || "").toUpperCase().trim();
  if (!code) throw new Error("연결 코드를 입력해주세요");
  const data = await apiPost<SessionResponse>("/api/family/join-as-parent", { pairCode: code, name: parentName || "부모" });
  adoptSession(data);
  if (!data.family_id) throw new Error("연결 코드를 찾지 못했습니다");
  return data.family_id;
}

/** 본인 프로필(이름/전화/캐릭터) 수정. 변경 필드 없으면 no-op. */
export async function updateMyProfile(
  familyId: string,
  fields: { name?: string; phone?: string; emoji?: string },
): Promise<void> {
  const payload: Record<string, string> = { family_id: familyId };
  if (typeof fields.name === "string") payload.name = fields.name;
  if (typeof fields.phone === "string") payload.phone = fields.phone;
  if (typeof fields.emoji === "string") payload.emoji = fields.emoji;
  if (Object.keys(payload).length === 1) return;
  await apiPatch("/api/family/profile", payload);
}

/**
 * 아이 기기 상태 자기-리포트(PATCH /member/device). 서버가 토큰 sub 로 본인 행만 갱신하고
 * device_health(jsonb)를 JSON.stringify 해 저장한다. 부모는 /mine 응답에서 이 값을 읽는다.
 * fire-and-forget 성격이라 familyId 없으면 조용히 no-op(호출부 흐름을 깨지 않게).
 */
export async function reportDeviceStatus(
  familyId: string,
  deviceHealth: DeviceHealth,
  deviceLabel?: string,
): Promise<void> {
  if (!familyId) return;
  const payload: Record<string, unknown> = { family_id: familyId, device_health: deviceHealth };
  if (deviceLabel && deviceLabel.trim()) payload.device_label = deviceLabel.trim();
  await apiPatch("/api/family/member/device", payload);
}

/**
 * 기기명(device_label)만 자기-리포트 — device_health 를 payload 에서 뺀다.
 * 서버 라우트는 body 에 있는 키만 SET 하므로, 라벨 단독 전송은 네이티브 LocationService 가
 * publish 하는 리치 device_health 를 덮어쓰지 않는다(부분 갱신 = 정보 손실 방지).
 * fire-and-forget: familyId·label 비면 조용히 no-op.
 */
export async function reportDeviceLabel(familyId: string, deviceLabel: string): Promise<void> {
  const label = deviceLabel.trim();
  if (!familyId || !label) return;
  await apiPatch("/api/family/member/device", { family_id: familyId, device_label: label });
}

/** 페어링 코드 재발급(부모만, 서버 강제). */
export async function regeneratePairCode(
  familyId: string,
): Promise<{ pairCode: string; pairCodeExpiresAt: Date | null }> {
  const data = await apiPost<{ pair_code?: string; pair_code_expires_at?: string }>(
    "/api/family/pair-code/regenerate",
    { family_id: familyId },
  );
  if (!data?.pair_code) throw new Error("새 연결 코드 생성에 실패했어요");
  return {
    pairCode: data.pair_code,
    pairCodeExpiresAt: data.pair_code_expires_at ? new Date(data.pair_code_expires_at) : null,
  };
}

/** 로그인 사용자 객체에서 부모 기본 표시이름 파생(가족 setup 기본값). */
export function parentNameFromUser(user: ApiUser | null): string {
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const name = meta?.name ?? meta?.full_name ?? meta?.display_name ?? meta?.nickname;
  return typeof name === "string" && name.trim() ? name.trim() : "부모";
}

/**
 * 아이 연결 해제(주 보호자만, 서버 강제). 서버가 user-tied 데이터(fcm/push/위치/이력)까지
 * family-scoped 로 정리하고 family_members 를 삭제한다. 멱등(이미 해제됐으면 no-op).
 */
export async function unpairChild(familyId: string, childUserId: string): Promise<void> {
  if (!familyId || !childUserId) throw new Error("가족·아이 정보가 필요해요");
  await apiPost("/api/family/unpair", { family_id: familyId, child_user_id: childUserId });
}

/**
 * 아이 프로필(이름 + 테마색 + 생일 + 전화) 저장 — 주 보호자만(서버 member/profile).
 * 서버가 role='child' 행만 갱신하고 color_hex 형식(#RRGGBB)을 검증하며, notifyPg 로
 * 가족 WS 실시간 반영(아이 기기 useMyFamily 자동 갱신)을 트리거한다.
 *
 * 색상 선택 UI 는 제거됨: colorHex 를 넘기면 그대로(기존 색 보존), 없으면 colorIndex 로
 * 기본 팔레트에서 자동 배정한다(서버 color_hex 필수 계약 충족).
 *
 * birthdate/phone 은 **부분수정**: fields 에 키가 있을 때만 body 에 실어 보낸다(undefined=건드리지 않음).
 *  - birthdate: "YYYY-MM-DD" 또는 null(지움).
 *  - phone: 저장형("01012345678") 또는 null(지움). 정규화는 호출부(사용자 입력 경계)에서 완료해 넘긴다.
 */
export async function setChildProfile(
  familyId: string,
  memberId: string,
  fields: {
    name: string;
    colorHex?: string;
    colorIndex?: number;
    birthdate?: string | null;
    phone?: string | null;
  },
): Promise<void> {
  const name = fields.name.trim();
  if (!name) throw new Error("이름을 입력해주세요");
  const colorHex =
    fields.colorHex && fields.colorHex.trim()
      ? fields.colorHex.trim()
      : defaultChildColor(fields.colorIndex ?? 0);
  if (!/^#[0-9A-Fa-f]{6}$/.test(colorHex)) throw new Error("테마 색상이 올바르지 않아요");
  const payload: Record<string, unknown> = {
    family_id: familyId,
    member_id: memberId,
    new_name: name,
    color_hex: colorHex,
  };
  if (fields.birthdate !== undefined) payload.birthdate = fields.birthdate;
  if (fields.phone !== undefined) payload.phone = fields.phone;
  await apiPost("/api/family/member/profile", payload);
}

// ── 아이 → 부모 설정 변경 요청(childSettingRequest 포팅) ──────────────────────
// 자녀가 직접 못 바꾸는 잠금 메뉴(소리·진동/캐릭터 등)를 부모에게 알림으로 요청한다.
// 승인·자동적용 없는 정보 전달형 — 서버 parent_alerts 기록(+realtime notifyPg)으로 부모에게 도달.

/** 요청 메뉴별 카피(childLabel=자녀 표기, parentTitle/parentMessage=부모 알림). */
export const SETTING_REQUEST_META = {
  theme: {
    childLabel: "테마 색깔",
    parentTitle: "테마 변경 요청",
    parentMessage: (n: string) => `${n}님이 테마 색깔을 바꾸고 싶어 해요.`,
  },
  character: {
    childLabel: "캐릭터",
    parentTitle: "캐릭터 변경 요청",
    parentMessage: (n: string) => `${n}님이 캐릭터를 바꾸고 싶어 해요.`,
  },
  sound: {
    childLabel: "소리·진동",
    parentTitle: "소리·진동 설정 변경 요청",
    parentMessage: (n: string) => `${n}님이 소리·진동 설정을 바꾸고 싶어 해요.`,
  },
  mascot: {
    childLabel: "마스코트 보여주기",
    parentTitle: "마스코트 설정 변경 요청",
    parentMessage: (n: string) => `${n}님이 마스코트 표시 설정을 바꾸고 싶어 해요.`,
  },
} as const;

export type SettingRequestMenu = keyof typeof SETTING_REQUEST_META;

const REQUEST_COOLDOWN_MS = 60_000;
const REQUEST_COOLDOWN_PREFIX = "hyeni-setting-request-";

export function isValidSettingMenu(menu: string): menu is SettingRequestMenu {
  return Object.prototype.hasOwnProperty.call(SETTING_REQUEST_META, menu);
}

function readLastSentAt(menu: string): number {
  try {
    const raw = window.localStorage.getItem(REQUEST_COOLDOWN_PREFIX + menu);
    const ts = raw ? Number(raw) : 0;
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

/** 메뉴별 60초 쿨다운 검사 — { allowed, remainingSec }. */
export function checkRequestCooldown(
  menu: string,
  now: number = Date.now(),
): { allowed: boolean; remainingSec: number } {
  if (!isValidSettingMenu(menu)) return { allowed: false, remainingSec: 0 };
  const elapsed = now - readLastSentAt(menu);
  if (elapsed >= REQUEST_COOLDOWN_MS) return { allowed: true, remainingSec: 0 };
  return { allowed: false, remainingSec: Math.ceil((REQUEST_COOLDOWN_MS - elapsed) / 1000) };
}

function markRequestSent(menu: string, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(REQUEST_COOLDOWN_PREFIX + menu, String(now));
  } catch {
    /* localStorage 불가 시 쿨다운만 비활성 — 요청 자체는 정상 진행 */
  }
}

export interface ChildSettingRequestInput {
  familyId: string;
  menu: SettingRequestMenu;
  childName?: string;
  senderUserId?: string | null;
}

/**
 * 자녀 → 부모 설정 변경 요청 전송. 서버 parent_alerts 에 기록(realtime 로 부모 알림함 반영).
 * 성공 시 60초 쿨다운을 건다(중복 요청 방지).
 */
export async function sendChildSettingRequest(input: ChildSettingRequestInput): Promise<void> {
  const { familyId, menu, childName, senderUserId } = input;
  if (!familyId) throw new Error("가족 정보가 없어 요청을 보낼 수 없어");
  if (!isValidSettingMenu(menu)) throw new Error("알 수 없는 설정 메뉴예요");
  const meta = SETTING_REQUEST_META[menu];
  const name = childName && childName.trim() ? childName.trim() : "아이";
  await apiPost("/api/parent-alerts", {
    family_id: familyId,
    alert_type: "child_setting_request",
    title: meta.parentTitle,
    message: meta.parentMessage(name),
    severity: "info",
    event_id: null,
    child_user_id: senderUserId ?? null,
  });
  markRequestSent(menu);
}
