/**
 * 가족 멤버 사진(private R2 객체) → 표시용 blob URL 해석.
 *
 * 서버는 photo_url 에 `{familyId}/uploads/{uploaderUserId}/{uuid}.{ext}` 같은 객체 키를
 * 저장하므로 그대로 <img src> 에 넣으면 화면에 나오지 않는다. Authorization fetch 로 받아
 * 수명 제한 lease 의 blob URL 로만 표시한다.
 *
 * 가족 조회(useMyFamily)와 계정 조회(useAccount)가 같은 규칙을 쓰도록 여기 한 곳에 둔다.
 * 아이·부모를 구분하지 않으므로 부모 본인 프로필 사진도 같은 경로로 표시된다.
 */
import { useEffect, useMemo, useState } from "react";
import { acquireChildPhotoObjectUrl, peekChildPhotoObjectUrl } from "@/lib/api/client";
import { extractPrivateChildPhotoPath } from "@/transform/childPhotoPath";
import type { FamilyMember } from "@/lib/api/endpoints/family";

interface MemberPhotoRequest {
  memberId: string;
  path: string;
}

interface MemberPhotoState {
  signature: string;
  urls: ReadonlyMap<string, string>;
}

const MEMBER_PHOTO_RETRY_DELAYS_MS = [750, 2_000, 5_000] as const;
/** 화면을 떠난 뒤에도 가족 사진을 잠시 더 둔다 — 설정·홈을 오갈 때 기본 캐릭터로 깜빡이지 않게. */
export const MEMBER_PHOTO_RETAIN_MS = 5 * 60 * 1000;

function peekedUrls(requests: readonly MemberPhotoRequest[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const { memberId, path } of requests) {
    const url = peekChildPhotoObjectUrl(path);
    if (url) urls.set(memberId, url);
  }
  return urls;
}

/** memberId → 표시용 blob URL. 아직 못 받았거나 실패한 멤버는 값이 없다. */
export function useResolvedMemberPhotoUrls(
  members: readonly FamilyMember[] | null | undefined,
): ReadonlyMap<string, string> {
  const requests = useMemo<MemberPhotoRequest[]>(() => (members ?? []).flatMap((member) => {
    const path = extractPrivateChildPhotoPath(member.photo_url);
    return path ? [{ memberId: member.id, path }] : [];
  }), [members]);
  const signature = useMemo(
    () => JSON.stringify(requests.map(({ memberId, path }) => [memberId, path])),
    [requests],
  );
  // 이미 받아 둔 사진은 첫 렌더부터 쓴다(받는 동안 기본 캐릭터가 보였다 사라지는 깜빡임 방지).
  const [photoState, setPhotoState] = useState<MemberPhotoState>(() => ({
    signature,
    urls: peekedUrls(requests),
  }));

  useEffect(() => {
    let active = true;
    const leases = new Set<NonNullable<ReturnType<typeof acquireChildPhotoObjectUrl>>>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    setPhotoState({ signature, urls: peekedUrls(requests) });

    function scheduleRetry(request: MemberPhotoRequest, retryIndex: number): void {
      if (!active || retryIndex >= MEMBER_PHOTO_RETRY_DELAYS_MS.length) return;
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        runAttempt(request, retryIndex + 1);
      }, MEMBER_PHOTO_RETRY_DELAYS_MS[retryIndex]);
      retryTimers.add(timer);
    }

    function runAttempt(request: MemberPhotoRequest, retryIndex: number): void {
      if (!active) return;
      const lease = acquireChildPhotoObjectUrl(request.path, { retainMs: MEMBER_PHOTO_RETAIN_MS });
      if (!lease) return;
      leases.add(lease);
      void lease.url
        .then((url) => {
          if (!active || !url) {
            leases.delete(lease);
            lease.release();
            return;
          }
          setPhotoState((current) => {
            if (current.signature !== signature) return current;
            const urls = new Map(current.urls);
            urls.set(request.memberId, url);
            return { signature, urls };
          });
        })
        .catch(() => {
          leases.delete(lease);
          lease.release();
          // 일시 오류는 제한된 backoff로 복구하되 가족·역할·안전 데이터 로딩은 실패시키지 않는다.
          scheduleRetry(request, retryIndex);
        });
    }

    for (const request of requests) runAttempt(request, 0);

    return () => {
      active = false;
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const lease of leases) lease.release();
      leases.clear();
    };
  // signature가 같으면 poll로 받은 새 객체에도 같은 lease를 유지한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return photoState.signature === signature ? photoState.urls : peekedUrls(requests);
}

/** members 의 private photo_url 을 표시용 blob URL로 바꾼 새 배열(미해석은 null). */
export function withResolvedMemberPhotos(
  members: readonly FamilyMember[],
  urls: ReadonlyMap<string, string>,
): FamilyMember[] {
  return members.map((member) => {
    const privatePath = extractPrivateChildPhotoPath(member.photo_url);
    if (!privatePath) return member;
    return { ...member, photo_url: urls.get(member.id) ?? null };
  });
}
