import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

const ONBOARDING_IDS = [
  "study.access.loading",
  "study.common.back",
  "study.common.no",
  "study.common.yes",
  "study.country.confirm",
  "study.country.confirmed",
  "study.country.confirming",
  "study.country.description",
  "study.country.inputHelp",
  "study.country.inputLabel",
  "study.country.title",
  "study.country.unknown",
  "study.unavailable.back",
  "study.unavailable.retry",
  "study.unavailable.title",
];

const PARENT_IDS = [
  "study.parent.childFallback",
  "study.parent.chooseChild",
  "study.parent.currentChild",
  "study.parent.editBirthdate",
  "study.parent.grade.birthSource",
  "study.parent.grade.changed",
  "study.parent.grade.error",
  "study.parent.grade.guardianSource",
  "study.parent.grade.nextMission",
  "study.parent.grade.option",
  "study.parent.grade.reset",
  "study.parent.grade.save",
  "study.parent.grade.saving",
  "study.parent.grade.select",
  "study.parent.grade.title",
  "study.parent.grade.unavailable",
  "study.parent.grade.versionUnavailable",
  "study.parent.invalidChild",
  "study.parent.loadingFamily",
  "study.parent.loadingReport",
  "study.parent.range",
  "study.parent.range30d",
  "study.parent.range7d",
  "study.parent.rangeTerm",
  "study.parent.report.empty",
  "study.parent.report.masteryLabel",
  "study.parent.report.noSessions",
  "study.parent.report.problemCount",
  "study.parent.report.recent",
  "study.parent.report.title",
  "study.parent.reportError",
  "study.parent.subtitle",
  "study.parent.summary.accuracy",
  "study.parent.summary.completed",
  "study.parent.summary.lastStudied",
  "study.parent.summary.noHistory",
  "study.parent.summary.reviewDue",
  "study.parent.summary.title",
  "study.parent.summary.today",
  "study.parent.title",
];

const ANSWER_KINDS = [
  "single_choice", "multiple_choice", "integer_input", "decimal_input", "fraction_input",
  "measurement_input", "ordering", "coordinate_input", "true_false", "text_input", "self_check",
];

const CHILD_IDS = [
  ...ANSWER_KINDS.map((kind) => `study.answer.${kind}.label`),
  "study.answer.denominator", "study.answer.false", "study.answer.moveDown", "study.answer.moveUp",
  "study.answer.numerator", "study.answer.selected", "study.answer.submit", "study.answer.submitting",
  "study.answer.true", "study.answer.unit",
  "study.child.askGuardian", "study.child.complete.home", "study.child.complete.saved",
  "study.child.complete.summary", "study.child.complete.title", "study.child.error.content",
  "study.child.error.session", "study.child.gradeHelp", "study.child.gradeLabel",
  "study.child.home.subtitle", "study.child.home.title", "study.child.loadError", "study.child.loading",
  "study.child.loadingMission", "study.child.missionError", "study.child.progress",
  "study.child.progressLabel", "study.child.retry.sameAnswer", "study.child.start.button",
  "study.child.start.description", "study.child.start.error", "study.child.start.starting",
  "study.child.start.title", "study.child.subtitle", "study.child.title",
  "study.problem.objective", "study.problem.unsupportedVisual", "study.problem.visualDescription",
  "study.result.answer", "study.result.correct", "study.result.hint", "study.result.next",
  "study.result.retryAnswer", "study.result.selfCheck", "study.result.tryAgain",
];

const BY_NAMESPACE = { onboarding: ONBOARDING_IDS, parent: PARENT_IDS, child: CHILD_IDS };

async function json(path) {
  return JSON.parse(await readFile(new URL(path, ROOT), "utf8"));
}

test("10개 locale은 화면이 사용하는 Study message ID를 정확한 namespace에 가진다", async () => {
  for (const locale of LOCALES) {
    for (const [namespace, ids] of Object.entries(BY_NAMESPACE)) {
      const catalog = await json(`locales/${locale}/${namespace}.json`);
      for (const id of ids) {
        assert.equal(typeof catalog[id], "string", `${locale}:${namespace}:${id}`);
        assert.ok(catalog[id].trim().length > 0, `${locale}:${namespace}:${id}:empty`);
      }
    }
  }
});

test("Study message ID에는 번역가 설명과 ICU 변수가 모두 선언된다", async () => {
  const descriptions = await json("locales/descriptions.json");
  for (const [namespace, ids] of Object.entries(BY_NAMESPACE)) {
    for (const id of ids) {
      assert.equal(descriptions[id]?.namespace, namespace, id);
      assert.equal(typeof descriptions[id]?.description, "string", `${id}:description`);
      assert.equal(typeof descriptions[id]?.variables, "object", `${id}:variables`);
    }
  }
});

test("문제·결과·시각 자료는 제목, live feedback, 접근성 이름을 제공한다", async () => {
  const renderer = await readFile(new URL("src/features/study/player/StudyProblemRenderer.tsx", ROOT), "utf8");
  const answerInput = await readFile(new URL("src/features/study/player/StudyAnswerInput.tsx", ROOT), "utf8");
  assert.match(renderer, /<h2[^>]*tabIndex=\{-1\}/);
  assert.match(renderer, /aria-live="polite"/);
  assert.match(answerInput, /<fieldset[\s\S]*<legend>/);

  const visualsUrl = new URL("src/features/study/player/visuals/", ROOT);
  const visualFiles = (await readdir(visualsUrl)).filter((name) => name.endsWith("Visual.tsx"));
  assert.ok(visualFiles.length >= 4);
  for (const file of visualFiles) {
    const source = await readFile(new URL(file, visualsUrl), "utf8");
    assert.match(source, /aria-label|aria-hidden/, file);
  }
});

test("Study 완료와 오류 상태는 스크린리더가 상태 변화를 알 수 있다", async () => {
  const result = await readFile(new URL("src/features/study/StudyMissionResult.tsx", ROOT), "utf8");
  const player = await readFile(new URL("src/features/study/StudyMissionPlayer.tsx", ROOT), "utf8");
  assert.match(result, /aria-labelledby="study-mission-complete-title"/);
  assert.match(player, /role="alert"/);
});

// 2026-09-26: 학습 화면도 앱 공용 원형 뒤로가기(hy-press + `-back`)를 쓴다. 공용 규칙이 44px 고정 폭과
// flex: none 을 주므로 긴 제목 옆에서도 줄어들지 않는다(화면별 48px 네모 버튼은 다른 화면과 달랐다).
test("부모 Study 뒤로 버튼은 공용 원형 뒤로가기로 긴 제목 옆에서도 줄지 않는다", async () => {
  const page = await readFile(new URL("src/screens/study/ParentStudy.tsx", ROOT), "utf8");
  const shared = await readFile(new URL("src/styles/components.css", ROOT), "utf8");
  assert.match(page, /className="study-back-button hy-press"/);
  const backRule = shared.match(/\.hy-app button\.hy-press\[class\*="-back"\],\s*\.hy-app button\.hy-backbtn \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(backRule, /width: var\(--control-min-size\) !important/);
  assert.match(backRule, /min-width: var\(--control-min-size\) !important/);
  assert.match(backRule, /flex: none/);
});
