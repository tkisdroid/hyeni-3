import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [weeklyReport, onboarding] = await Promise.all([
  readFile(new URL("../src/screens/feature/WeeklyFamilyReport.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8"),
]);

test("주간 리포트는 네 조회의 오류를 로딩보다 먼저 분기한다", () => {
  assert.match(weeklyReport, /resolveQueryTruthState/);
  assert.match(weeklyReport, /eventsQuery\.isError/);
  assert.match(weeklyReport, /suppliesQuery\.isError/);
  assert.match(weeklyReport, /memoThread\.isError/);
  assert.match(weeklyReport, /alertsQuery\.isError/);

  const errorBranch = weeklyReport.indexOf('queryState === "error"');
  const loadingBranch = weeklyReport.indexOf('queryState === "loading"');
  assert.ok(errorBranch >= 0, "조회 오류 분기가 필요합니다");
  assert.ok(loadingBranch > errorBranch, "오류 분기는 로딩 분기보다 먼저 렌더해야 합니다");
});

test("주간 리포트는 ready에서만 집계하고 오류 카드에서 네 조회를 함께 재시도한다", () => {
  assert.match(
    weeklyReport,
    /const summary = useMemo\([\s\S]*if \(queryState !== "ready"\) return null;[\s\S]*summarizeWeeklyReport\(/,
  );
  assert.match(weeklyReport, /주간 리포트를 불러오지 못했어요/);
  assert.match(
    weeklyReport,
    /Promise\.all\(\[\s*eventsQuery\.refetch\(\),\s*suppliesQuery\.refetch\(\),\s*memoThread\.refetch\(\),\s*alertsQuery\.refetch\(\),?\s*\]\)/,
  );
});

test("가족 조회가 null로 성공한 경우에만 신규 가족 연결 단계로 이동한다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = async () => {");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);

  assert.ok(start >= 0 && end > start, "부모 로그인 후 라우팅 함수가 필요합니다");
  assert.match(route, /const fam = await getMyFamily\(\)/);
  assert.match(route, /if \(fam === null\) \{[\s\S]*setStep\("connect"\)/);
  assert.match(route, /navigate\("\/parent\/home"\)/);
});

test("가족 조회 실패는 연결 단계로 보내지 않고 기존 로그인 오류 처리로 전달한다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = async () => {");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);
  const connectIndex = route.indexOf('setStep("connect")');
  const catchIndex = route.indexOf("catch");

  assert.ok(connectIndex >= 0 && catchIndex > connectIndex, "connect 이동은 null 성공 분기 안에 있어야 합니다");
  assert.match(
    route,
    /catch[\s\S]*throw new Error\("가족 정보를 확인하지 못했어요\. 다시 시도해 주세요\."\)/,
  );
  assert.match(
    onboarding,
    /await onLoggedIn\(\);[\s\S]{0,120}catch \(e\) \{[\s\S]{0,120}show\(errMsg\(e\), "⚠️"\)/,
  );
});
