import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

test("하루 요약은 대상 아이의 member id와 앱 date_key로 일정 신호를 격리한다", () => {
  const source = read("src/screens/feature/DaySummary.tsx");

  assert.match(source, /const childMemberId = targetChild\?\.id \?\? null/);
  assert.match(source, /if \(!childMemberId\) return undefined/);
  assert.match(source, /filterEventsForChild\(events \?\? \[\], childMemberId\)/);
  assert.match(source, /\.filter\(\(e\) => e\.date_key === appDateKey/);
  assert.match(source, /dateKeyToDateInputValue\(appDateKey\)/);
  assert.match(source, /useDaySummary\(allowed \? childUserId : null, isoDateKey\)/);
  assert.match(source, /\{ childUserId, isoDateKey, clientSignals \}/);
  assert.doesNotMatch(source, /children\[0\]/);
});

test("하루 요약은 사용자·서버 원문을 번역하거나 없는 준비물·메모 수치로 꾸미지 않는다", () => {
  const source = read("src/screens/feature/DaySummary.tsx");

  assert.match(source, /text: e\.title/);
  assert.match(source, /text: p\.title/);
  assert.match(source, /sub: p\.durationLabel \|\| undefined/);
  assert.match(source, /text: h/);
  assert.match(source, /\{summary\}/);
  assert.doesNotMatch(source, /useDailySupplies|useMemoReplies/);
  assert.doesNotMatch(source, /가짜|준비물 \d|메모 \d|리워드/);
});

test("하루 요약의 생성 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const en = JSON.parse(read("locales/en/parent.json"));
  const ids = Object.keys(en).filter((id) => id.startsWith("parent.daySummary."));
  assert.ok(ids.length >= 25, `메시지 수 부족: ${ids.length}`);

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

  assert.deepEqual(
    [...en["parent.daySummary.screenTitle"].matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((m) => m[1]),
    ["childName"],
  );
  assert.deepEqual(
    [...en["parent.daySummary.emptyDescription"].matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((m) => m[1]),
    ["date"],
  );
});
