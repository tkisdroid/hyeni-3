import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("부모 홈은 상단 꾹 대신 스티커 버튼을 보여준다", () => {
  const source = readSource("src/screens/parent/ParentHome.tsx");
  const css = readSource("src/screens/parent/ParentHome.css");

  assert.match(source, /className="ph-stickerbtn hy-press"/);
  assert.match(source, /aria-label=\{`\$\{childName\}에게 칭찬 스티커 보내기`\}/);
  assert.match(source, /navigate\("\/sticker-send"\)/);
  assert.doesNotMatch(source, /꾹/);
  assert.doesNotMatch(source, /ph-heartbtn/);
  assert.doesNotMatch(css, /ph-heartbtn/);
});

test("부모 홈 바로가기는 스티커 대신 안심리포트 진입점을 가진다", () => {
  const source = readSource("src/screens/parent/ParentHome.tsx");
  const mock = readSource("src/data/mock.ts");

  assert.match(source, /"안심리포트": "\/daily-report"/);
  assert.match(mock, /label: "안심리포트"/);
  assert.match(mock, /icon: "ui\/shield-heart\.webp"/);
  assert.doesNotMatch(mock, /label: "스티커"/);
  assert.doesNotMatch(source, /className="hy-card ph-report hy-press"/);
});

test("오늘의 안심 리포트는 아이콘형 요약과 안전 신호 섹션을 렌더한다", () => {
  const source = readSource("src/screens/feature/DailySafetyReport.tsx");
  const css = readSource("src/screens/feature/DailySafetyReport.css");

  assert.match(source, /overviewCards\.map/);
  assert.match(source, /safetySignals\.map/);
  assert.match(source, /MapPinned/);
  assert.match(source, /CalendarCheck2/);
  assert.match(source, /HeartPulse/);
  assert.match(css, /\.dr-overview\s*\{/);
  assert.match(css, /\.dr-signal-grid\s*\{/);
  assert.match(css, /\.dr-device-grid\s*\{/);
});
