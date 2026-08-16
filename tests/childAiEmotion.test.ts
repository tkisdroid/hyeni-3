import assert from "node:assert/strict";
import test from "node:test";
import {
  childAiEmotionAsset,
  inferChildAiEmotion,
  isChildAiEmotion,
  parseChildAiEmotion,
  readStoredChildAiEmotion,
  writeStoredChildAiEmotion,
} from "../src/transform/childAiEmotion.ts";

test("표정 에셋은 3D mascot-status 만 쓴다", () => {
  assert.equal(isChildAiEmotion("happy"), true);
  assert.equal(isChildAiEmotion("angry"), false);
  assert.equal(childAiEmotionAsset("celebrate"), "mascot-status/status-celebrate.webp");
  assert.equal(parseChildAiEmotion("nope", "idle"), "idle");
});

test("일정 추가·준비물 추가 성공은 축하 표정이다", () => {
  assert.equal(inferChildAiEmotion({ toolName: "createSchedule" }), "celebrate");
  assert.equal(inferChildAiEmotion({ intent: "daily_item_create" }), "celebrate");
});

test("일정 삭제는 아이에게 허용하지 않으므로 생각 표정이다", () => {
  assert.equal(inferChildAiEmotion({ intent: "schedule_delete_parent_only" }), "pondering");
});

test("표정은 가족+아이 키에만 저장한다", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  writeStoredChildAiEmotion(storage, "fam", "child", "love");
  assert.equal(readStoredChildAiEmotion(storage, "fam", "child"), "love");
  assert.equal(readStoredChildAiEmotion(storage, "fam", "other"), "idle");
});




