import test from "node:test";
import assert from "node:assert/strict";

import { resolveEventCharacter, DEFAULT_EVENT_CHARACTER } from "../src/transform/eventCharacter.ts";
import { resolvePlaceVisual } from "../src/transform/placeVisual.ts";

test("일정 아이콘은 장소관리와 같은 키워드 출처를 쓴다(태권도=도복 통일)", () => {
  // TK 제보: 장소관리는 도복인데 일정은 축구공 — 같은 제목이면 같은 에셋이어야 한다.
  assert.equal(
    resolveEventCharacter("태권도 시범단"),
    resolvePlaceVisual({ name: "태권도 학원" }).assetPath,
  );
  assert.equal(resolveEventCharacter("태권도 시범단"), "cat/taekwondo.webp");
  assert.equal(resolveEventCharacter("피아노 레슨"), "cat/piano.webp");
  assert.equal(resolveEventCharacter("생존수영"), "cat/swim.webp");
  assert.equal(resolveEventCharacter("영어 학원"), "cat/study.webp");
  assert.equal(resolveEventCharacter("학교 등교"), "cat/school.webp");
});

test("생활 장소 키워드도 일정 아이콘으로 해석된다(신규 place 에셋)", () => {
  assert.equal(resolveEventCharacter("성당 미사"), "place/church.webp");
  assert.equal(resolveEventCharacter("이마트 장보기"), "place/mart.webp");
  assert.equal(resolveEventCharacter("공원 산책"), "place/park.webp");
  assert.equal(resolveEventCharacter("소아과 진료"), "place/hospital.webp");
  assert.equal(resolveEventCharacter("도서관 숙제"), "place/library.webp");
});

test("키워드 미매칭 시 카테고리 폴백, 그래도 없으면 기본 캐릭터", () => {
  assert.equal(resolveEventCharacter("발표회", "sports"), "cat/sports.webp");
  assert.equal(resolveEventCharacter("발표회", "school"), "cat/school.webp");
  assert.equal(resolveEventCharacter(""), DEFAULT_EVENT_CHARACTER);
  assert.equal(resolveEventCharacter(null), DEFAULT_EVENT_CHARACTER);
});
