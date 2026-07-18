import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/screens/feature/DailySafetyReport.tsx", import.meta.url),
  "utf8",
);

test("안심 리포트는 알림·위치·기기 조회 오류를 안전 상태 입력으로 전달한다", () => {
  assert.match(source, /alertsQuery\.isError/);
  assert.match(source, /locationsQuery\.isError/);
  assert.match(source, /childNotifSettingsQuery\.isError/);
  assert.match(source, /const safetySourceState =/);
  assert.match(source, /sourceState:\s*safetySourceState/);
});

test("안심 리포트 오류 카드는 실패한 정본을 각각 다시 조회한다", () => {
  assert.match(source, /안심 데이터를 확인하지 못했어요/);
  assert.match(source, /alertsQuery\.refetch\(\)/);
  assert.match(source, /locationsQuery\.refetch\(\)/);
  assert.match(source, /childNotifSettingsQuery\.refetch\(\)/);
  assert.match(source, /안전 알림 다시 시도/);
  assert.match(source, /위치 다시 시도/);
  assert.match(source, /기기 상태 다시 시도/);
});

test("안심 리포트는 첫 로딩과 오류에서 수치·안전 문구가 있는 본문을 렌더하지 않는다", () => {
  const loadingBranch = source.indexOf('safetySourceState === "loading"');
  const errorBranch = source.indexOf('safetySourceState === "error"');
  const readyHero = source.indexOf('className={`dr-hero dr-hero--${statusView.status}`}');

  assert.ok(loadingBranch >= 0, "안전 정본의 첫 로딩 분기가 필요합니다");
  assert.ok(errorBranch > loadingBranch, "오류 분기는 로딩 분기 다음에 있어야 합니다");
  assert.ok(readyHero > errorBranch, "안전 수치 본문은 로딩·오류 분기 뒤의 ready 경로에만 있어야 합니다");
  assert.match(source, /<Loading label="안심 데이터를 불러오는 중"/);
});
