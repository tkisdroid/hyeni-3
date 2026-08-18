/**
 * 아이 기기의 "사용 정보 접근"을 다시 물어볼지 정하는 순수 판정(2026-08-18 TK 지시).
 *
 * 부모는 아이 기기 정보를 보려고 아이 폰을 직접 만질 수 없다. 그래서 처음 설정에서 함께 받고,
 * 그 뒤에도 꺼져 있으면 아이 기기가 스스로 가끔 다시 물어본다 — 단, 매번 묻지 않는다.
 * 저장 키는 가족+아이 단위라 기기를 함께 쓰는 형제끼리 서로의 물음 주기를 지우지 않는다.
 */
export const USAGE_ACCESS_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageAccessPromptInput {
  /** Capacitor 네이티브 앱인지(웹에는 이 권한 개념이 없다). */
  native: boolean;
  /** 이 기기에서 상태를 확인할 수 있는지(플러그인 응답). */
  supported: boolean;
  /** 이미 켜져 있는지. */
  granted: boolean;
  /** 마지막으로 물어본 시각(ms). 물어본 적 없으면 null. */
  lastPromptedAtMs: number | null;
  nowMs: number;
}

export function shouldPromptUsageAccess(input: UsageAccessPromptInput): boolean {
  if (!input.native || !input.supported || input.granted) return false;
  if (input.lastPromptedAtMs === null) return true;
  if (!Number.isFinite(input.lastPromptedAtMs)) return true;
  // 기기 시계가 뒤로 간 경우(미래 값)도 다시 물어볼 때가 된 것으로 본다.
  if (input.lastPromptedAtMs > input.nowMs) return true;
  return input.nowMs - input.lastPromptedAtMs >= USAGE_ACCESS_PROMPT_INTERVAL_MS;
}

export function usageAccessPromptStorageKey(
  familyId: string | null | undefined,
  childUserId: string | null | undefined,
): string {
  return `hyeni-usage-access-prompt-v1:${familyId ?? "no-family"}:${childUserId ?? "no-child"}`;
}

export function readUsageAccessPromptedAt(
  storage: Pick<Storage, "getItem">,
  key: string,
): number | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeUsageAccessPromptedAt(
  storage: Pick<Storage, "setItem">,
  key: string,
  nowMs: number,
): void {
  try {
    storage.setItem(key, String(nowMs));
  } catch {
    // 저장할 수 없어도 이번 물음은 그대로 진행한다(다음 실행에 다시 물을 뿐이다).
  }
}
