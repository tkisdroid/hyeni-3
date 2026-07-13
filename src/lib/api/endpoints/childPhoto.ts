/**
 * 자녀 사진 업로드 엔드포인트.
 * 흐름: 이미지 바이트를 R2(Worker proxy)에 신규 업로드한 뒤, 서버가 발급한 저장 경로(raw path)를 photo_url 로
 *       family_members 에 기록한다. 표시용 proxy URL 변환은 getMyFamily 의 enrichPhotos 담당이라
 *       저장은 항상 raw 경로로 한다.
 *
 * 백엔드 계약(hyeni-1 Worker):
 *  - POST /api/storage/child-photo-uploads/{familyId} (raw binary, Bearer, 서버 키 발급) → { path }
 *  - POST /api/family/member/photo { family_id, member_id, url }  (주 보호자만) — url = 저장 경로
 */
import { apiPost, apiUploadChildPhoto } from "../client";
import { dataUrlToBlob } from "@/lib/imageResize";
import { defaultChildColor, setupFamily } from "./family";

/**
 * 이미 존재하는 아이 멤버의 사진 등록. 저장 경로를 photo_url 로 기록하고 그 경로를 반환한다.
 */
export async function uploadChildPhoto(
  familyId: string,
  memberId: string,
  dataUrl: string,
): Promise<string> {
  if (!familyId || !memberId) throw new Error("가족·아이 정보가 필요해요");
  if (!dataUrl) throw new Error("사진이 필요해요");
  const blob = dataUrlToBlob(dataUrl);
  const uploaded = await apiUploadChildPhoto({
    familyId,
    purpose: "profile",
    targetMemberId: memberId,
    fileOrBlob: blob,
    contentType: blob.type || "image/jpeg",
  });
  await apiPost("/api/family/member/photo", {
    family_id: familyId,
    member_id: memberId,
    url: uploaded.path,
  });
  return uploaded.path;
}

/**
 * 페어링 위저드용: 아직 멤버가 없는 placeholder 아이 사진을 서버 발급 경로에 업로드한다.
 */
export async function uploadPlaceholderChildPhoto(
  familyId: string,
  dataUrl: string,
): Promise<string> {
  if (!familyId) throw new Error("가족 정보가 필요해요");
  const blob = dataUrlToBlob(dataUrl);
  const uploaded = await apiUploadChildPhoto({
    familyId,
    purpose: "placeholder",
    fileOrBlob: blob,
    contentType: blob.type || "image/jpeg",
  });
  return uploaded.path;
}

export interface DraftChildWithPhoto {
  name: string;
  birthdate?: string;
  /** 명시 색상. 없으면 colorIndex 로 기본 팔레트 자동 배정. */
  colorHex?: string;
  colorIndex?: number;
  /** 미업로드 data:URL(선택). 있으면 서버 발급 경로로 업로드 후 photo_url 로 저장. */
  photoDataUrl?: string;
}

/**
 * 위저드: 아이 placeholder 생성 + (있으면) 사진 업로드를 한 번에.
 * 각 사진을 서버 발급 경로로 업로드하고 그 경로를 photo_url 로 setupFamily 에 넘긴다.
 * 사진 업로드 실패는 등록 자체를 막지 않는다(해당 아이만 사진 없이 생성).
 */
export async function setupChildrenWithPhotos(input: {
  familyId: string;
  parentName: string;
  plannedChildCount?: number;
  /** 기존 자녀 수(경로 order 유니크용). */
  startOrder?: number;
  children: DraftChildWithPhoto[];
}): Promise<void> {
  const start = input.startOrder ?? 0;
  const children = await Promise.all(
    input.children.map(async (c, i) => {
      const order = start + i + 1;
      const colorHex =
        c.colorHex && c.colorHex.trim() ? c.colorHex.trim() : defaultChildColor(c.colorIndex ?? order - 1);
      let photoUrl: string | undefined;
      if (c.photoDataUrl) {
        try {
          photoUrl = await uploadPlaceholderChildPhoto(input.familyId, c.photoDataUrl);
        } catch (e) {
          console.warn("[childPhoto] placeholder upload failed, creating without photo", e);
          photoUrl = undefined;
        }
      }
      return {
        name: c.name.trim(),
        birthdate: c.birthdate,
        color_hex: colorHex,
        photo_url: photoUrl,
      };
    }),
  );
  await setupFamily({
    parentName: input.parentName,
    plannedChildCount: input.plannedChildCount,
    children,
  });
}
