import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// 2026-09-26 Safari 제보: 아이가 없는 가족에서 "학습을 확인할 아이를 선택해 주세요"만 나오고 고를 아이가 없었다.
test("수학·영단어 관리 화면은 연결된 아이가 없으면 선택 대신 아이 연결로 안내한다", () => {
  const study = read("src/screens/study/ParentStudy.tsx");
  assert.match(study, /target\.kind === "select" && childMembers\.length === 0 \?/);
  assert.match(study, /navigate\("\/child-invite\?role=child"\)\}>\{intl\.formatMessage\(\{ id: "study\.parent\.connectChild" \}\)\}/);

  const vocabulary = read("src/screens/study/ParentVocabulary.tsx");
  assert.match(vocabulary, /target\.kind !== "ready" && childMembers\.length === 0 \?/);
  assert.match(vocabulary, /navigate\("\/child-invite\?role=child"\)\}>\{label\("study\.parent\.connectChild"\)\}/);

  for (const locale of ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "id", "ms", "fil", "th"]) {
    const messages = JSON.parse(read(`locales/${locale}/parent.json`));
    assert.ok(messages["study.parent.noChildTitle"], `${locale} noChildTitle`);
    assert.ok(messages["study.parent.connectChild"], `${locale} connectChild`);
  }
});
