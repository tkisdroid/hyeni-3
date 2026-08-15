import test from "node:test";
import assert from "node:assert/strict";

import {
  CHILD_ACCENTS,
  DEFAULT_ACCENT,
  childAccentKey,
  isAccentKey,
  readChildAccent,
  writeChildAccent,
} from "../src/transform/childAccent.ts";
import {
  ADVENTURE_SLOTS,
  buildAdventureMap,
  compactTime,
  hasJongseong,
  pickAdventureWindow,
  timeLabelToMinutes,
  type AdventureEventInput,
} from "../src/transform/adventureMap.ts";
import {
  STICKER_CATALOG,
  buildStickerBook,
  matchStickerSlot,
  readSeenStickers,
  stickerOriginText,
  stickerWhenLabel,
  writeSeenSticker,
} from "../src/transform/stickerBook.ts";
import {
  latestParentMemoText,
  remainingAiChats,
  resolveChildDestination,
  unreadParentMemoCount,
} from "../src/transform/childHomeData.ts";

function memStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

// ────────────────────────────── 내 색깔 ──────────────────────────────

test("색깔은 6종이고 tokens.css 의 data-accent 키와 같다", () => {
  assert.deepEqual(
    CHILD_ACCENTS.map((a) => a.key),
    ["rose", "peach", "lavender", "mint", "sky", "lemon"],
  );
  assert.equal(DEFAULT_ACCENT, "rose");
  for (const a of CHILD_ACCENTS) assert.ok(isAccentKey(a.key));
  for (const bad of ["red", "", null, 1, {}]) assert.equal(isAccentKey(bad), false);
});

test("색깔 저장 키는 가족+아이 단위 — 둘 중 하나 없으면 저장하지 않는다(오귀속 방지)", () => {
  assert.equal(childAccentKey("f1", "u1"), "hyeni-child-accent-v1:f1:u1");
  assert.equal(childAccentKey(null, "u1"), null);
  assert.equal(childAccentKey("f1", null), null);

  const s = memStorage();
  assert.equal(writeChildAccent(s, null, "u1", "mint"), false);
  assert.equal(s.map.size, 0);
});

test("색깔 저장/복원 — 다른 아이의 값과 섞이지 않는다", () => {
  const s = memStorage();
  assert.equal(writeChildAccent(s, "f1", "child-a", "mint"), true);
  assert.equal(writeChildAccent(s, "f1", "child-b", "sky"), true);
  assert.equal(readChildAccent(s, "f1", "child-a"), "mint");
  assert.equal(readChildAccent(s, "f1", "child-b"), "sky");
  assert.equal(readChildAccent(s, "f1", "child-c"), null);
});

test("저장된 값이 이상하면 무시한다(기본색으로 폴백)", () => {
  const s = memStorage();
  s.map.set("hyeni-child-accent-v1:f1:u1", "무지개");
  assert.equal(readChildAccent(s, "f1", "u1"), null);
});

// ────────────────────────────── 모험 지도 ──────────────────────────────

const ev = (
  id: string,
  title: string,
  time: string | null,
  isPast: boolean,
): AdventureEventInput => ({
  id,
  title,
  icon: `cat/${id}.webp`,
  startMinutes: timeLabelToMinutes(time),
  isPast,
});

test("시간 파싱과 짧은 시각 표기", () => {
  assert.equal(timeLabelToMinutes("16:00"), 960);
  assert.equal(timeLabelToMinutes("08:30"), 510);
  assert.equal(timeLabelToMinutes("24:00"), null);
  assert.equal(timeLabelToMinutes("보통"), null);
  assert.equal(timeLabelToMinutes(null), null);

  assert.match(compactTime(960, "ko"), /^(?:오후|PM) 4:00$/);
  assert.match(compactTime(510, "ko"), /^(?:오전|AM) 8:30$/);
  assert.match(compactTime(0, "ko"), /^(?:오전|AM) 12:00$/);
  assert.match(compactTime(720, "ko"), /^(?:오후|PM) 12:00$/);
  assert.equal(compactTime(null, "ko"), "");

  // 오전/오후가 없으면 아침 9시와 밤 9시가 구분되지 않는다(razr 실기기에서 23:40 → "11:40" 로 보였다).
  assert.notEqual(compactTime(9 * 60, "ko"), compactTime(21 * 60, "ko"));
  assert.match(compactTime(23 * 60 + 40, "ko"), /^(?:오후|PM) 11:40$/);
  assert.equal(compactTime(16 * 60, "en"), "4:00 PM");
  assert.doesNotMatch(compactTime(16 * 60, "ja"), /오전|오후/);
});

test("받침 판정으로 조사를 고른다", () => {
  assert.equal(hasJongseong("태권도"), false);
  assert.equal(hasJongseong("수영"), true);
  assert.equal(hasJongseong("학교"), false);
  assert.equal(hasJongseong("영어 방과후"), false); // '후' 받침 없음
  assert.equal(hasJongseong("미술관"), true);
  assert.equal(hasJongseong("Piano"), false);
  assert.equal(hasJongseong(""), false);
});

test("일정 4개 이하면 전부 배치하고 상태를 나눈다", () => {
  const events = [
    ev("a", "학교", "08:30", true),
    ev("b", "간식", "13:30", true),
    ev("c", "태권도", "16:00", false),
    ev("d", "가족 저녁", "19:00", false),
  ];
  const map = buildAdventureMap(events, 15 * 60 + 15, "ko"); // 15:15
  assert.equal(map.nodes.length, 4);
  assert.deepEqual(map.nodes.map((n) => n.state), ["done", "done", "next", "todo"]);
  assert.equal(map.nodes[0].pill, "학교 ✓");
  assert.match(map.nodes[2].pill, /^태권도 (?:오후|PM) 4:00$/);
  // 긴 제목은 pill 두 줄 안에서 시간을 밀어내지 않도록 8자까지만 쓴다(2026-07-30 실기기 제보).
  assert.match(map.nodes[3].pill, /^가족 저녁 (?:오후|PM) 7:00$/);
  assert.match(
    buildAdventureMap([ev("e", "방과후 코딩교실 심화반", "18:00", false)], 9 * 60, "ko").nodes[0].pill,
    /^방과후 코딩교실… (?:오후|PM) 6:00$/,
  );
  assert.equal(map.next?.id, "c");
  assert.equal(map.nodes[0].leftPct, ADVENTURE_SLOTS[0].leftPct);
  assert.equal(map.nodes[3].top, ADVENTURE_SLOTS[3].top);
});

test("말풍선은 반말이고 남은 시간을 실제로 계산한다", () => {
  const events = [ev("c", "태권도", "16:00", false)];
  assert.equal(buildAdventureMap(events, 15 * 60 + 15, "ko").bubble, "45분 후 태권도야!\n나랑 같이 가자 🎒");
  assert.equal(buildAdventureMap([ev("s", "수영", "16:00", false)], 15 * 60 + 15, "ko").bubble.startsWith("45분 후 수영이야!"), true);
  assert.match(
    buildAdventureMap([ev("e", "English", "16:00", false)], 15 * 60, "en").bubble,
    /^in 1 hour English/,
  );
  assert.equal(buildAdventureMap(events, 16 * 60, "ko").bubble, "지금 태권도 갈 시간이야! 🏃");
  assert.match(buildAdventureMap(events, 9 * 60, "ko").bubble, /^(?:오후|PM) 4:00에 태권도야!/);
  assert.equal(buildAdventureMap([], 9 * 60, "ko").bubble, "오늘 일정 다 끝났어! 푹 쉬어도 돼 🎈");
  assert.equal(buildAdventureMap([ev("x", "학교", null, false)], 9 * 60, "ko").bubble, "다음은 학교야! 나랑 같이 가자 🎒");
});

test("일정이 5개를 넘으면 다음 일정을 반드시 포함하는 4개 창을 고른다", () => {
  const events = [
    ev("1", "아침", "07:00", true),
    ev("2", "학교", "08:30", true),
    ev("3", "간식", "13:30", true),
    ev("4", "태권도", "16:00", false),
    ev("5", "저녁", "19:00", false),
    ev("6", "책읽기", "20:30", false),
  ];
  const picked = pickAdventureWindow(events);
  assert.equal(picked.length, 4);
  assert.ok(picked.some((e) => e.id === "4"), "다음 일정이 창에 있어야 한다");
  assert.deepEqual(picked.map((e) => e.id), ["2", "3", "4", "5"]);
});

test("전부 다녀온 날은 마지막 4개를 보여주고 next 는 없다", () => {
  const events = ["1", "2", "3", "4", "5"].map((id, i) => ev(id, `일정${id}`, `0${i + 7}:00`, true));
  const map = buildAdventureMap(events, 23 * 60, "ko");
  assert.equal(map.next, null);
  assert.deepEqual(map.nodes.map((n) => n.id), ["2", "3", "4", "5"]);
  assert.ok(map.nodes.every((n) => n.state === "done"));
});

// ────────────────────────────── 스티커북 ──────────────────────────────

test("도감은 12칸이고 시안 BOOK 과 키가 같다", () => {
  assert.equal(STICKER_CATALOG.length, 12);
  assert.deepEqual(
    STICKER_CATALOG.map((c) => c.key),
    ["best", "love", "brave", "friend", "study", "early", "play", "ready", "self", "sports", "cool", "rest"],
  );
});

test("받은 스티커를 도감 칸에 매칭한다(early/on_time 은 타입 우선)", () => {
  assert.equal(matchStickerSlot({ id: "1", title: "아무거나", sticker_type: "early", earned_at: "" }), "early");
  assert.equal(matchStickerSlot({ id: "2", title: "아무거나", sticker_type: "on_time", earned_at: "" }), "early");
  assert.equal(matchStickerSlot({ id: "3", title: "최고예요!", sticker_type: "praise", earned_at: "" }), "best");
  assert.equal(matchStickerSlot({ id: "4", title: "사랑해", sticker_type: "praise", earned_at: "" }), "love");
  assert.equal(matchStickerSlot({ id: "5", title: "듣도보도못한칭찬", sticker_type: "praise", earned_at: "" }), null);
});

test("도감 집계 — 개수·진행률·NEW 배지", () => {
  const now = Date.parse("2026-07-10T09:00:00Z");
  const day = 86_400_000;
  const received = [
    { id: "a", title: "최고", sticker_type: "praise", earned_at: new Date(now - 2 * day).toISOString() },
    { id: "b", title: "최고예요", sticker_type: "praise", earned_at: new Date(now - 1 * day).toISOString() },
    { id: "c", title: "사랑해요", sticker_type: "praise", earned_at: new Date(now - 30 * day).toISOString() },
  ];
  const view = buildStickerBook(received, now, new Set());
  assert.equal(view.total, 12);
  assert.equal(view.gotCount, 2);
  assert.equal(view.percent, 17);

  const best = view.slots.find((s) => s.key === "best");
  assert.equal(best?.count, 2);
  assert.equal(best?.latestId, "b", "가장 최근 것이 대표");
  assert.equal(best?.isNew, true);

  const love = view.slots.find((s) => s.key === "love");
  assert.equal(love?.got, true);
  assert.equal(love?.isNew, false, "30일 지난 스티커는 NEW 아님");

  assert.equal(view.newCount, 1);
  assert.equal(view.slots.find((s) => s.key === "cool")?.got, false);
});

test("한 번 열어본 스티커는 NEW 가 사라진다", () => {
  const now = Date.parse("2026-07-10T09:00:00Z");
  const received = [{ id: "a", title: "최고", sticker_type: "praise", earned_at: new Date(now - 3600_000).toISOString() }];
  assert.equal(buildStickerBook(received, now, new Set()).newCount, 1);
  assert.equal(buildStickerBook(received, now, new Set(["a"])).newCount, 0);
});

test("열어본 스티커는 아이별로 저장된다", () => {
  const s = memStorage();
  const seen = readSeenStickers(s, "child-1");
  assert.equal(seen.size, 0);
  const next = writeSeenSticker(s, "child-1", seen, "sticker-9");
  assert.ok(next.has("sticker-9"));
  assert.ok(readSeenStickers(s, "child-1").has("sticker-9"));
  assert.equal(readSeenStickers(s, "child-2").size, 0);
});

test("스티커 설명은 서버가 아는 사실만 말한다(보낸 사람·메시지 지어내기 금지)", () => {
  assert.equal(stickerOriginText("praise"), "부모님이 보내준 칭찬이야 💝");
  assert.equal(stickerOriginText("early"), "일찍 도착해서 받은 스티커야 ⏰");
  assert.equal(stickerOriginText("on_time"), "일찍 도착해서 받은 스티커야 ⏰");
  assert.equal(stickerOriginText(null), "칭찬으로 받은 스티커야 ✨");
});

test("받은 날짜는 아이 말투 상대 표현", () => {
  const now = new Date("2026-07-10T00:00:00.000Z").getTime();
  const dayAgo = (n: number) => now - n * 86_400_000;
  assert.equal(stickerWhenLabel(now - 3600_000, now, "ko", "Asia/Seoul"), "오늘 받았어");
  assert.equal(stickerWhenLabel(dayAgo(1), now, "ko", "Asia/Seoul"), "어제 받았어");
  assert.match(stickerWhenLabel(dayAgo(3), now, "ko", "Asia/Seoul"), /^3일 전에 받았어$/);
  assert.equal(stickerWhenLabel(dayAgo(3), now, "en", "Asia/Seoul"), "3 days ago에 받았어");
  assert.equal(stickerWhenLabel(dayAgo(9), now, "ko", "Asia/Seoul"), "지난주에 받았어");
  assert.equal(stickerWhenLabel(dayAgo(20), now, "ko", "Asia/Seoul"), "2주 전에 받았어");
  assert.equal(stickerWhenLabel(dayAgo(20), now, "en", "Asia/Seoul"), "2 weeks ago에 받았어");
  assert.equal(stickerWhenLabel(null, now, "ko", "Asia/Seoul"), "");
});

test("스티커 받은 날은 host 자정이 아니라 명시 time zone의 달력 날짜로 계산한다", () => {
  const now = new Date("2026-07-08T07:30:00.000Z").getTime();
  const earned = new Date("2026-07-08T06:30:00.000Z").getTime();

  assert.equal(stickerWhenLabel(earned, now, "ko", "America/Los_Angeles"), "어제 받았어");
});

// ────────────────────────────── 홈 데이터 ──────────────────────────────

test("AI 남은 횟수는 한도와 사용량을 둘 다 알 때만 계산한다(추측 금지)", () => {
  assert.equal(remainingAiChats(10, 3), 7);
  assert.equal(remainingAiChats(10, 12), 0);
  assert.equal(remainingAiChats(10, 0), 10);
  assert.equal(remainingAiChats(undefined, 3), null);
  assert.equal(remainingAiChats(10, undefined), null);
  assert.equal(remainingAiChats(0, 0), null);
});

test("길찾기 목적지 — 일정 좌표 우선, 없으면 저장장소 이름/주소 매칭", () => {
  const places = [
    { id: "p1", name: "씩씩 태권도장", location: { lat: 37.1, lng: 127.1, address: "동탄대로 683" } },
  ] as never;

  assert.deepEqual(
    resolveChildDestination({ title: "태권도", location: { lat: 37.5, lng: 127.5 } }, places),
    { name: "태권도", point: { lat: 37.5, lng: 127.5 } },
  );
  assert.deepEqual(
    resolveChildDestination({ title: "태권도", location: { address: "동탄대로 683" } }, places),
    { name: "씩씩 태권도장", point: { lat: 37.1, lng: 127.1 } },
  );
  assert.equal(resolveChildDestination({ title: "태권도", location: { address: "모르는 곳" } }, places), null);
  assert.equal(resolveChildDestination({ title: "태권도" }, places), null);
  assert.equal(resolveChildDestination(null, places), null);
});

test("안읽은 부모 메시지 수 — read_by 에 내 id 가 없을 때만", () => {
  const replies = [
    { user_role: "parent", content: "안녕", read_by: [] },
    { user_role: "parent", content: "밥 먹었어?", read_by: ["me"] },
    { user_role: "child", content: "응", read_by: [] },
    { user_role: "parent", content: "잘했어", read_by: ["other"] },
  ];
  assert.equal(unreadParentMemoCount(replies, "me"), 2);
  assert.equal(unreadParentMemoCount(replies, null), 0);
  assert.equal(unreadParentMemoCount([], "me"), 0);
});

test("부모 최신 메시지 미리보기 — 마커는 사람 말로 바꾸고 길면 줄인다", () => {
  assert.equal(latestParentMemoText([{ user_role: "parent", content: "오늘도 잘 다녀와 💗" }]), "오늘도 잘 다녀와 💗");
  assert.equal(latestParentMemoText([{ user_role: "parent", content: "[[img:abc]]" }]), "사진을 보냈어");
  assert.equal(latestParentMemoText([{ user_role: "parent", content: "[[loc:1,2|집]]" }]), "위치를 보냈어");
  assert.equal(
    latestParentMemoText([{ user_role: "parent", content: "가나다라마바사아자차카타파하가나다라마바사" }], 10),
    "가나다라마바사아자차…",
  );
  assert.equal(latestParentMemoText([{ user_role: "child", content: "안녕" }]), null);
  assert.equal(latestParentMemoText([]), null);
  assert.equal(
    latestParentMemoText([
      { user_role: "parent", content: "먼저" },
      { user_role: "parent", content: "나중" },
    ]),
    "나중",
    "가장 최근 것",
  );
});
