// AI 친구 대화 무제한 가족 판정 — 소유 부모 계정 화이트리스트.
//
// 운영자 본인 가족처럼 한도·차감을 적용하지 않을 가족을 지정한다. 티어(구독)와는 별개이며
// 결제 상태를 조작하지 않는다 — `family_subscription` 을 건드리면 구독 검증·RTDN 계약이
// 흔들리고 스토어 결제 정본과 어긋난다. 그래서 DB 가 아니라 Worker secret 로만 연다.
//
// 판정 기준은 **가족을 소유한 부모 계정**이다. 가족 id 로 적으면 재페어링·가족 재생성 때마다
// secret 을 고쳐야 하지만, 소유 계정은 그대로이므로 한 번 넣으면 계속 유효하다.
//
// ★fail-closed: secret 이 없거나 비어 있으면 **아무도** 무제한이 아니다.
import type { Env } from "../types";

/** 콤마/공백/줄바꿈 구분 목록을 정규화한다. UUID 대소문자 흔들림을 감안해 소문자로 비교. */
export function parseAiUnlimitedOwnerIds(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (typeof raw !== "string") return out;
  for (const piece of raw.split(/[\s,;]+/)) {
    const id = piece.trim().toLowerCase();
    if (id) out.add(id);
  }
  return out;
}

/**
 * 이 가족이 무제한 대상인지. secret 미설정이면 조회조차 하지 않고 false 를 돌려준다
 * (평상시 D1 왕복을 늘리지 않는다).
 *
 * 조회 실패는 false 로 닫는다 — 판정 오류로 한도를 열어 주면 원가가 새어 나간다.
 */
export async function isAiUnlimitedFamily(
  env: Pick<Env, "AI_UNLIMITED_OWNER_IDS">,
  db: D1Database,
  familyId: string,
): Promise<boolean> {
  const allowed = parseAiUnlimitedOwnerIds(env.AI_UNLIMITED_OWNER_IDS);
  if (allowed.size === 0) return false; // fail-closed
  const id = String(familyId ?? "").trim();
  if (!id) return false;
  try {
    const row = await db
      .prepare("SELECT parent_id FROM families WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ parent_id: string | null }>();
    const ownerId = String(row?.parent_id ?? "").trim().toLowerCase();
    return ownerId.length > 0 && allowed.has(ownerId);
  } catch {
    console.error("[ai-unlimited] owner lookup failed");
    return false;
  }
}
