// 계정의 로그인 방식(가입 방식) 정본.
// 세션 JWT·로그인 응답의 app_metadata.provider 는 로그인 경로마다 달라서(비밀번호 로그인 응답에는 없다)
// 같은 전화번호 가입 계정이 "전화번호 계정"/"ID 계정"으로 다르게 보였다. 화면 표시는 이 값을 쓴다.

export type AccountAuthProvider = "kakao" | "google" | "naver" | "phone" | "anonymous";

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(["kakao", "google", "naver", "phone"]);

function knownProvider(value: unknown): AccountAuthProvider | null {
  return typeof value === "string" && KNOWN_PROVIDERS.has(value) ? (value as AccountAuthProvider) : null;
}

/** 가입 프로필 → 첫 로그인 연결 → 익명 여부 순으로 판정한다. 모르면 null(화면은 기본 라벨). */
export function resolveAccountAuthProvider(row: {
  profile_provider?: unknown;
  identity_provider?: unknown;
  anon?: unknown;
} | null): AccountAuthProvider | null {
  if (!row) return null;
  const fromProfile = knownProvider(row.profile_provider);
  if (fromProfile) return fromProfile;
  const fromIdentity = knownProvider(row.identity_provider);
  if (fromIdentity) return fromIdentity;
  return Number(row.anon) === 1 ? "anonymous" : null;
}

/** 조회 실패는 null 로 강등한다(가족 조회를 막지 않는다). */
export async function readAccountAuthProvider(db: D1Database, userId: string): Promise<AccountAuthProvider | null> {
  try {
    const row = await db
      .prepare(
        `SELECT
           (SELECT provider FROM user_profiles WHERE user_id=?1 LIMIT 1) AS profile_provider,
           (SELECT provider FROM auth_identities WHERE user_id=?1 ORDER BY created_at ASC LIMIT 1) AS identity_provider,
           (SELECT is_anonymous FROM users WHERE id=?1 LIMIT 1) AS anon`,
      )
      .bind(userId)
      .first<{ profile_provider: unknown; identity_provider: unknown; anon: unknown }>();
    return resolveAccountAuthProvider(row);
  } catch {
    return null;
  }
}
