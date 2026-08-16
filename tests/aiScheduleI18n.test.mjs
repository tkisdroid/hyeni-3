import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

test("AI 일정은 사용자 입력과 AI 원문을 그대로 검토한 뒤에만 저장한다", () => {
  const source = read("src/screens/feature/AiSchedule.tsx");

  assert.match(source, /const result = await parseM\.mutateAsync/);
  assert.match(source, /buildAiScheduleDrafts\(result\.events/);
  assert.match(source, /setText\(transcript\)/);
  assert.match(source, /await runParse\(transcript\)/);
  assert.match(source, /\{draft\.title\}/);
  assert.match(source, /if \(!drafts \|\| drafts\.length === 0\) return/);
  assert.match(source, /await createM\.mutateAsync\(buildAiScheduleSaveInputs\(drafts, familyId, activeChild\.id\)\)/);
  assert.doesNotMatch(source, /intl\.formatMessage\([^)]*draft\.title/);
});

test("AI 일정은 빈·실패 응답을 초안이나 저장 성공으로 꾸미지 않는다", () => {
  const source = read("src/screens/feature/AiSchedule.tsx");
  const emptyStart = source.indexOf("if (result.events.length === 0)");
  const prepareStart = source.indexOf("const prepared = buildAiScheduleDrafts", emptyStart);
  const errorStart = source.indexOf("if (prepared.error)", prepareStart);
  const setDraftsStart = source.indexOf("setDrafts(prepared.drafts)", errorStart);

  assert.ok(emptyStart >= 0 && prepareStart > emptyStart && errorStart > prepareStart && setDraftsStart > errorStart);
  assert.match(source.slice(emptyStart, prepareStart), /setDrafts\(null\)[\s\S]*return/);
  assert.match(source.slice(errorStart, setDraftsStart), /setDrafts\(null\)[\s\S]*return/);
  assert.match(source, /catch \(e\) \{\s*setDrafts\(null\)/);
  assert.doesNotMatch(source, /result\.events\.length === 0[\s\S]{0,200}setDrafts\(\[/);
});

test("AI 일정은 member id·date_key·준비물 상한과 크레딧 게이트를 유지한다", () => {
  const source = read("src/screens/feature/AiSchedule.tsx");
  const draft = read("src/transform/aiScheduleDraft.ts");

  assert.match(source, /activeChild\.id/);
  assert.match(draft, /dateKey: dateToDateKey\(event\.date\)/);
  assert.match(draft, /childIds: \[childMemberId\]/);
  assert.match(source, /MAX_SUPPLY_ITEMS_PER_KIND/);
  assert.match(source, /e instanceof ApiError && e\.status === 429 && e\.code === "daily_limit_reached"/);
  assert.match(source, /source="ai_schedule_limit"/);
  assert.match(source, /useSaveEventsWithChildrenBatch\(\)/);
});

test("AI 일정 생성 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const en = JSON.parse(read("locales/en/parent.json"));
  const ids = Object.keys(en).filter((id) => id.startsWith("parent.aiSchedule."));
  assert.ok(ids.length >= 55, `메시지 수 부족: ${ids.length}`);
  for (const locale of locales) {
    const messages = JSON.parse(read(`locales/${locale}/parent.json`));
    for (const id of ids) {
      assert.equal(typeof messages[id], "string", `${locale}:${id}: 누락`);
      assert.ok(messages[id].trim().length > 0, `${locale}:${id}: 빈 번역`);
      if (!["ko", "en"].includes(locale)) {
        assert.notEqual(messages[id], en[id], `${locale}:${id}: 영어 폴백`);
      }
    }
  }
  assert.match(en["parent.aiSchedule.invalidTitle"], /\{title\}/);
  assert.match(en["parent.aiSchedule.savedMany"], /\{count\}/);
  assert.match(en["parent.aiSchedule.assignedChild"], /\{count\}[\s\S]*\{childName\}/);
  assert.match(en["parent.aiSchedule.supplyLimit"], /\{limit\}/);
});
