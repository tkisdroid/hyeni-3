/**
 * TanStack Query queryKey 팩토리.
 * 계층 키(['family', familyId] 등)로 invalidation 범위를 정확히 조준한다.
 * 실시간(WS) 이벤트 → 관련 키 invalidate 브릿지(Slice 10)도 이 키를 참조한다.
 */
export const qk = {
  // 인증/세션
  session: ["session"] as const,

  // 가족·멤버
  family: (familyId?: string | null) => ["family", familyId ?? "me"] as const,
  oauthLinks: ["oauth-links"] as const,
  account: (familyId?: string | null) => ["account", familyId ?? "me"] as const,

  // 일정
  events: (familyId: string) => ["events", familyId] as const,
  event: (eventId: string) => ["event", eventId] as const,
  academies: (familyId: string) => ["academies", familyId] as const,
  dailySupplies: (familyId: string, dateKey?: string) =>
    ["dailySupplies", familyId, dateKey ?? "all"] as const,

  // 위치·안전
  childLocations: (familyId: string) => ["location", "children", familyId] as const,
  locationPreferences: (familyId: string) => ["location", "preferences", familyId] as const,
  reverseGeocode: (coord: string) => ["location", "reverseGeocode", coord] as const,
  locationHistory: (familyId: string, start: string, end: string) =>
    ["location", "history", familyId, start, end] as const,
  locationIncidents: (familyId: string) => ["location", "incidents", familyId] as const,
  dangerZones: (familyId: string) => ["dangerZones", familyId] as const,
  savedPlaces: (familyId: string) => ["savedPlaces", familyId] as const,
  parentAlerts: (familyId: string) => ["parentAlerts", familyId] as const,
  remoteListenAudit: (familyId: string) => ["remoteListenAudit", familyId] as const,
  remoteListenSession: (familyId: string, requestId: string) =>
    ["remoteListenSession", familyId, requestId] as const,
  notifSettings: (userId: string) => ["notif-settings", userId] as const,
  childNotifSettings: (familyId: string, childUserId: string) =>
    ["notif-settings", "child-status", familyId, childUserId] as const,
  familyNotificationQuietHoursPrefix: (familyId: string) =>
    ["notif-settings", "family-quiet-hours", familyId] as const,
  familyNotificationQuietHours: (
    familyId: string,
    parentUserId: string,
    sessionInstanceId: string,
  ) => [
    "notif-settings",
    "family-quiet-hours",
    familyId,
    parentUserId,
    sessionInstanceId,
  ] as const,

  // 도보 경로(출발/도착 좌표 기준)
  walkingRoute: (origin: string, destination: string) =>
    ["route", "walking", origin, destination] as const,

  // 메모 — childId(member id)까지 키에 포함(아이별 스레드 캐시 분리; 미포함 시 아이 간 캐시 충돌).
  memoReplies: (familyId: string, dateKeys?: string, childId?: string | null) =>
    ["memoReplies", familyId, dateKeys ?? "recent", childId ?? "all"] as const,
  memoBlocks: (familyId: string) => ["memoBlocks", familyId] as const,

  // 스티커(칭찬)
  stickerSummary: (familyId: string) => ["stickers", "summary", familyId] as const,
  receivedStickers: (familyId: string, userId: string) =>
    ["stickers", "received", familyId, userId] as const,
  stickersByDate: (familyId: string, dateKey: string) =>
    ["stickers", "date", familyId, dateKey] as const,

  // 구독·엔타이틀먼트
  entitlement: (familyId: string) => ["entitlement", familyId] as const,
  reviewReward: (familyId: string) => ["reviewReward", familyId] as const,
  referrals: (familyId: string) => ["referrals", familyId] as const,

  // AI
  aiCredits: (familyId: string) => ["aiCredits", familyId] as const,
  webAiCreditCatalog: (familyId: string) => ["aiCredits", familyId, "webCatalog"] as const,
  aiCreditPublicStatus: (familyId: string, childUserId: string) =>
    ["aiCredits", familyId, "publicStatus", childUserId] as const,
  aiMessages: (childUserId: string) => ["aiMessages", childUserId] as const,
  aiUsageToday: (familyId: string, childUserId: string) => ["aiUsageToday", familyId, childUserId] as const,

  // 선생님
  teacherMe: ["teacher", "me"] as const,
  teacherClasses: ["teacher", "classes"] as const,
  teacherRoster: (classId: string) => ["teacher", "roster", classId] as const,
  teacherAttendance: (classId: string, dateKey: string) =>
    ["teacher", "attendance", classId, dateKey] as const,

  // 운영자(관리자) — 계정 단위라 familyId 를 키에 넣지 않는다.
  adminStatus: ["admin", "me"] as const,
  adminAiPrompt: ["admin", "aiPrompt"] as const,
  adminCommerceControls: ["admin", "commerceControls"] as const,
  adminHeroCarousel: ["admin", "heroCarousel"] as const,
  /** 부모 홈 히어로 캐러셀 표시 개수(운영자 전역 설정). 가족별이 아니라 전역이라 키에 id 가 없다. */
  parentHomeHeroCarousel: ["parentHome", "heroCarousel"] as const,

  // 학습 — 부모/자녀 역할과 정확한 자녀 member를 키에 고정해 캐시가 섞이지 않게 한다.
  study: {
    all: ["study"] as const,
    status: (familyId: string, role: "parent" | "child") =>
      ["study", "status", familyId, role] as const,
    children: (familyId: string) => ["study", "children", familyId] as const,
    overview: (familyId: string, memberId: string) =>
      ["study", "overview", familyId, memberId] as const,
    report: (familyId: string, memberId: string, range: "7d" | "30d" | "term") =>
      ["study", "report", familyId, memberId, range] as const,
    learner: (familyId: string) => ["study", "learner", familyId] as const,
    mission: (familyId: string, missionId: string) =>
      ["study", "mission", familyId, missionId] as const,
  },
} as const;
