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

test("AI 일정은 아이 판별·기존 일정 수정을 약속하지 않고 활성 아이 저장 대상을 밝힌다", () => {
  assert.doesNotMatch(source, /지우 태권도/);
  assert.doesNotMatch(source, /날짜·시간·아이/);
  assert.doesNotMatch(source, /아이를 알아서 정리/);
  assert.doesNotMatch(source, /바꿔줘/);
  assert.match(source, /activeChild\.name/);
  assert.match(source, /에게 저장돼요/);
});

test("AI 일정 다건 결과는 모든 후보의 제목·날짜·시간을 각각 보여준다", () => {
  assert.match(source, /drafts\.map\(\(draft\) =>/);
  assert.match(source, /draft\.title/);
  assert.match(source, /draft\.dateLabel/);
  assert.match(source, /draft\.timeLabel/);
});

test("AI 일정 저장 재시도는 확인 시점에 새 UUID를 만들지 않는다", () => {
  const confirmStart = source.indexOf("const handleConfirm");
  const renderStart = source.indexOf("  return (", confirmStart);
  assert.ok(confirmStart >= 0 && renderStart > confirmStart);
  const confirmSource = source.slice(confirmStart, renderStart);

  assert.match(confirmSource, /buildAiScheduleSaveInputs\(drafts/);
  assert.doesNotMatch(confirmSource, /crypto\.randomUUID/);
});
