import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/AiSchedule.tsx"), "utf8");

test("AI 일정 사진 탭은 크레딧과 서버 전송 사실을 짧게 안내한다", () => {
  assert.match(source, /크레딧이 사용될 수 있어요/);
  assert.match(source, /사진은 일정 후보를 찾기 위해 서버로 전송돼요/);
});

test("AI 일정 실패와 저장 한도 문구는 다음 행동을 안내한다", () => {
  assert.match(source, /날짜와 시간이 잘 보이게 다시 찍어 주세요/);
  assert.match(source, /날짜와 시간을 조금 더 자세히 적어 주세요/);
  assert.match(source, /리뷰 혜택을 받으면 3개, 프리미엄에서는 무제한/);
});

test("AI 일정 결과는 저장 후 캘린더 수정 가능성을 안내한다", () => {
  assert.match(source, /추가한 뒤 캘린더에서 수정할 수 있어요/);
});
