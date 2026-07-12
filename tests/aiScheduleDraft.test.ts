import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAiScheduleDrafts,
  buildAiScheduleSaveInputs,
} from "../src/transform/aiScheduleDraft.ts";

const currentDate = { year: 2026, month: 6, day: 13 };

test("AI 일정 후보는 파싱된 모든 일정의 제목·날짜·시간을 확인 가능한 값으로 만든다", () => {
  let nextId = 0;
  const result = buildAiScheduleDrafts(
    [
      { title: "태권도", year: 2026, month: 6, day: 14, time: "16:00", category: "sports" },
      { title: "미술학원", year: 2026, month: 6, day: 16, time: null, category: "hobby" },
    ],
    currentDate,
    () => `draft-${++nextId}`,
  );

  assert.equal(result.error, null);
  assert.deepEqual(
    result.drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      dateKey: draft.dateKey,
      dateLabel: draft.dateLabel,
      time: draft.time,
      timeLabel: draft.timeLabel,
    })),
    [
      {
        id: "draft-1",
        title: "태권도",
        dateKey: "2026-6-14",
        dateLabel: "7/14 (화)",
        time: "16:00",
        timeLabel: "16:00",
      },
      {
        id: "draft-2",
        title: "미술학원",
        dateKey: "2026-6-16",
        dateLabel: "7/16 (목)",
        time: null,
        timeLabel: "시간 미정",
      },
    ],
  );
});

test("AI 일정 후보는 존재하지 않는 날짜를 다른 날짜로 자동 보정하지 않는다", () => {
  const result = buildAiScheduleDrafts(
    [{ title: "잘못된 날짜", year: 2026, month: 1, day: 30, time: "10:00" }],
    currentDate,
    () => "draft-invalid-date",
  );

  assert.deepEqual(result.drafts, []);
  assert.equal(result.error?.code, "invalid_date");
  assert.equal(result.error?.title, "잘못된 날짜");
});

test("AI 일정 후보는 25:00처럼 범위를 벗어난 시간을 저장값으로 허용하지 않는다", () => {
  const result = buildAiScheduleDrafts(
    [{ title: "잘못된 시간", year: 2026, month: 6, day: 14, time: "25:00" }],
    currentDate,
    () => "draft-invalid-time",
  );

  assert.deepEqual(result.drafts, []);
  assert.equal(result.error?.code, "invalid_time");
  assert.equal(result.error?.title, "잘못된 시간");
});

test("같은 AI 일정 후보를 재시도하면 최초 후보 UUID와 활성 아이 배정을 그대로 사용한다", () => {
  let idFactoryCalls = 0;
  const result = buildAiScheduleDrafts(
    [
      { title: "태권도", year: 2026, month: 6, day: 14, time: "16:00", category: "sports" },
      { title: "미술학원", year: 2026, month: 6, day: 16, time: "9:05", category: "hobby" },
    ],
    currentDate,
    () => `stable-${++idFactoryCalls}`,
  );
  assert.equal(result.error, null);

  const firstAttempt = buildAiScheduleSaveInputs(result.drafts, "family-1", "child-member-1");
  const retryAttempt = buildAiScheduleSaveInputs(result.drafts, "family-1", "child-member-1");

  assert.equal(idFactoryCalls, 2);
  assert.deepEqual(
    firstAttempt.map((input) => input.event.id),
    ["stable-1", "stable-2"],
  );
  assert.deepEqual(
    retryAttempt.map((input) => input.event.id),
    ["stable-1", "stable-2"],
  );
  assert.deepEqual(retryAttempt.map((input) => input.childIds), [
    ["child-member-1"],
    ["child-member-1"],
  ]);
  assert.deepEqual(retryAttempt.map((input) => input.event.time), ["16:00", "09:05"]);
  assert.ok(retryAttempt.every((input) => input.familyAll === false));
});

test("AI 일정 후보는 비어 있거나 문자열이 아닌 제목을 저장하지 않는다", () => {
  const blank = buildAiScheduleDrafts(
    [{ title: "   ", year: 2026, month: 6, day: 14, time: "10:00" }],
    currentDate,
    () => "unused",
  );
  const nonString = buildAiScheduleDrafts(
    [{ title: 42, year: 2026, month: 6, day: 14, time: "10:00" } as never],
    currentDate,
    () => "unused",
  );

  assert.equal(blank.error?.code, "invalid_title");
  assert.equal(nonString.error?.code, "invalid_title");
  assert.deepEqual(blank.drafts, []);
  assert.deepEqual(nonString.drafts, []);
});

test("AI 일정 후보의 알 수 없는 분류와 비문자 메모는 안전한 값으로 정규화한다", () => {
  const result = buildAiScheduleDrafts(
    [{
      title: "도서관",
      year: 2026,
      month: 6,
      day: 14,
      time: "10:00",
      category: "unknown-category",
      memo: { unsafe: true },
    } as never],
    currentDate,
    () => "safe-draft",
  );

  assert.equal(result.error, null);
  assert.equal(result.drafts[0]?.category, "other");
  assert.equal(result.drafts[0]?.memo, "");
});
