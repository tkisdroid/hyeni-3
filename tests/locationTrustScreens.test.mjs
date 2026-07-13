import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("부모 홈은 고정 실시간 배지 대신 현재 위치 판정 문구를 표시한다", () => {
  const source = read("src/screens/parent/ParentHome.tsx");
  assert.match(source, /\{heroLocationCopy\.badge\}/);
  assert.match(
    source,
    /loadState:\s*locationScopeError\s*\? "error"\s*:\s*locationScopeLoading\s*\? "loading"[\s\S]*locationsQuery\.isLoading/s,
  );
  assert.doesNotMatch(source, /<span className="hy-chip__pulse"\s*\/>\s*실시간/);
});

test("SOS 화면은 위치 로딩·실패·잠금 문구를 locationTrustCopy 한 곳에서 받는다", () => {
  const source = read("src/screens/feature/SosReceive.tsx");
  assert.match(source, /isLoading:\s*sosLoading/);
  assert.match(source, /isLoading:\s*locationsLoading/);
  assert.match(source, /isError:\s*locationsLoadError/);
  assert.match(source, /loadState:/);
  assert.match(source, /locationCopy\.badge/);
  assert.match(source, /locationCopy\.detail/);
  assert.doesNotMatch(source, /현재 위치 신호를 기다리는 중/);
});
