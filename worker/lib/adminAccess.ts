// 운영자(관리자) 접근 판정 — 계정 id 화이트리스트.
//
// 이 앱에는 admin 역할이 없다(parent|child|teacher). 전역 설정은 모든 가족의 아이에게
// 함께 적용되므로 역할을 새로 만들어 DB에 흩뿌리는 대신, Worker secret ADMIN_USER_IDS 에
// 적힌 계정만 통과시킨다. 관리자 추가·제거는 secret 갱신+재배포로만 가능하다.
//
// ★fail-closed 원칙: secret 이 없거나 비어 있으면 **아무도** 관리자가 아니다. 설정 누락을
// "전부 허용"으로 해석하면 전역 AI 프롬프트가 누구에게나 열린다.
import type { Env } from "../types";

/** 콤마/공백/줄바꿈 구분 목록을 정규화한다. 대소문자는 UUID 표기 흔들림을 감안해 무시. */
export function parseAdminUserIds(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (typeof raw !== "string") return out;
  for (const piece of raw.split(/[\s,;]+/)) {
    const id = piece.trim().toLowerCase();
    if (id) out.add(id);
  }
  return out;
}

export function isAdminUserId(env: Pick<Env, "ADMIN_USER_IDS">, userId: string | null | undefined): boolean {
  const id = String(userId ?? "").trim().toLowerCase();
  if (!id) return false;
  const allowed = parseAdminUserIds(env.ADMIN_USER_IDS);
  if (allowed.size === 0) return false; // fail-closed
  return allowed.has(id);
}
