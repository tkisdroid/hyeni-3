import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemberDisplayName } from "../lib/profileInput.ts";

test("구성원 이름은 일반 한글·공백·따옴표를 보존한다", () => {
  assert.equal(normalizeMemberDisplayName("  혜니 김  "), "혜니 김");
  assert.equal(normalizeMemberDisplayName("O'Connor"), "O'Connor");
  assert.equal(normalizeMemberDisplayName('혜니 "별"'), '혜니 "별"');
});

test("구성원 이름은 빈 값·제어문자·과도한 길이를 거부한다", () => {
  assert.equal(normalizeMemberDisplayName("   "), null);
  assert.equal(normalizeMemberDisplayName("혜니\n관리자"), null);
  assert.equal(normalizeMemberDisplayName("가".repeat(41)), null);
  assert.equal(normalizeMemberDisplayName("가".repeat(40)), "가".repeat(40));
});

test("HTML처럼 보이는 이름도 문자열 값으로만 정규화한다", () => {
  assert.equal(
    normalizeMemberDisplayName('x" onload="alert(1)'),
    'x" onload="alert(1)',
  );
});
