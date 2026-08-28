import {
  STUDY_API_VERSION,
  type CalendarChildProjectionDto,
} from "../contracts/studyRpc.ts";

type ActiveChildProjectionRow = Readonly<{
  name: string | null;
  photo_url: string | null;
}>;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function projectionRevision(displayName: string, hasAvatar: boolean): Promise<string> {
  const canonical = `calendar-child-projection:v1\n${JSON.stringify([displayName, hasAvatar])}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return base64url(new Uint8Array(digest));
}

/**
 * Study로 전달할 자녀의 최소 표시 정보를 family/member 동시 범위로 조회한다.
 * 생년월일·학년 재정의·사용자 ID는 조회하지 않고 사진 키는 DTO·revision 경계에 넣지 않는다.
 */
export async function getActiveChildProjection(
  db: D1Database,
  familyId: string,
  memberId: string,
): Promise<CalendarChildProjectionDto> {
  let row: ActiveChildProjectionRow | null;
  try {
    row = await db.prepare(
      `SELECT fm.name, fm.photo_url
         FROM family_members fm
         JOIN families f ON f.id=fm.family_id AND f.id=?1
        WHERE fm.family_id=?1
          AND fm.id=?2
          AND fm.role='child'
          AND fm.is_active=1
          AND f.study_market='KR'
        LIMIT 1`,
    ).bind(familyId, memberId).first<ActiveChildProjectionRow>();
  } catch (error) {
    // code가 expand-only migration보다 먼저 올라간 경우 projection은 개인정보를 열지 않는다.
    if (/no such column:[^\n]*study_market/iu.test(String(error))) row = null;
    else throw error;
  }

  if (!row) {
    return {
      apiVersion: STUDY_API_VERSION,
      status: "inactive_or_missing",
      memberId,
    };
  }

  const displayName = typeof row.name === "string" ? row.name : "";
  const hasAvatar = typeof row.photo_url === "string" && row.photo_url.trim().length > 0;
  return {
    apiVersion: STUDY_API_VERSION,
    status: "active",
    memberId,
    displayName,
    hasAvatar,
    revision: await projectionRevision(displayName, hasAvatar),
  };
}
