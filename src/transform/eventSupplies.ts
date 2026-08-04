/**
 * 일정 등록 준비물 → 가방 챙기기(daily_supplies) 병합 규칙 (순수 함수).
 *
 * EventForm 에서 입력한 준비물을 배정된 아이의 그 날짜 prep 리스트에 합친다.
 * - 라벨은 쉼표/줄바꿈/가운뎃점으로 나누고, 공백 정리·중복 제거·20자 절단.
 * - 이미 있는 항목(공백·대소문자 무시 동일 라벨)은 다시 추가하지 않는다(재저장 멱등).
 * - 하루 8개(서버 인코딩 계약)를 넘는 항목은 조용히 버리지 않고 dropped 로 집계해
 *   화면이 정직하게 안내한다.
 */
import type { SupplyItem } from "../lib/api/endpoints/schedule.ts";

// 서버 daily_supplies 인코딩 계약(endpoints/schedule.ts encodeSupplyItems)과 공유하는
// 단일 출처 상수 — 순수 모듈에 두어 node 테스트가 endpoints 체인 없이 import 한다.
export const MAX_SUPPLY_ITEMS_PER_KIND = 8;
export const MAX_SUPPLY_LABEL_LEN = 20;
export const DAILY_SUPPLY_LIMIT_ERROR = "daily_supply_limit_exceeded";

export function dailySupplyLimitMessage(kind: "prep" | "hw", isChild: boolean): string {
  const subject = kind === "hw" ? "숙제는" : "준비물은";
  return `${subject} 하루 ${MAX_SUPPLY_ITEMS_PER_KIND}개까지 등록할 수 있어${isChild ? "" : "요"}`;
}

export function isDailySupplyLimitError(error: unknown): boolean {
  return error instanceof Error && error.message === DAILY_SUPPLY_LIMIT_ERROR;
}

/** 자유 입력("실내화, 물통") → 정리된 라벨 배열. */
export function parseSupplyLabelInput(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(input ?? "").split(/[,\n、·]/)) {
    const label = part.replace(/\s+/g, " ").trim().slice(0, MAX_SUPPLY_LABEL_LEN);
    const key = normalizeSupplyLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function normalizeSupplyLabel(label: string): string {
  return String(label ?? "").replace(/\s+/g, "").toLowerCase();
}

export interface MergeSupplyLabelsResult {
  items: SupplyItem[];
  added: number;
  /** 하루 항목 상한(8개)에 걸려 담지 못한 라벨 수 — 조용한 유실 금지, 화면이 안내한다. */
  dropped: number;
}

/** 기존 prep 리스트에 새 라벨을 병합한다. 기존 항목은 절대 변형하지 않는다(불변). */
export function mergeSupplyLabels(
  existing: readonly SupplyItem[],
  labels: readonly string[],
  makeId: () => string,
): MergeSupplyLabelsResult {
  const seen = new Set(existing.map((it) => normalizeSupplyLabel(it.label)));
  const items = [...existing];
  let added = 0;
  let dropped = 0;
  for (const raw of labels) {
    const label = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SUPPLY_LABEL_LEN);
    const key = normalizeSupplyLabel(label);
    if (!key || seen.has(key)) continue;
    if (items.length >= MAX_SUPPLY_ITEMS_PER_KIND) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    items.push({ id: makeId(), label, done: false });
    added += 1;
  }
  return { items, added, dropped };
}
