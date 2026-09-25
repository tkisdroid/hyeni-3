/**
 * 가족 도메인 엔드포인트.
 * 온보딩(setup/join)과 가족 화면(mine/profile/pair-code)이 공용.
 * join/join-as-parent 는 서버가 세션을 재발급하므로 applyApiSession + setApiUser 필수.
 */
import { apiGet, apiPost, apiPatch, apiPut } from "../client";
import { ApiError } from "../errors";
import {
  applyApiSession,
  getApiSessionInstanceId,
  getApiUser,
  notifyTokens,
  setApiUser,
  type ApiUser,
} from "../session";
import { normalizePhoneForStorage } from "@/transform/phone";
import { reconcileApiUserWithFamilyMine } from "@/transform/sessionFamilySync";
import { requestWithSessionOwnership } from "@/auth/sessionRequestOwnership";
import { getPlatform, isNativePlatform } from "@/lib/native/plugins";
import { getAuthDeviceDescriptor } from "@/lib/native/deviceIdentity";
import type { MapPolicy } from "../../../../shared/mapPolicy.ts";

/**
 * 아이 기기 상태(웹 수집 부분집합). 서버 family_members.device_health(jsonb)에 저장.
 * 아이 기기가 스스로 리포트하고(PATCH /member/device) 부모는 /mine 응답에서 파싱된 객체로 읽는다.
 * - batteryLevel/isCharging: navigator.getBattery() 미지원 브라우저에선 null.
 * - networkConnected/networkType: navigator.onLine / connection.effectiveType.
 * - 화면시간·앱 사용시간은 네이티브 UsageStats 권한이 있을 때만 채워진다.
 */
export interface DeviceAppUsage {
  name?: string | null;
  packageName?: string | null;
  usageMs?: number | null;
  percent?: number | null;
  lastTimeUsed?: number | null;
}

export interface DeviceHealth {
  batteryLevel: number | null;
  isCharging: boolean | null;
  networkConnected: boolean;
  networkType: string | null;
  /** 앱 설치 단위 식별자. 아이 재연결 시 기존 family_members 행 재사용 힌트로만 쓴다. */
  deviceInstallId?: string | null;
  /** 마지막 리포트 시각(ISO). 웹 리포트에만 확실히 존재. */
  lastReportedAt?: string;
  /** 네이티브 DeviceStatusReporter가 기록한 마지막 리포트 시각(ISO). */
  updatedAt?: string;
  /** 네이티브(LocationService) 리치 리포트에만: 연결타입·오늘 화면사용(ms)·최근 사용앱. */
  connectionType?: string | null;
  deviceScreenOnMs?: number | null;
  recentApp?: string | null;
  usagePermission?: "granted" | "requires_permission" | "unavailable" | string | null;
  appUsage?: DeviceAppUsage[] | null;
  /** 오늘 화면잠금 해제 횟수(KEYGUARD_HIDDEN). 알림 화면켜짐 미포함. 권한없음=null. */
  deviceUnlockCount?: number | null;
  /** Android 알림 게시 종합 상태. false는 권한·앱 전체 알림·필수 채널 중 하나 이상 차단됨. */
  postNotif?: boolean | null;
  /** Android 13+ POST_NOTIFICATIONS 권한 상태. */
  postPermissionGranted?: boolean | null;
  /** OS 앱 단위 전체 알림 허용 상태. */
  notificationsEnabled?: boolean | null;
  /** 일정·긴급·꾹·아이 메시지·안전 필수 채널이 모두 활성인지 여부. */
  requiredChannelsEnabled?: boolean | null;
  /** Android 14+ 잠금화면 전체 표시 특별 접근 허용 상태. */
  fullScreenIntentAllowed?: boolean | null;
  /** 아이가 주변 소리 요청을 확인하는 전용 알림 채널 상태. */
  remoteListenChannelEnabled?: boolean | null;
  /** Android의 항상 허용 위치 권한 상태. */
  backgroundLocationGranted?: boolean | null;
  /** 구버전 네이티브 보고의 백그라운드 위치 권한 종합값. */
  locationOk?: boolean | null;
  /** 네이티브 백그라운드 위치 서비스 실행 상태. */
  locationServiceRunning?: boolean | null;
  /** OS가 앱 백그라운드 실행을 제한하고 있는지 여부. */
  backgroundRestricted?: boolean | null;
  /** 마지막 네이티브 상태 보고의 실제 제조사·모델. 오래된 device_label 보정에 사용. */
  manufacturer?: string | null;
  model?: string | null;
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
  /** Study 학년 optimistic concurrency version. */
  learning_grade_row_version?: number | null;
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
  /** 내 계정의 가입(로그인) 방식 — 서버 정본. 모르면 null. */
  myAuthProvider: string | null;
  /** 가족 대표(부모) 이름. */
  parentName: string;
  /** 주 보호자 user_id(연결 해제·아이 프로필 수정 권한 게이트). */
  primaryParentId: string | null;
  /** 내가 주 보호자인가(unpair·member/profile 은 주 보호자만). */
  isPrimaryParent: boolean;
  /** 내가 보조 보호자(co-parent)인가. */
  isCoParent: boolean;
  /** Study 이용 국가 확인 snapshot. 국적이 아니며 대표 보호자만 변경한다. */
  serviceCountry: string | null;
  serviceCountryRowVersion: number | null;
  /** 지도·위치 공급자 선택에 사용하는 서버 정본 가족 국가. */
  countryCode: string;
  timeZone: string;
  mapPolicy: MapPolicy;
}

export interface FamilyMineResponse {
  familyId: string;
  pairCode?: string | null;
  pairCodeExpiresAt?: string | null;
  members?: FamilyMember[];
  myRole?: "parent" | "child";
  myName?: string;
  myAuthProvider?: string | null;
  parentName?: string | null;
  primaryParentId?: string | null;
  isPrimaryParent?: boolean;
  isCoParent?: boolean;
  serviceCountry?: string | null;
  serviceCountryRowVersion?: number | null;
  countryCode?: string;
  timeZone?: string;
  mapPolicy?: MapPolicy;
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

/** 현재 user 의 가족 정보. 비로그인/가족없음이면 null. */
export async function getMyFamily(): Promise<FamilyInfo | null> {
  const data = await requestWithSessionOwnership(
    () => apiGet<FamilyMineResponse | null>("/api/family/mine"),
    () => ({
      sessionInstanceId: getApiSessionInstanceId(),
      userId: getApiUser()?.id ?? null,
    }),
    (response) => {
      if (!response) return;
      const reconciledUser = reconcileApiUserWithFamilyMine(getApiUser(), {
        familyId: response.familyId,
        myRole: response.myRole ?? null,
      });
      if (reconciledUser && reconciledUser !== getApiUser()) {
        setApiUser(reconciledUser);
        notifyTokens();
      }
    },
  );
  return mapFamilyMineResponse(data);
}

export function mapFamilyMineResponse(data: FamilyMineResponse | null): FamilyInfo | null {
  if (!data) return null;
  return {
    familyId: data.familyId,
    pairCode: data.pairCode ?? null,
    pairCodeExpiresAt: data.pairCodeExpiresAt ? new Date(data.pairCodeExpiresAt) : null,
    // 가족 정본은 사진 다운로드와 독립적으로 즉시 반환한다. private 사진은 useMyFamily가 별도 lease로 합성한다.
    members: data.members || [],
    myRole: data.myRole ?? null,
    myName: data.myName ?? "",
    myAuthProvider: typeof data.myAuthProvider === "string" ? data.myAuthProvider : null,
    parentName: data.parentName ?? "",
    primaryParentId: data.primaryParentId ?? null,
    isPrimaryParent: data.isPrimaryParent === true,
    isCoParent: data.isCoParent === true,
    serviceCountry: typeof data.serviceCountry === "string" ? data.serviceCountry : null,
    serviceCountryRowVersion: Number.isSafeInteger(data.serviceCountryRowVersion)
      ? (data.serviceCountryRowVersion as number)
      : null,
    countryCode: typeof data.countryCode === "string" ? data.countryCode : "ZZ",
    timeZone: data.timeZone ?? "Asia/Seoul",
    mapPolicy: data.mapPolicy ?? { provider: "unsupported", reason: "country_unresolved" },
  };
}

export interface FamilyRegion {
  countryCode: string;
  timeZone: string;
}

export interface SetupFamilyInput {
  parentName: string;
  /** 신규 가족 생성에서는 필수. 기존 가족의 아이 추가 호출은 서버가 저장값을 유지한다. */
  countryCode?: string;
  timeZone?: string;
  familyName?: string;
  plannedChildCount?: number;
  children?: Array<{ name: string; birthdate?: string; color_hex?: string; photo_url?: string }>;
  parentPhone?: string;
  parentGender?: string;
  referralCode?: string;
  studyCountry?: Readonly<{
    serviceCountry: string;
    serviceCountrySource: "guardian_confirmed" | "guardian_changed";
  }>;
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

export function buildSetupFamilyPayload(input: SetupFamilyInput): Record<string, unknown> {
  let parentPhone = "";
  try {
    parentPhone = input.parentPhone ? normalizePhoneForStorage(input.parentPhone) : "";
  } catch {
    parentPhone = "";
  }
  const serviceCountry = input.studyCountry?.serviceCountry.trim().toUpperCase();
  if (serviceCountry !== undefined && !/^[A-Z]{2}$/u.test(serviceCountry)) {
    throw new ApiError("invalid_service_country", 400);
  }
  const countryCode = input.countryCode?.trim().toUpperCase();
  if (countryCode !== undefined && !/^[A-Z]{2}$/u.test(countryCode)) {
    throw new ApiError("invalid_family_country", 400);
  }
  return {
    parentName: input.parentName,
    familyName: input.familyName ?? "",
    plannedChildCount: input.plannedChildCount ?? 1,
    children: input.children ?? [],
    parentPhone,
    parentGender: input.parentGender ?? "",
    referralCode: input.referralCode?.trim() || undefined,
    ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(serviceCountry === undefined ? {} : {
      serviceCountry,
      serviceCountryMatchedEdge: input.studyCountry?.serviceCountrySource === "guardian_confirmed",
    }),
  };
}

/** 로그인 후 새 가족 생성. { id, pair_code } 반환. */
export async function setupFamily(input: SetupFamilyInput): Promise<{ id: string; pair_code: string }> {
  return apiPost("/api/family/setup", buildSetupFamilyPayload(input));
}

export async function updateFamilyRegion(
  input: FamilyRegion,
): Promise<FamilyRegion & { mapPolicy: MapPolicy }> {
  const countryCode = input.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(countryCode)) throw new ApiError("invalid_family_country", 400);
  return apiPatch("/api/family/region", { countryCode, timeZone: input.timeZone });
}

export interface ConfirmServiceCountryInput {
  familyId: string;
  country: string;
  rowVersion: number;
  requestId: string;
}

export interface ConfirmServiceCountryResult {
  serviceCountry: string;
  studyMarket: "KR" | null;
  source: "guardian_confirmed" | "guardian_changed";
  rowVersion: number;
}

/** 대표 보호자가 가족의 이용 국가를 명시적으로 확인한다. */
export async function confirmServiceCountry(
  input: ConfirmServiceCountryInput,
): Promise<ConfirmServiceCountryResult> {
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country) || !Number.isSafeInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ApiError("invalid_service_country", 400);
  }
  return apiPut<ConfirmServiceCountryResult>("/api/family/service-country", {
    familyId: input.familyId,
    country,
    rowVersion: input.rowVersion,
    requestId: input.requestId,
  });
}

export interface JoinFamilyOptions {
  childName?: string;
  deviceLabel?: string | null;
  deviceInstallId?: string | null;
  previousUserId?: string | null;
  previousFamilyId?: string | null;
}

function cleanOptional(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** 아이가 KID 페어링 코드로 가족 합류. 익명→child 세션 재발급. family_id 반환. */
export async function joinFamily(pairCode: string, options?: string | JoinFamilyOptions): Promise<string | null> {
  const code = String(pairCode || "").toUpperCase().trim();
  if (!code) throw new Error("연결 코드를 입력해 주세요");
  const opts: JoinFamilyOptions =
    typeof options === "string" ? { childName: options } : options ?? {};
  const payload: Record<string, unknown> = {
    pairCode: code,
    name: cleanOptional(opts.childName) ?? "아이",
  };
  const deviceLabel = cleanOptional(opts.deviceLabel);
  const deviceInstallId = cleanOptional(opts.deviceInstallId);
  const previousUserId = cleanOptional(opts.previousUserId);
  const previousFamilyId = cleanOptional(opts.previousFamilyId);
  if (deviceLabel) payload.device_label = deviceLabel;
  if (deviceInstallId) payload.device_install_id = deviceInstallId;
  if (isNativePlatform() && getPlatform() === "android") payload.device_platform = "android";
  if (previousUserId) payload.previous_user_id = previousUserId;
  if (previousFamilyId) payload.previous_family_id = previousFamilyId;
  const data = await apiPost<SessionResponse>("/api/family/join", payload);
  adoptSession(data);
  return data.family_id ?? null;
}

/** 보조 보호자(co-parent) 합류. 세션 재발급. family_id 반환. */
export async function joinFamilyAsParent(pairCode: string, parentName?: string): Promise<string> {
  const code = String(pairCode || "").toUpperCase().trim();
  if (!code) throw new Error("연결 코드를 입력해 주세요");
  const device = await getAuthDeviceDescriptor().catch(() => null);
  // 이름을 모르면 보내지 않는다. 서버가 가입 프로필 이름으로 채운다("부모"로 저장되지 않게).
  const name = parentName?.trim();
  const data = await apiPost<SessionResponse>("/api/family/join-as-parent", {
    pairCode: code,
    ...(name ? { name } : {}),
    ...(device ?? {}),
  });
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
 * 기존 공동 보호자 연결 해제(주 보호자만). 계정은 삭제하지 않고 가족 멤버십만 비활성화하며,
 * 서버가 해당 보호자의 세션·푸시·실시간 가족 접근을 함께 닫는다.
 */
export async function removeCoParent(familyId: string, parentUserId: string): Promise<void> {
  if (!familyId || !parentUserId) throw new Error("가족·보호자 정보가 필요해요");
  await apiPost("/api/family/co-parent/remove", {
    family_id: familyId,
    parent_user_id: parentUserId,
  });
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
  if (!name) throw new Error("이름을 입력해 주세요");
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
    // 서버가 이 메뉴로 부모 언어에 맞는 번역 문구를 붙인다(title·message 는 한국어 기본값).
    setting_menu: menu,
    title: meta.parentTitle,
    message: meta.parentMessage(name),
    severity: "info",
    event_id: null,
    child_user_id: senderUserId ?? null,
  });
  markRequestSent(menu);
}

// ── 아이 → 부모 AI 대화 충전 요청 ────────────────────────────────────────────
// 아이가 오늘 AI 대화 횟수를 다 썼을 때 부모에게 바로 부탁한다. 부모 알림을 탭하면
// 충전·하루 한도 화면(`/ai-credit`)으로 직행해 그 자리에서 해결할 수 있다.
//
// 제목·본문·소진 여부는 Worker 가 다시 판정한다(여기서 보내는 문자열은 쓰이지 않는다).
// 아직 대화가 남아 있으면 서버가 `ai_credit_available` 로 거절한다.

export interface AiCreditRequestResult {
  /** 최근에 이미 부탁해서 부모 알림을 새로 만들지 않았다. */
  duplicate: boolean;
}

export async function sendAiCreditRequest(input: {
  familyId: string;
  childUserId: string;
}): Promise<AiCreditRequestResult> {
  const { familyId, childUserId } = input;
  if (!familyId || !childUserId) throw new Error("가족 정보가 없어 부탁을 보낼 수 없어");
  const res = await apiPost<unknown>("/api/parent-alerts", {
    family_id: familyId,
    alert_type: "ai_credit_request",
    // 서버가 소진 원인에 맞는 문구로 덮어쓴다. 아이 입력은 부모 알림에 담기지 않는다.
    title: "",
    message: "",
    severity: "info",
    event_id: null,
    child_user_id: childUserId,
  });
  const duplicate = typeof res === "object" && res !== null
    && (res as Record<string, unknown>).duplicate === true;
  return { duplicate };
}

/**
 * 부모 홈 히어로 캐러셀 표시 개수(운영자 전역 설정).
 * 실패하면 화면이 기본값으로 렌더하므로 호출부가 오류를 삼키지 않고 그대로 던진다.
 */
export interface ParentHomeHeroCarouselControls {
  freeVisibleCount: number;
  premiumVisibleCount: number;
  autoPlayMs: number;
}

export async function fetchParentHomeHeroCarousel(): Promise<ParentHomeHeroCarouselControls> {
  const raw = await apiGet<unknown>("/api/family/hero-carousel");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ApiError("invalid_hero_carousel_response", 502);
  }
  const record = raw as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
  const free = count(record.freeVisibleCount);
  const premium = count(record.premiumVisibleCount);
  const autoPlayMs = count(record.autoPlayMs);
  if (free === null || premium === null || autoPlayMs === null) {
    throw new ApiError("invalid_hero_carousel_response", 502);
  }
  return { freeVisibleCount: free, premiumVisibleCount: premium, autoPlayMs };
}
