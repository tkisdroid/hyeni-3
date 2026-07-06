/**
 * 친구놀이(friend_playdate) 도메인 엔드포인트.
 * hyeni-1 worker/routes/playdate.ts 서버 계약을 그대로 포팅한다.
 *
 * 흐름: 후보(candidates) → 초대 생성(invites) → 상대 자녀 수락/거절
 *       → 세션(sessions) 연결 → 종료(sessions/:id PATCH).
 *
 * 권한(서버 강제):
 * - 초대 생성: 발신 자녀 본인만(requester_child_id === requester_user_id === caller).
 * - 수락/거절: 수신 자녀 본인만(receiver_child_id === caller).
 * - 세션 종료: 양쪽 가족 멤버(부모/자녀).
 *
 * 응답은 서버가 이미 ISO 로 정규화(hydrate)해 내려주므로 snake_case 그대로 소비한다.
 */
import { apiGet, apiPost, apiPatch } from "../client";

/** 유효한 세션 종료 사유(서버 VALID_STOP_REASONS 와 동일). */
export type StopReason = "child_end" | "parent_end" | "auto_geofence_exit";

/** 150m 반경·위험구역 밖의 다른 가족 자녀 후보. */
export interface PlaydateCandidate {
  family_id: string;
  child_user_id: string;
  child_name: string;
  public_place_id: string;
}

/**
 * 후보 응답. 서버는 soft error(권한/위치없음/위험구역/친구놀이꺼짐)를
 * 200 + { error } 로 내려준다(throw 회피) — 컴포넌트가 error 를 직접 분기한다.
 */
export interface PlaydateCandidatesResponse {
  candidates: PlaydateCandidate[];
  public_place_id?: string | null;
  error?: string;
}

/** 초대(친구놀이 pending/accepted/declined). direction 은 조회 가족 관점. */
export interface PlaydateInvite {
  id: string;
  public_place_id: string;
  requester_family_id: string;
  receiver_family_id: string;
  requester_child_id: string;
  receiver_child_id: string;
  requester_user_id: string;
  status: "pending" | "accepted" | "declined" | string;
  session_id: string | null;
  requested_at: string | null;
  responded_at: string | null;
  responded_by: string | null;
  expires_at: string | null;
  created_at: string | null;
  direction?: "incoming" | "outgoing";
  place_name?: string;
  friend_child_name?: string;
}

/** 진행 중/종료된 놀이 세션. active 조회 시 친구 이름·장소·연락처 enrich. */
export interface PlaydateSession {
  id: string;
  public_place_id: string;
  family_a_id: string;
  family_b_id: string;
  child_a_id?: string;
  child_b_id?: string;
  started_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  place_name?: string;
  friend_child_name?: string;
  friend_family_phones?: string[];
}

export interface EndPlaydateResult {
  updated: boolean;
  session?: PlaydateSession;
}

export interface FamilyPlaydateEnabled {
  id: string;
  playdate_enabled: boolean;
}

/** 근처(150m) 친구 후보 조회. soft error 포함 응답 객체 그대로 반환. */
export function fetchPlaydateCandidates(familyId: string): Promise<PlaydateCandidatesResponse> {
  return apiGet<PlaydateCandidatesResponse>(
    `/api/playdate/candidates?family_id=${encodeURIComponent(familyId)}`,
  );
}

/** 우리 가족 관련 pending 초대(수신/발신 모두, direction 포함). */
export function fetchPendingPlaydateInvites(familyId: string): Promise<PlaydateInvite[]> {
  return apiGet<PlaydateInvite[]>(
    `/api/playdate/invites/pending?family_id=${encodeURIComponent(familyId)}`,
  );
}

export interface CreatePlaydateInviteInput {
  publicPlaceId: string;
  requesterFamilyId: string;
  receiverFamilyId: string;
  requesterChildId: string;
  receiverChildId: string;
  requesterUserId: string;
}

/** 발신 자녀가 근처 친구에게 놀이 초대 생성. 서버가 hydrate 한 초대 반환. */
export function createPlaydateInvite(input: CreatePlaydateInviteInput): Promise<PlaydateInvite> {
  return apiPost<PlaydateInvite>("/api/playdate/invites", {
    public_place_id: input.publicPlaceId,
    requester_family_id: input.requesterFamilyId,
    receiver_family_id: input.receiverFamilyId,
    requester_child_id: input.requesterChildId,
    receiver_child_id: input.receiverChildId,
    requester_user_id: input.requesterUserId,
  });
}

/** 수신 자녀가 초대 수락 → 세션 생성 후 세션 반환. */
export function acceptPlaydateInvite(inviteId: string): Promise<PlaydateSession> {
  return apiPost<PlaydateSession>(`/api/playdate/invites/${encodeURIComponent(inviteId)}/accept`, {});
}

/** 수신 자녀가 초대 거절 → 갱신된 초대 반환. */
export function declinePlaydateInvite(inviteId: string): Promise<PlaydateInvite> {
  return apiPost<PlaydateInvite>(`/api/playdate/invites/${encodeURIComponent(inviteId)}/decline`, {});
}

/** 진행 중 세션(없으면 null). */
export function fetchActivePlaydateSession(familyId: string): Promise<PlaydateSession | null> {
  return apiGet<PlaydateSession | null>(
    `/api/playdate/sessions/active?family_id=${encodeURIComponent(familyId)}`,
  );
}

/** 멱등 종료 PATCH. 첫 종료만 updated:true(중복 종료는 updated:false). */
export function endPlaydate(sessionId: string, stopReason: StopReason): Promise<EndPlaydateResult> {
  return apiPatch<EndPlaydateResult>(`/api/playdate/sessions/${encodeURIComponent(sessionId)}`, {
    stop_reason: stopReason,
  });
}

/** 우리 가족의 친구놀이 허용 여부(부모 동의 토글). 행 없음은 기본 true. */
export function fetchFamilyPlaydateEnabled(familyId: string): Promise<FamilyPlaydateEnabled> {
  return apiGet<FamilyPlaydateEnabled>(
    `/api/playdate/family-enabled?family_id=${encodeURIComponent(familyId)}`,
  );
}
