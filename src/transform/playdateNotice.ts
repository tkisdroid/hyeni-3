/**
 * 친구놀이 후보 조회의 soft error → 아이 말투 안내(반말).
 * 서버는 권한/위치없음/위험구역/꺼짐을 200 + {error} 로 내려준다(throw 회피).
 * FriendPlay 화면과 아이 홈의 친구놀이 시트가 같은 문구를 쓰도록 단일 출처로 둔다.
 */
export function playdateCandidateNotice(
  error: string | undefined,
  empty: boolean,
  loadFailed = false,
  providedIntl?: IntlShape,
): string | null {
  const intl = withDefaultIntl(providedIntl);
  // 하드 에러(네트워크/5xx)는 "친구 없음"과 다르다 — 없다고 단정하면 거짓 안내가 된다.
  if (loadFailed) return intl.formatMessage({ id: "child.playdate.notice.loadFailed" });
  switch (error) {
    case "playdate_not_enabled":
      return intl.formatMessage({ id: "child.playdate.notice.disabled" });
    case "current_location_unavailable":
      return intl.formatMessage({ id: "child.playdate.notice.noLocation" });
    case "in_danger_zone":
      return intl.formatMessage({ id: "child.playdate.notice.dangerZone" });
    case "forbidden":
      return intl.formatMessage({ id: "child.playdate.notice.forbidden" });
    default:
      return empty ? intl.formatMessage({ id: "child.playdate.notice.empty" }) : null;
  }
}

/** 후보 아바타 — 서버는 사진을 주지 않는다. 아이 id 로 동물 캐릭터를 고정 배정(항상 같은 친구=같은 동물). */
const FRIEND_ANIMALS = [
  "animal/dog.webp",
  "animal/cat.webp",
  "animal/bear.webp",
  "animal/rabbit.webp",
  "animal/fox.webp",
  "animal/panda.webp",
] as const;

export function friendAvatar(childUserId: string): string {
  let hash = 0;
  for (let i = 0; i < childUserId.length; i += 1) {
    hash = (hash * 31 + childUserId.charCodeAt(i)) >>> 0;
  }
  return FRIEND_ANIMALS[hash % FRIEND_ANIMALS.length];
}
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";
