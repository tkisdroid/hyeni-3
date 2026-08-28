import {
  STUDY_API_VERSION,
  type CalendarChildProjectionDto,
} from "../contracts/studyRpc.ts";

type ActiveChildProjectionRow = Readonly<{
  name: string;
  photo_url: string | null;
  created_at: string;
}>;

/**
 * Study로 전달할 자녀의 최소 표시 정보를 family/member 동시 범위로 조회한다.
 * 생년월일·학년 재정의·사용자 ID·사진 키는 select하지 않아 경계를 넘어갈 수 없다.
 */
export async function getActiveChildProjection(
  db: D1Database,
  familyId: string,
  memberId: string,
): Promise<CalendarChildProjectionDto> {
  const row = await db.prepare(
    `SELECT name, photo_url, created_at
       FROM family_members
      WHERE family_id=?1 AND id=?2 AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(familyId, memberId).first<ActiveChildProjectionRow>();

  if (!row) {
    return {
      apiVersion: STUDY_API_VERSION,
      status: "inactive_or_missing",
      memberId,
    };
  }

  return {
    apiVersion: STUDY_API_VERSION,
    status: "active",
    memberId,
    displayName: row.name,
    hasAvatar: typeof row.photo_url === "string" && row.photo_url.trim().length > 0,
    revision: row.created_at,
  };
}
