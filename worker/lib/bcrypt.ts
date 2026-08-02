// 비밀번호 해시 검증. GoTrue가 저장한 bcrypt 해시($2a$/$2b$/$2y$)를 그대로 검증해
// 기존 전화+비밀번호 사용자가 동일 ID/비번으로 로그인 가능하게 한다.
// bcryptjs는 순수 JS라 Workers 런타임에서 동작(네이티브 바인딩 없음).
import bcrypt from "bcryptjs";

export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!plain || !hash) return false;
  // GoTrue는 $2a$ 프리픽스를 쓰며 bcryptjs와 호환.
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
