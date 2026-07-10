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
  reverseGeocode: (coord: string) => ["location", "reverseGeocode", coord] as const,
  locationHistory: (familyId: string, start: string, end: string) =>
    ["location", "history", familyId, start, end] as const,
  locationIncidents: (familyId: string) => ["location", "incidents", familyId] as const,
  dangerZones: (familyId: string) => ["dangerZones", familyId] as const,
  savedPlaces: (familyId: string) => ["savedPlaces", familyId] as const,
  parentAlerts: (familyId: string) => ["parentAlerts", familyId] as const,

  // 도보 경로(출발/도착 좌표 기준)
  walkingRoute: (origin: string, destination: string) =>
    ["route", "walking", origin, destination] as const,

  // 메모 — childId(member id)까지 키에 포함(아이별 스레드 캐시 분리; 미포함 시 아이 간 캐시 충돌).
  memoReplies: (familyId: string, dateKeys?: string, childId?: string | null) =>
    ["memoReplies", familyId, dateKeys ?? "recent", childId ?? "all"] as const,

  // 스티커(칭찬)
  stickerSummary: (familyId: string) => ["stickers", "summary", familyId] as const,
  receivedStickers: (familyId: string, userId: string) =>
    ["stickers", "received", familyId, userId] as const,
  stickersByDate: (familyId: string, dateKey: string) =>
    ["stickers", "date", familyId, dateKey] as const,

  // 구독·엔타이틀먼트
  entitlement: (familyId: string) => ["entitlement", familyId] as const,

  // AI
  aiCredits: (familyId: string) => ["aiCredits", familyId] as const,
  aiMessages: (childUserId: string) => ["aiMessages", childUserId] as const,

  // 선생님
  teacherMe: ["teacher", "me"] as const,
  teacherClasses: ["teacher", "classes"] as const,
  teacherRoster: (classId: string) => ["teacher", "roster", classId] as const,
  teacherAttendance: (classId: string, dateKey: string) =>
    ["teacher", "attendance", classId, dateKey] as const,
} as const;
