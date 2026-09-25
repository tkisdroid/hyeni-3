// 2026-09-25 브라우저 QA — 아이 "내 위치" 화면이 방금 보낸 위치를 "방금 업데이트 업데이트"로 보여 줬다.
// 공용 "방금" 표시("방금 업데이트")를 "{freshness} 업데이트" 문장에 그대로 넣었기 때문이다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("아이 위치 화면은 방금 보낸 위치에 아이용 '방금' 문구를 넣어 말이 겹치지 않는다", () => {
  const screen = read("src/screens/child/ChildLocationStatus.tsx");
  assert.match(screen, /fresh\.status === "live"\s*\?\s*intl\.formatMessage\(\{ id: "child\.location\.justNow" \}\)/);
  assert.equal((screen.match(/\{ freshness: freshnessPhrase \}/g) ?? []).length, 2);
  assert.doesNotMatch(screen, /freshness: fresh\?\.label/);

  for (const locale of ["ko", "en"]) {
    const child = JSON.parse(read(`locales/${locale}/child.json`));
    const shared = JSON.parse(read(`locales/${locale}/shared.json`));
    const rendered = child["child.location.detail.updated"].replace("{freshness}", child["child.location.justNow"]);
    const words = rendered.toLowerCase().split(/\s+/);
    assert.equal(new Set(words).size, words.length, `${locale}: "${rendered}" 에 같은 말이 겹친다`);
    // 공용 문구를 넣으면 겹치는 것이 원래 결함이었다(회귀 확인용 대조).
    const shared_rendered = child["child.location.detail.updated"].replace("{freshness}", shared["shared.location.justUpdated"]);
    if (locale === "ko") assert.match(shared_rendered, /업데이트 업데이트/);
  }
});
