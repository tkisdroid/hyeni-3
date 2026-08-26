import {
  CHILD_PHOTO_CONTENT_TYPES,
  validateStoredObjectMetadata,
} from "./storageObjectValidation";
import {
  STUDY_API_VERSION,
  type CalendarProfileServiceContract,
  type ChildProjectionDto,
} from "../contracts/studyRpc";

const STUDY_AVATAR_MAX_BYTES = 512 * 1024;
const STUDY_AVATAR_CONTENT_TYPES = new Set(
  [...CHILD_PHOTO_CONTENT_TYPES].filter((value) => value !== "image/gif"),
);
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

type ActiveStudyChild = Readonly<{
  id: string;
  name: string;
  avatarObjectKey: string | null;
}>;

type CalendarProfileEnvironment = Readonly<{
  DB: D1Database;
  PHOTOS: R2Bucket;
}>;

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found", code: "study_avatar_not_found" }), {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function privateAvatarKey(familyId: string, raw: string | null): string | null {
  const key = String(raw ?? "").trim();
  if (
    !key
    || key.startsWith("/")
    || key.includes("..")
    || key.includes("\\")
    || /^(?:https?:|blob:|data:)/i.test(key)
  ) return null;
  const segments = key.split("/");
  if (segments.length < 2 || segments[0] !== familyId || !SAFE_KEY_SEGMENT.test(familyId)) {
    return null;
  }
  return key;
}

function hasAllowedAvatarMetadata(
  key: string,
  familyId: string,
  metadata: Record<string, string> | undefined,
): boolean {
  if (!key.startsWith(`${familyId}/uploads/`)) return true;
  const segments = key.split("/");
  const ownerUserId = String(metadata?.ownerUserId ?? "").trim();
  const purpose = String(metadata?.purpose ?? "").trim();
  if (
    segments.length !== 4
    || segments[1] !== "uploads"
    || segments[2] !== ownerUserId
    || metadata?.familyId !== familyId
    || !SAFE_KEY_SEGMENT.test(ownerUserId)
  ) return false;
  if (purpose === "profile") {
    return SAFE_KEY_SEGMENT.test(String(metadata?.targetMemberId ?? ""));
  }
  return purpose === "placeholder";
}

async function avatarFingerprint(objectKey: string): Promise<string> {
  const input = new TextEncoder().encode(`hyeni-study-avatar:v1\0${objectKey}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function getActiveStudyChild(
  db: D1Database,
  familyId: string,
  memberId: string,
): Promise<ActiveStudyChild | null> {
  return db.prepare(
    `SELECT id, name, photo_url AS avatarObjectKey
       FROM family_members
      WHERE id=? AND family_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(memberId, familyId).first<ActiveStudyChild>();
}

export function createCalendarProfileService(
  env: CalendarProfileEnvironment,
): CalendarProfileServiceContract {
  return {
    async getActiveChildProjection(
      familyId: string,
      memberId: string,
    ): Promise<ChildProjectionDto> {
      const child = await getActiveStudyChild(env.DB, familyId, memberId);
      if (!child) {
        return {
          apiVersion: STUDY_API_VERSION,
          status: "inactive_or_missing",
          memberId,
        };
      }
      const objectKey = privateAvatarKey(familyId, child.avatarObjectKey);
      return {
        apiVersion: STUDY_API_VERSION,
        status: "active",
        memberId,
        displayName: child.name,
        hasAvatar: objectKey !== null,
        avatarFingerprint: objectKey ? await avatarFingerprint(objectKey) : null,
      };
    },

    async fetchActiveChildAvatar(
      familyId: string,
      memberId: string,
      variant: "study-128",
    ): Promise<Response> {
      if (variant !== "study-128") return notFound();
      const child = await getActiveStudyChild(env.DB, familyId, memberId);
      if (!child) return notFound();
      const objectKey = privateAvatarKey(familyId, child.avatarObjectKey);
      if (!objectKey) return notFound();

      const object = await env.PHOTOS.get(objectKey);
      if (!object || !hasAllowedAvatarMetadata(objectKey, familyId, object.customMetadata)) {
        return notFound();
      }
      const validation = validateStoredObjectMetadata(object, STUDY_AVATAR_CONTENT_TYPES);
      if (!validation.ok || validation.size > STUDY_AVATAR_MAX_BYTES) return notFound();

      return new Response(object.body, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Length": String(validation.size),
          "Content-Type": validation.contentType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  };
}
