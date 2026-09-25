// 부모 family_members 행의 이름·전화 기본값을 가입 프로필(user_profiles)에서 채운다.
// 앱이 이름을 보내지 않거나(이전 앱은 공동 보호자 합류 때 "부모"를 기본값으로 보냈다) 전화 입력이
// 없을 때, 가입에서 확인한 이름·휴대폰 번호 대신 "부모"·빈 값이 저장되던 문제를 막는다.
import { normalizeMemberDisplayName, normalizeMemberPhoneInput } from "./profileInput";

export const DEFAULT_PARENT_MEMBER_NAME = "부모";

export type ParentProfileDefaults = { name: string; phone: string };

/** 가입 프로필의 휴대폰 번호(E.164)를 멤버 저장형(010-0000-0000)으로 바꾼다. 휴대폰이 아니면 빈 값. */
export function krMobileDisplayFromProfilePhone(value: unknown): string {
  const phone = normalizeMemberPhoneInput(value);
  return phone.ok ? phone.phone : "";
}

/** 요청 이름이 비었거나 옛 기본값("부모")이면 프로필 이름을 쓰고, 그것도 없으면 기본값을 쓴다. */
export function resolveParentMemberName(requested: string, profileName: string): string {
  const req = requested.trim();
  if (req && req !== DEFAULT_PARENT_MEMBER_NAME) return req;
  return profileName || req || DEFAULT_PARENT_MEMBER_NAME;
}

/** 조회 실패는 기본값 없음으로 강등한다(가족 생성·합류를 막지 않는다). */
export async function readParentProfileDefaults(db: D1Database, userId: string): Promise<ParentProfileDefaults> {
  try {
    const row = await db
      .prepare("SELECT display_name, phone FROM user_profiles WHERE user_id=? LIMIT 1")
      .bind(userId)
      .first<{ display_name: string | null; phone: string | null }>();
    return {
      name: normalizeMemberDisplayName(row?.display_name) ?? "",
      phone: krMobileDisplayFromProfilePhone(row?.phone),
    };
  } catch {
    return { name: "", phone: "" };
  }
}
