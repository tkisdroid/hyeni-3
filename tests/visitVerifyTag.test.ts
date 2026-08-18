/**
 * 지난 일정의 "다녀옴" 표시 계약(2026-08-18 TK 제보).
 * 장소를 지정하지 않은 일정까지 다녀온 것처럼 표시하던 문제를 막는다 —
 * 위치로 확인된 일정만 "다녀옴"이고 나머지는 "확인 필요"다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eventToView } from "../src/transform/scheduleView.ts";
import { verifyVisits } from "../src/transform/visitVerify.ts";
import type { CalendarEvent } from "../src/lib/api/endpoints/schedule.ts";

const TIME_ZONE = "Asia/Seoul";
// 2026-08-18 09:00 KST 에 끝난 일정을 12:00 KST 에 본다(date_key 는 0-index 월).
const NOW = new Date("2026-08-18T03:00:00.000Z");

function pastEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    family_id: "family-1",
    title: "학원",
    date_key: "2026-7-18",
    time: "08:00",
    end_time: "09:00",
    category: "study",
    emoji: null,
    location: null,
    is_family_event: 1,
    ...overrides,
  } as CalendarEvent;
}

const tagOf = (event: CalendarEvent, visitMap?: ReadonlyMap<string, "visited" | "unverified">) =>
  eventToView(event, NOW, "ko", TIME_ZONE, visitMap).tag;

test("장소를 지정하지 않은 지난 일정은 다녀온 것으로 단정하지 않는다", () => {
  const event = pastEvent();
  // 방문 검증을 하는 화면(부모 캘린더·홈)은 빈 판정 맵을 넘긴다.
  assert.equal(tagOf(event, new Map()), "확인 필요");
  // 위치 검증 자체는 좌표 없는 일정을 판정 대상에서 빼는 기존 동작을 유지한다.
  assert.equal(verifyVisits([event], [], null).has(event.id), false);
});

test("위치로 확인된 일정만 다녀옴으로 표시한다", () => {
  const event = pastEvent({ location: { address: "학원", lat: 37.5, lng: 127.0 } });
  assert.equal(tagOf(event, new Map([[event.id, "visited"]])), "다녀옴");
  assert.equal(tagOf(event, new Map([[event.id, "unverified"]])), "확인 필요");
});

test("주소만 있고 좌표가 없는 일정도 확인 필요로 남긴다", () => {
  const event = pastEvent({ location: { address: "학교 앞", lat: null, lng: null } });
  const verdicts = verifyVisits([event], [], null);
  assert.equal(verdicts.get(event.id), "unverified");
  assert.equal(tagOf(event, verdicts), "확인 필요");
});

test("방문 검증을 하지 않는 화면(아이 홈·리포트)은 기존 시간 기반 표시를 유지한다", () => {
  assert.equal(tagOf(pastEvent()), "다녀옴");
});

test("아직 끝나지 않은 일정은 진행 중·예정 그대로다", () => {
  const ongoing = pastEvent({ time: "11:30", end_time: "13:00" });
  const upcoming = pastEvent({ time: "18:00", end_time: "19:00" });
  assert.equal(tagOf(ongoing, new Map()), "진행 중");
  assert.equal(tagOf(upcoming, new Map()), "예정");
});
