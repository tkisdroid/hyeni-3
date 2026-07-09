import test from "node:test";
import assert from "node:assert/strict";

import { resolveEventCharacter, DEFAULT_EVENT_CHARACTER } from "../src/transform/eventCharacter.ts";

test("일정 제목이 3D 캐릭터 에셋으로 매핑된다", () => {
  assert.equal(resolveEventCharacter("태권도 시범단"), "cat/taekwondo.webp");
  assert.equal(resolveEventCharacter("피아노 레슨"), "cat/piano.webp");
  assert.equal(resolveEventCharacter("생존수영"), "cat/swim.webp");
  assert.equal(resolveEventCharacter("영어 학원"), "cat/study.webp");
  assert.equal(resolveEventCharacter("학교 등교"), "cat/school.webp");
  assert.equal(resolveEventCharacter("발레 수업"), "cat/hobby.webp");
});

test("모르는 제목·빈 제목은 기본 캐릭터로 떨어진다", () => {
  assert.equal(resolveEventCharacter("성당"), DEFAULT_EVENT_CHARACTER);
  assert.equal(resolveEventCharacter(""), DEFAULT_EVENT_CHARACTER);
  assert.equal(resolveEventCharacter(null), DEFAULT_EVENT_CHARACTER);
});
