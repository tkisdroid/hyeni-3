import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Free 위치 화면은 오늘 경로를 열고 수동 5회 소진 시 상황형 업셀을 연다", () => {
  const source = read("src/screens/parent/ParentLocation.tsx");

  assert.match(source, /const canShowHistory = canShowLocation/);
  assert.match(source, /requested\.status === 429[\s\S]*setUpsellSource\("location_request"\)/);
  assert.match(source, /source=\{upsellSource\}/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /setUpsellSource\("location_history"\)/);
  assert.doesNotMatch(source, /오늘 이동 경로는 프리미엄이에요/);
});

test("Free 화면 진입은 수동 위치 요청 횟수를 소모하지 않고 길찾기는 티어로 막지 않는다", () => {
  const source = read("src/screens/parent/ParentLocation.tsx");

  assert.match(source, /if \([\s\S]*!premiumOpen[\s\S]*\) return;[\s\S]*void refreshLocation\(false\)/);
  assert.match(source, /aria-label="다음 일정 길찾기"[\s\S]*onClick=\{\(\) => navigate\("\/route"\)\}/);
  assert.match(source, /aria-label="주변 소리 듣기"[\s\S]*onClick=\{\(\) => navigate\("\/remote-audio"\)\}/);
});

test("위치 설정은 보관기간을 오해시키지 않고 실제 티어 조회 범위를 표시한다", () => {
  const source = read("src/screens/feature/LocationSettings.tsx");

  assert.doesNotMatch(source, /7일 \(무료\)/);
  assert.match(source, /최근 30일 \(프리미엄 조회 범위\)/);
  assert.match(source, /오늘 \(무료 조회 범위\)/);
  assert.match(source, />위치 기록 조회 범위</);
});

test("위치 설정의 기록 범위 행은 Premium은 실제 기록으로, Free는 상황형 업셀로 연결한다", () => {
  const source = read("src/screens/feature/LocationSettings.tsx");
  const historyRow = source.indexOf(">위치 기록 조회 범위<");
  const upsell = source.indexOf('source="location_history"');

  assert.ok(historyRow >= 0 && upsell > historyRow);
  assert.match(source, /tier === TIERS\.PREMIUM[\s\S]{0,180}navigate\("\/parent\/location\?view=history"\)[\s\S]{0,180}setHistoryUpsellOpen\(true\)/);
  assert.match(source, /source="location_history"/);
  assert.match(source, /returnTo="\/parent\/location\?view=history"/);
  assert.match(source, /savePremiumReturnIntent/);
});

test("Premium 위치 기록은 최근 30일 날짜를 고르고 Free의 과거 선택은 오늘로 고정한 채 업셀한다", () => {
  const source = read("src/screens/parent/ParentLocation.tsx");
  const toolbar = read("src/screens/parent/LocationHistoryToolbar.tsx");

  assert.match(toolbar, /type="date"/);
  assert.match(source, /historyDaysFor\(TIERS\.PREMIUM\)/);
  assert.match(source, /getHistoryDayWindowForKey/);
  assert.match(source, /queryEnd\.toISOString\(\)/);
  assert.match(source, /if \(!premiumOpen\)[\s\S]{0,180}setHistoryUpsellDayKey\([\s\S]{0,120}setUpsellSource\("location_history"\)/);
  assert.match(source, /premiumOpen[\s\S]{0,120}rawHistoryDayKey[\s\S]{0,120}historyTodayKey/);
  assert.match(toolbar, /aria-label="이동 기록 날짜 선택"/);
});
