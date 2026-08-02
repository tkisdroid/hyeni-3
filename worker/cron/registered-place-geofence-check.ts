// registered-place-geofence-check (cron */2) — supabase edge 직역.
// 모든 가족의 정책 범위 saved_places와 Premium 전용 academies를 평가, 도착/출발 시
// 부모 알림. 백그라운드/종료된 자녀 앱에서도 동작하는 하이브리드 geofence 의 서버 절반.
// 상태머신·문구·멱등키는 ../shared/registeredPlaceGeofence.js(클라 parity) 재사용.
//
// 원본 대비: Deno.serve(service_role JWT 게이트) 제거 → scheduled 내부 호출이라 run(env)만.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import {
  evaluateRegisteredPlaceTransition,
  evaluateRegisteredPlaceTimer,
  INITIAL_REGISTERED_PLACE_STATE,
  REGISTERED_PLACE_ACTIONS,
  SERVER_GEOFENCE_CONFIG,
  canonicalizeRegisteredPlaces,
  defaultRegisteredPlaceRadiusM,
  placePresenceIdempotencyKey,
  buildPlaceArrivedAlert,
  buildPlaceLeftAlert,
  planRegisteredPlacePresenceDelivery,
  isStaleRegisteredPlaceLeave,
  STALE_LEAVE_ARRIVAL_WINDOW_MS,
  resolveRegisteredPlaceStateForEvaluation,
} from "../shared/registeredPlaceGeofence.js";
import { pgTs, pgToMs } from "../lib/time";
import {
  coord,
  loadLatestFix,
  loadRecentFixes,
  loadPlacePresence,
  persistPlacePresence,
  loadRegisteredPlaceFamilyPolicies,
  loadChildMembers,
  isUsableRegisteredPlaceFixAccuracy,
  type PlacePresenceState,
  type RegisteredPlaceFamilyPolicy,
} from "./_geo";
import { chunkSqlVariables } from "../lib/sqlChunk";
import { deliverParentAlert } from "./_deliver";
import { runSingleProactive } from "../routes/ai-proactive";
import {
  buildScheduledArrivalAlert,
  eventStartAtMs,
  findNearbyScheduleAtPlace,
  findScheduleArrivalOverlap,
  hasScheduleArrivalOverlap,
  scheduleWindowDateKeys,
  type ScheduleArrivalCandidate,
} from "../lib/scheduleArrivalOverlap";
import { eventOccurrenceAlertId } from "../lib/eventOccurrence";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { recordLocationConfirmationForSubjects } from "../lib/locationConfirmationAudit";

const GEOFENCE_FIX_FRESH_MS = 15 * 60 * 1000;
const EPISODE_BUCKET_MS = 10 * 60 * 1000;
// tick(2분) 사이의 fix 를 전부 재생하는 윈도우 — 3 tick 분량 + 여유.
const REPLAY_WINDOW_MS = 8 * 60 * 1000;
const FAMILY_QUERY_CHUNK = 90;

interface PlaceRow {
  placeKey: string;
  source: string;
  name: string;
  lat: number;
  lng: number;
  alertRadiusM?: number;
}

interface RegisteredPlaceChild {
  familyId: string;
  childUserId: string;
  childMemberId?: string;
  name: string;
}

type RegisteredPlaceReplayFix = {
  lat: number;
  lng: number;
  accuracy: number;
  tMs: number;
};

export function selectRegisteredPlaceEvaluationFixes(
  replay: RegisteredPlaceReplayFix[],
  current: { lat: number; lng: number; accuracyM?: number | null; updatedAtMs: number } | undefined,
  nowMs: number,
): RegisteredPlaceReplayFix[] {
  if (replay.length > 0) return replay;
  if (
    !current
    || !isUsableRegisteredPlaceFixAccuracy(current.accuracyM)
    || !Number.isFinite(current.updatedAtMs)
    || nowMs - current.updatedAtMs > GEOFENCE_FIX_FRESH_MS
  ) return [];
  return [{
    lat: current.lat,
    lng: current.lng,
    accuracy: Number(current.accuracyM),
    tMs: current.updatedAtMs,
  }];
}

export function shouldSuppressRegisteredPlaceEnterForSchedule(input: {
  place: { lat: number; lng: number };
  atMs: number;
  events: ScheduleArrivalCandidate[];
  radiusM?: number;
  windowMs?: number;
}): boolean {
  return hasScheduleArrivalOverlap(
    input.place,
    input.atMs,
    input.events,
    input.radiusM,
    input.windowMs,
  );
}

async function loadScheduleArrivalCandidates(
  db: D1Database,
  children: RegisteredPlaceChild[],
  nowMs: number,
): Promise<Map<string, ScheduleArrivalCandidate[]>> {
  const byChild = new Map<string, ScheduleArrivalCandidate[]>();
  const dateKeys = scheduleWindowDateKeys(nowMs);
  const datePh = dateKeys.map(() => "?").join(",");
  for (const child of children) {
    if (!child.childMemberId) continue;
    const { results } = await db
      .prepare(
        `SELECT DISTINCT e.id, e.title, e.date_key, e.time, e.location, e.updated_at
           FROM events e
           LEFT JOIN events_children ec ON ec.event_id = e.id
          WHERE e.family_id = ? AND e.date_key IN (${datePh})
            AND (e.is_family_event = 1 OR ec.child_id = ?)`,
      )
      .bind(child.familyId, ...dateKeys, child.childMemberId)
      .all<{ id: string; title: string; date_key: string; time: string | null; location: unknown; updated_at: string }>();
    const candidates: ScheduleArrivalCandidate[] = [];
    for (const event of results ?? []) {
      const point = coord(event.location);
      if (!point || typeof event.time !== "string") continue;
      const startAtMs = eventStartAtMs(String(event.date_key), event.time);
      if (startAtMs == null) continue;
      candidates.push({
        eventId: String(event.id),
        occurrenceId: eventOccurrenceAlertId({
          eventId: String(event.id),
          dateKey: String(event.date_key),
          updatedAt: String(event.updated_at ?? ""),
        }),
        title: String(event.title || "일정"),
        startAtMs,
        lat: point.lat,
        lng: point.lng,
      });
    }
    byChild.set(`${child.familyId}:${child.childUserId}`, candidates);
  }
  return byChild;
}

// 자녀의 최근 도착 알림(등록장소 place_arrived / 일정 arrived) 1건 — 순서 역전
// ("피아노 도착" 뒤 "학교 출발") 억제 판정에 쓴다. window 밖이면 null.
async function loadRecentArrivalAlert(
  db: D1Database,
  familyId: string,
  childUserId: string,
  nowMs: number,
): Promise<{ title: string; createdAtMs: number } | null> {
  const cutoff = pgTs(new Date(nowMs - STALE_LEAVE_ARRIVAL_WINDOW_MS));
  const row = await db
    .prepare(
      `SELECT title, created_at FROM parent_alerts
        WHERE family_id = ? AND child_user_id = ?
          AND alert_type IN ('place_arrived','arrived')
          AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(familyId, childUserId, cutoff)
    .first<{ title: string; created_at: string }>();
  if (!row) return null;
  const createdAtMs = pgToMs(String(row.created_at));
  return {
    title: String(row.title || ""),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : nowMs,
  };
}

// Free는 저장 정책 한도(기본 2, review grandfather 3), Premium은 저장 장소와
// academy 전체를 평가한다. 초과 saved_places 행은 삭제하지 않아 업그레이드 시 복원된다.
export async function loadFamilyPlaces(
  db: D1Database,
  policies: RegisteredPlaceFamilyPolicy[],
): Promise<Map<string, PlaceRow[]>> {
  const byFamily = new Map<string, PlaceRow[]>();
  if (!policies.length) return byFamily;
  const add = (familyId: string, source: string, id: unknown, name: unknown, loc: unknown) => {
    const c = coord(loc);
    if (!c) return;
    const arr = byFamily.get(familyId) || [];
    arr.push({
      placeKey: `registered:${source}:${id}`,
      source,
      name: String(name || "등록된 장소"),
      lat: c.lat,
      lng: c.lng,
      ...(c.alertRadiusM != null ? { alertRadiusM: c.alertRadiusM } : {}),
    });
    byFamily.set(familyId, arr);
  };
  const policyByFamily = new Map(policies.map((policy) => [policy.familyId, policy]));
  const uniqueIds = [...new Set(policies.map((policy) => policy.familyId).filter(Boolean))];
  for (const ids of chunkSqlVariables(uniqueIds, FAMILY_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const saved = await db
      .prepare(
        `SELECT id, family_id, name, location, created_at
           FROM saved_places
          WHERE family_id IN (${ph})
          ORDER BY family_id ASC, substr(created_at,1,19) ASC, id ASC`,
      )
      .bind(...ids)
      .all<{ id: string; family_id: string; name: string; location: string; created_at: string }>();
    const savedCounts = new Map<string, number>();
    for (const r of saved.results ?? []) {
      const familyId = String(r.family_id);
      const policy = policyByFamily.get(familyId);
      if (!policy) continue;
      const selectedCount = savedCounts.get(familyId) ?? 0;
      if (policy.savedPlaceLimit != null && selectedCount >= policy.savedPlaceLimit) continue;
      savedCounts.set(familyId, selectedCount + 1);
      add(familyId, "saved_place", r.id, r.name, r.location);
    }
  }

  const premiumIds = policies
    .filter((policy) => policy.isPremium)
    .map((policy) => policy.familyId);
  for (const ids of chunkSqlVariables(premiumIds, FAMILY_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const acads = await db
      .prepare(
        `SELECT id, family_id, name, location
           FROM academies
          WHERE family_id IN (${ph})
          ORDER BY family_id ASC, substr(created_at,1,19) ASC, id ASC`,
      )
      .bind(...ids)
      .all<{ id: string; family_id: string; name: string; location: string }>();
    for (const r of acads.results ?? []) add(String(r.family_id), "academy", r.id, r.name, r.location);
  }
  for (const [familyId, places] of byFamily) {
    byFamily.set(familyId, canonicalizeRegisteredPlaces(places) as PlaceRow[]);
  }
  return byFamily;
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const penv = env as PushEnv;

  // 알림 활성 가족의 티어 정책 → 자녀 멤버 → 최신 fix(24h).
  const familyPolicies = await loadRegisteredPlaceFamilyPolicies(db);
  if (!familyPolicies.length) return { checked: 0, families: 0, arrived: 0, left: 0, scheduleSuppressed: 0 };
  const policyFamilyIds = familyPolicies.map((policy) => policy.familyId);
  const members = await loadChildMembers(db, policyFamilyIds);
  if (!members.length) return { checked: 0, families: 0, arrived: 0, left: 0, scheduleSuppressed: 0 };
  const placesByFamily = await loadFamilyPlaces(db, familyPolicies);
  const membersWithPlaces = members.filter((member) =>
    (placesByFamily.get(member.familyId)?.length ?? 0) > 0
  );
  if (!membersWithPlaces.length) {
    return { checked: 0, families: 0, arrived: 0, left: 0, scheduleSuppressed: 0 };
  }
  const registeredUse = {
    action: "use" as const,
    requesterKind: "system" as const,
    requesterUserId: null,
    recipientKind: "none" as const,
    recipientUserId: null,
    collectionMethod: "not_applicable" as const,
    serviceCode: "registered_place_monitor" as const,
    deliveryMethod: "worker_internal" as const,
    purposeCode: "arrival_departure_alert" as const,
  };
  const nowMs = Date.now();
  const childUserIds = membersWithPlaces.map((member) => member.childUserId);
  const recentFixes = await loadRecentFixes(db, childUserIds, REPLAY_WINDOW_MS);
  const historyMembers = membersWithPlaces.filter((member) =>
    (recentFixes.get(`${member.familyId}:${member.childUserId}`)?.length ?? 0) > 0
  );
  await recordLocationConfirmationForSubjects(db, historyMembers.map((member) => ({
    familyId: member.familyId,
    subjectUserId: member.childUserId,
  })), {
    ...registeredUse,
    acquisitionPath: "location_history_store",
  });

  const fallbackMembers = membersWithPlaces.filter((member) =>
    (recentFixes.get(`${member.familyId}:${member.childUserId}`)?.length ?? 0) === 0
  );
  const fixMap = await loadLatestFix(
    db,
    fallbackMembers.map((member) => member.childUserId),
    GEOFENCE_FIX_FRESH_MS,
  );
  const currentMembers = fallbackMembers.filter((member) => {
    const fix = fixMap.get(`${member.familyId}:${member.childUserId}`);
    return selectRegisteredPlaceEvaluationFixes([], fix, nowMs).length > 0;
  });
  await recordLocationConfirmationForSubjects(db, currentMembers.map((member) => ({
    familyId: member.familyId,
    subjectUserId: member.childUserId,
  })), {
    ...registeredUse,
    acquisitionPath: "current_location_store",
  });

  // 정확한 이력 재생을 우선하고, 이력이 없을 때만 신선하고 usable한 current를
  // fallback으로 사용한다. 부정확·오래된 좌표는 확인자료와 안전 판정 모두에서 제외한다.
  const usableChildKeys = new Set(
    [...historyMembers, ...currentMembers]
      .map((member) => `${member.familyId}:${member.childUserId}`),
  );
  const children: RegisteredPlaceChild[] = membersWithPlaces.filter((member) =>
    usableChildKeys.has(`${member.familyId}:${member.childUserId}`)
  );
  const familyIds = [...new Set(children.map((child) => child.familyId))];
  const presence = await loadPlacePresence(db, familyIds);

  const scheduleCandidates = await loadScheduleArrivalCandidates(db, children, nowMs);
  const A = REGISTERED_PLACE_ACTIONS;
  let arrived = 0;
  let left = 0;
  let scheduleSuppressed = 0;
  let mergedLeft = 0;
  let staleLeftSuppressed = 0;
  let silentLeft = 0;
  let aiArrivalTriggered = 0;
  let aiArrivalQueued = 0;

  // 한 배치에서 나온 전이 1건 — 수집(1단계) 후 계획(2단계)·전달(3단계)로 나눈다.
  interface CollectedStep {
    place: PlaceRow;
    stateKey: string;
    // enter/leave = 알림 후보, silent = 상태만 영속(SILENT_LEAVE·병합/억제된 출발).
    kind: "enter" | "leave" | "silent";
    episodeMs: number;
    bucket: number;
    nextState: PlacePresenceState;
    fromPlaceName?: string;
    scheduleMatch: ReturnType<typeof findScheduleArrivalOverlap>;
    scheduleAssociation: ReturnType<typeof findNearbyScheduleAtPlace>;
  }

  for (const child of children) {
    const childMutationScopes = await loadFamilyNotificationMutationScopes(
      db,
      child.familyId,
      [child.childUserId],
    );
    if (!childMutationScopes) continue;
    const childMutationLeases = await acquireAccountMutationLeases(db, childMutationScopes);
    if (childMutationLeases.status !== "acquired") continue;
    try {
    if (!(await isActiveChildMutationTarget(db, child.familyId, child.childUserId))) continue;
    const places = placesByFamily.get(child.familyId) || [];
    const replay = recentFixes.get(`${child.familyId}:${child.childUserId}`) || [];
    const current = fixMap.get(`${child.familyId}:${child.childUserId}`);
    const fixes = selectRegisteredPlaceEvaluationFixes(replay, current, nowMs);
    if (fixes.length === 0) continue;

    // ── 1단계: 장소별 상태머신 재생 — 전이를 수집만 하고 전달은 미룬다 ──
    // 위치 미보고 뒤 몰아친 재생에서 "학교 출발"과 "집 도착"이 장소 배열 순서로
    // 몇 초 간격 연발·시간 역전되던 사고(2026-07-15)의 근본 수정: 자녀 단위로
    // 모든 전이를 모아 episode 시간순으로 정렬·병합한 뒤 전달한다.
    const collected: CollectedStep[] = [];
    const trailing = new Map<string, { place: PlaceRow; state: PlacePresenceState; dirty: boolean }>();

    // fix 재생과 wall-clock 타이머 확정이 같은 방식으로 전이를 수집하도록 한 곳에 모은다.
    const collectTransition = (
      action: string,
      nextState: PlacePresenceState,
      place: PlaceRow,
      stateKey: string,
      fallbackMs: number,
    ) => {
      const isEnter = action === A.ENTER;
      const episodeMs = isEnter
        ? nextState.firstInsideAtMs ?? fallbackMs
        : nextState.lastDepartedAtMs ?? fallbackMs;
      const childScheduleCandidates = scheduleCandidates.get(`${child.familyId}:${child.childUserId}`) || [];
      const scheduleMatch = isEnter
        ? findScheduleArrivalOverlap(place, episodeMs, childScheduleCandidates)
        : null;
      const scheduleAssociation = isEnter
        ? (scheduleMatch ?? findNearbyScheduleAtPlace(place, episodeMs, childScheduleCandidates))
        : null;
      collected.push({
        place,
        stateKey,
        // SILENT_LEAVE = 조용한 재진입 에피소드의 출발 — 알림 없이 상태만 진행.
        kind: isEnter ? "enter" : action === A.LEAVE ? "leave" : "silent",
        episodeMs,
        bucket: Math.floor(episodeMs / EPISODE_BUCKET_MS),
        nextState,
        scheduleMatch,
        scheduleAssociation,
      });
      if (action === A.SILENT_LEAVE) silentLeft++;
    };

    for (const place of places) {
      const stateKey = `${child.familyId}:${child.childUserId}:${place.placeKey}`;
      const persisted: PlacePresenceState =
        presence.get(stateKey) || { ...INITIAL_REGISTERED_PLACE_STATE, updatedAtMs: null };
      let cur = resolveRegisteredPlaceStateForEvaluation({
        state: persisted,
        updatedAtMs: persisted.updatedAtMs,
        nowMs,
      });
      // 지난 tick 에서 이미 소화한 fix 는 건너뛴다(시간 역행 재적용 방지).
      // 영속은 전이 발생 시에만 일어나므로, 무전이 구간은 다음 tick 에 같은 fix 를
      // 다시 재생해도 동일 결과(멱등)다.
      const persistedAtMs = Number.isFinite(persisted.updatedAtMs) ? Number(persisted.updatedAtMs) : 0;
      const placeRadiusM =
        place.alertRadiusM ?? (defaultRegisteredPlaceRadiusM as (n: string) => number | null)(place.name) ?? undefined;
      let trailingDirty = false;

      for (const f of fixes) {
        if (f.tMs <= persistedAtMs) continue;
        const { action, nextState } = evaluateRegisteredPlaceTransition({
          state: cur,
          fix: { lat: f.lat, lng: f.lng, accuracy: f.accuracy, tMs: f.tMs },
          place: { lat: place.lat, lng: place.lng, alertRadiusM: placeRadiusM },
          config: SERVER_GEOFENCE_CONFIG,
        });

        if (action === A.ENTER || action === A.LEAVE || action === A.SILENT_LEAVE) {
          collectTransition(action, nextState, place, stateKey, f.tMs);
          cur = nextState;
          trailingDirty = false;
          continue;
        }

        if (
          cur.phase !== nextState.phase ||
          cur.firstInsideAtMs !== nextState.firstInsideAtMs ||
          cur.departureArmedAtMs !== nextState.departureArmedAtMs ||
          cur.lastDepartedAtMs !== nextState.lastDepartedAtMs
        ) {
          cur = nextState;
          trailingDirty = true;
        }
      }
      // 재생이 끝난 뒤, 마지막 fix 가 신선하면 wall-clock 으로 타이머만 더 진행시킨다.
      // 정지 중에는 위치 업로드가 120초 간격이라 dwell·이탈 타이머가 이미 만족했는데도
      // 다음 fix 가 올 때까지 알림이 밀렸다(2026-07-24 실측: 도착 3.5분·출발 2분 지연).
      const lastFix = fixes[fixes.length - 1];
      if (lastFix) {
        const timer = evaluateRegisteredPlaceTimer({
          state: cur,
          fix: { lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy, tMs: lastFix.tMs },
          place: { lat: place.lat, lng: place.lng, alertRadiusM: placeRadiusM },
          nowMs,
          config: SERVER_GEOFENCE_CONFIG,
        });
        if (timer.action === A.ENTER || timer.action === A.LEAVE || timer.action === A.SILENT_LEAVE) {
          collectTransition(timer.action, timer.nextState, place, stateKey, nowMs);
          cur = timer.nextState;
          trailingDirty = false;
        }
      }
      trailing.set(stateKey, { place, state: cur, dirty: trailingDirty });
    }

    // ── 2단계: 전달 계획 — 시간순 정렬, 출발→같은 배치 다른 장소 도착에 병합 ──
    type PlanInput = { ref: CollectedStep; kind: "enter" | "leave"; placeKey: string; placeName: string; episodeMs: number };
    const planInputs: PlanInput[] = collected
      .filter((s) => s.kind === "enter" || s.kind === "leave")
      .map((s) => ({ ref: s, kind: s.kind as "enter" | "leave", placeKey: s.place.placeKey, placeName: s.place.name, episodeMs: s.episodeMs }));
    for (const planned of planRegisteredPlacePresenceDelivery(planInputs) as Array<PlanInput & { deliver: boolean; fromPlaceName?: string }>) {
      if (planned.kind === "enter" && planned.fromPlaceName) planned.ref.fromPlaceName = planned.fromPlaceName;
      if (planned.kind === "leave" && !planned.deliver) {
        planned.ref.kind = "silent";
        mergedLeft++;
      }
    }

    // 이전 tick 에서 이미 다른 장소 도착을 전달했는데 이탈 확정이 늦게 흘러온 출발은
    // 순서 역전 소음("피아노 도착" 뒤 "학교 출발")이므로 조용히 상태만 진행한다.
    if (collected.some((s) => s.kind === "leave")) {
      const recentArrival = await loadRecentArrivalAlert(db, child.familyId, child.childUserId, nowMs);
      for (const s of collected) {
        if (s.kind !== "leave") continue;
        if (isStaleRegisteredPlaceLeave({ placeName: s.place.name, recentArrival, nowMs })) {
          s.kind = "silent";
          staleLeftSuppressed++;
        }
      }
    }

    // ── 3단계: episode 시간순 전달·영속. 같은 장소 체인은 실패 시 이후 단계 중단 ──
    collected.sort((a, b) => a.episodeMs - b.episodeMs);
    const blockedStateKeys = new Set<string>();
    for (const step of collected) {
      if (blockedStateKeys.has(step.stateKey)) continue;
      if (step.kind === "silent") {
        await persistPlacePresence(db, child.familyId, child.childUserId, step.place.placeKey, step.nextState);
        presence.set(step.stateKey, { ...step.nextState, updatedAtMs: Date.now() });
        continue;
      }

      const isEnter = step.kind === "enter";
      // 일정과 겹치면 일반 장소 도착을 조용히 버리지 않고 더 구체적인 일정 도착으로
      // 즉시 승격한다. occurrence id가 native 일정 판정과 같아 어느 경로가 먼저여도 1건이다.
      const alert = step.scheduleMatch
        ? buildScheduledArrivalAlert(child.name, step.scheduleMatch)
        : (isEnter
          ? buildPlaceArrivedAlert(child.name, step.place.name, step.fromPlaceName)
          : buildPlaceLeftAlert(child.name, step.place.name));
      const idempotencyKey = step.scheduleAssociation?.occurrenceId
        ?? placePresenceIdempotencyKey(isEnter ? "arrived" : "left", child.childUserId, step.place.placeKey, step.bucket);

      const { pushOk, alertId } = await deliverParentAlert(penv, db, {
        familyId: child.familyId,
        childUserId: child.childUserId,
        alert,
        idempotencyKey,
        sourceEventId: step.scheduleAssociation?.eventId ?? null,
        // 장소 단위 쿨다운 dedup 스코프 — 네이티브가 같은 방문을 이미 알렸으면 여기서 멈춘다.
        presencePlaceKey: step.place.placeKey,
      });
      // geofence: push 또는 alert 기록 실패 → state 미진행 → 다음 tick 재시도.
      if (!(pushOk && alertId != null)) {
        blockedStateKeys.add(step.stateKey);
        continue;
      }

      await persistPlacePresence(db, child.familyId, child.childUserId, step.place.placeKey, step.nextState);
      presence.set(step.stateKey, { ...step.nextState, updatedAtMs: Date.now() });
      if (isEnter && step.scheduleMatch) scheduleSuppressed++;
      else if (isEnter) arrived++;
      else left++;
      if (isEnter && step.place.name.includes("집")) {
        aiArrivalTriggered++;
        try {
          const aiResult = await runSingleProactive(penv, db, {
            familyId: child.familyId,
            childUserId: child.childUserId,
            trigger: "place_arrival",
            placeName: step.place.name,
            minIntervalMinutes: 120,
          });
          aiArrivalQueued += Number(aiResult.generated ?? 0);
        } catch (e) {
          console.error("[registered-place] home-arrival AI greeting failed");
        }
      }
    }

    // 알림 없는 타이머 전이(pending/armed)는 재생 종료 후 1회만 영속.
    // 전달 실패로 막힌 장소는 마지막 성공 지점 이후 상태를 진행시키지 않는다.
    for (const [stateKey, fin] of trailing) {
      if (!fin.dirty || blockedStateKeys.has(stateKey)) continue;
      await persistPlacePresence(db, child.familyId, child.childUserId, fin.place.placeKey, fin.state);
      presence.set(stateKey, { ...fin.state, updatedAtMs: Date.now() });
    }
    } finally {
      await releaseAccountMutationLeases(db, childMutationLeases.leases);
    }
  }

  return {
    checked: children.length,
    families: familyIds.length,
    arrived,
    left,
    scheduleSuppressed,
    mergedLeft,
    staleLeftSuppressed,
    silentLeft,
    aiArrivalTriggered,
    aiArrivalQueued,
  };
}
