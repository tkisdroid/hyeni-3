// 일정 등록 준비물 → 가방 챙기기(daily_supplies) 연동 회귀 (2026-07-16 TK 요청:
// "아이 스케줄 등록 시 준비물을 입력하면 부모 메인·아이 메인에 실시간 반영").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mergeSupplyLabels, parseSupplyLabelInput } from "../src/transform/eventSupplies.ts";
import type { SupplyItem } from "../src/lib/api/endpoints/schedule.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

let seq = 0;
const makeId = () => `id-${(seq += 1)}`;

test("자유 입력은 쉼표·줄바꿈·가운뎃점으로 나누고 공백 정리·중복 제거·20자 절단한다", () => {
  assert.deepEqual(parseSupplyLabelInput(" 실내화 , 물통\n물통 · 색연필 "), ["실내화", "물통", "색연필"]);
  assert.deepEqual(parseSupplyLabelInput("  ,  ,"), []);
  const long = parseSupplyLabelInput("가나다라마바사아자차카타파하가나다라마바사아자차");
  assert.equal(long[0].length, 20);
});

test("병합은 기존 항목(공백·대소문자 무시)을 중복 추가하지 않는다 — 재저장 멱등", () => {
  const existing: SupplyItem[] = [{ id: "a", label: "실내 화", done: true }];
  const { items, added } = mergeSupplyLabels(existing, ["실내화", "물통"], makeId);
  assert.equal(added, 1);
  assert.equal(items.length, 2);
  assert.equal(items[1].label, "물통");
  assert.equal(items[1].done, false);
  assert.equal(items[0], existing[0], "기존 항목 객체는 변형하지 않는다");
});

test("하루 8개 상한을 넘는 라벨은 조용히 버리지 않고 dropped 로 집계한다", () => {
  const existing: SupplyItem[] = Array.from({ length: 7 }, (_, i) => ({
    id: `e${i}`, label: `기존${i}`, done: false,
  }));
  const { items, added, dropped } = mergeSupplyLabels(existing, ["새거1", "새거2", "새거3"], makeId);
  assert.equal(items.length, 8);
  assert.equal(added, 1);
  assert.equal(dropped, 2);
});

test("EventForm 은 저장 시 배정 아이·occurrence 날짜 전체에 준비물을 담는다(폴백 금지)", () => {
  const form = read("src/screens/parent/EventForm.tsx");
  // 대상 아이 = 명시 배정(childIds) 또는 명시적 가족 공유(모든 아이) — children[0] 폴백 없음.
  assert.match(form, /familyAll \? children\.map\(\(c\) => c\.id\) : childIds/);
  // 반복 일정은 occurrence 날짜(keys) 전체에 담는다.
  assert.match(form, /applyEventSupplies\(keys\)/);
  // 수정 모드는 시리즈 편집 대상 날짜들에 담는다.
  assert.match(form, /applyEventSupplies\(\s*targets\.map\(\(target\) => \(target\.id === editing\.id \? dateKey : target\.date_key\)\)/);
  // 준비물 실패가 일정 저장을 되돌리지 않고, 정직한 문구로 안내한다.
  assert.match(form, /준비물 일부는 저장하지 못했어요/);
  assert.match(form, /준비물은 하루 8개까지만 담았어요/);
});

test("useAddEventSupplies 는 (아이,날짜) 행 단위로 병합 재작성하고 dailySupplies 캐시를 무효화한다", () => {
  const hook = read("src/queries/useSchedule.ts");
  assert.match(hook, /export function useAddEventSupplies/);
  assert.match(hook, /rebuildChildDay\(familyId, pair\.childId, pair\.dateKey/);
  assert.match(hook, /mergeSupplyLabels\(lists\.prep, labels, newSupplyItemId\)/);
  assert.match(hook, /invalidateQueries\(\{ queryKey: \["dailySupplies", familyId \?\? ""\] \}\)/);
});

test("daily_supplies 는 실시간 브릿지에 연결돼 다른 기기 홈에도 즉시 반영된다", () => {
  const rt = read("src/queries/useFamilyRealtime.ts");
  assert.match(rt, /case "daily_supplies":/);
  assert.match(rt, /\[\["dailySupplies", familyId\]\]/);
});
