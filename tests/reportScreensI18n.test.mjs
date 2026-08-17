import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const daily = read("src/screens/feature/DailySafetyReport.tsx");
const weekly = read("src/screens/feature/WeeklyFamilyReport.tsx");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const koReports = JSON.parse(read("locales/ko/reports.json"));
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("일일 안심 리포트는 상세 건강 label/detail과 서버 원문을 유지한다", () => {
  assert.match(daily, /useIntl\(\)/);
  assert.match(daily, /reports\.daily\./);
  assert.match(daily, /deviceStatusView\([\s\S]{0,420}intl/);
  assert.match(daily, /formatFreshness\([\s\S]{0,180}intl/);
  assert.match(daily, /deviceSafetyState:\s*device\.safetyState/);
  assert.match(daily, /device\.notification\.label/);
  assert.match(daily, /device\.notification\.detail/);
  assert.match(daily, /device\.location\.label/);
  assert.match(daily, /device\.location\.detail/);
  for (const rawValue of ["event.title", "event.place", "memo.content", "app.name", "locationLabel(childLocation)"]) {
    assert.match(daily, new RegExp(escapeRegex(rawValue)));
  }
});

test("일일 리포트는 조회 실패를 빈 수치로 위장하지 않고 각 정본을 다시 조회한다", () => {
  const loadingBranch = daily.indexOf('safetySourceState === "loading"');
  const errorBranch = daily.indexOf('safetySourceState === "error"');
  const readyHero = daily.indexOf('className={`dr-hero dr-hero--${statusView.status}`}');
  assert.ok(loadingBranch >= 0 && errorBranch > loadingBranch && readyHero > errorBranch);
  assert.match(daily, /eventsQuery\.isError[\s\S]+eventsQuery\.refetch\(\)/);
  assert.match(daily, /suppliesQuery\.isError[\s\S]+suppliesQuery\.refetch\(\)/);
  assert.match(daily, /memoThread\.isError[\s\S]+memoThread\.refetch\(\)/);
});

test("주간 리포트는 Premium gate와 실제 네 정본 집계만 유지한다", () => {
  assert.match(weekly, /canUse\(tier, FEATURES\.WEEKLY_REPORT\)/);
  assert.match(weekly, /if \(queryState !== "ready"\) return null/);
  assert.match(weekly, /summarizeWeeklyReport\(\{[\s\S]+events:\s*eventsQuery\.data[\s\S]+supplies:\s*suppliesQuery\.data[\s\S]+memos:\s*memoThread\.data[\s\S]+alerts:\s*alertsQuery\.data/);
  assert.doesNotMatch(weekly, /\bfetch\(|axios|\/api\/.*report/i);
  assert.match(weekly, /queryState === "error"[\s\S]+Promise\.all\(\[[\s\S]+eventsQuery\.refetch\(\)[\s\S]+suppliesQuery\.refetch\(\)[\s\S]+memoThread\.refetch\(\)[\s\S]+alertsQuery\.refetch\(\)/);
  assert.match(weekly, /activeChild\.name/);
});

test("두 리포트는 날짜와 수치를 locale-aware formatter로 표시한다", () => {
  assert.match(daily, /formatDateTime\(/);
  assert.match(koReports["reports.daily.itemCount"], /\{count, number\}/);
  assert.match(weekly, /formatDateTime\(/);
  assert.match(weekly, /formatNumber\(/);
  assert.match(weekly, /reports\.weekly\./);
});

test("reports 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const catalogs = Object.fromEntries(locales.map((locale) => [
    locale,
    JSON.parse(read(`locales/${locale}/reports.json`)),
  ]));
  const expected = Object.keys(catalogs.ko).filter((id) => id.startsWith("reports.")).sort();
  assert.ok(expected.length >= 100, `reports ID가 부족합니다: ${expected.length}`);
  const english = catalogs.en;
  for (const locale of locales) {
    const ids = Object.keys(catalogs[locale]).filter((id) => id.startsWith("reports.")).sort();
    assert.deepEqual(ids, expected, `${locale} reports ID 집합이 다릅니다`);
    if (locale !== "en") {
      for (const id of expected) {
        const languageBearingEnglish = english[id]
          .replace(/\{[^}]+\}|[\d\s\p{P}\p{S}]/gu, "");
        if (languageBearingEnglish) {
          assert.notEqual(catalogs[locale][id], english[id], `${locale}가 영어를 그대로 폴백합니다: ${id}`);
        }
      }
    }
  }

  const descriptions = JSON.parse(read("locales/descriptions.json"));
  for (const id of expected) assert.ok(descriptions[id], `description 누락: ${id}`);
  assert.match(catalogs.ko["reports.daily.heroEyebrow"], /\{childName\}/);
  assert.match(catalogs.ko["reports.weekly.heroEyebrow"], /\{childName\}/);
  assert.match(catalogs.ko["reports.weekly.metricCount"], /\{count\}/);
});
