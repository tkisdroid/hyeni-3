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
  const koParent = JSON.parse(readSource("locales/ko/parent.json"));

  assert.match(source, /className="ph-stickerbtn ph-neu-control hy-press"/);
  assert.match(source, /aria-label=\{intl\.formatMessage\([\s\S]{0,100}parent\.home\.sendStickerTo[\s\S]{0,100}childName/);
  assert.equal(koParent["parent.home.sendStickerTo"], "{childName}에게 칭찬 스티커 보내기");
  assert.match(source, /navigate\("\/sticker-send"\)/);
  assert.doesNotMatch(JSON.stringify(koParent), /꾹/);
  assert.doesNotMatch(source, /ph-heartbtn/);
  assert.doesNotMatch(css, /ph-heartbtn/);
});

test("부모 홈 바로가기는 스티커 대신 안심리포트 진입점을 가진다", () => {
  const source = readSource("src/screens/parent/ParentHome.tsx");
  const mock = readSource("src/data/mock.ts");

  assert.match(source, /sc6: "\/daily-report"/);
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
  // 지표 아이콘은 lucide 라인 대신 3D 에셋(구독·홈과 같은 시각 언어)을 사용한다.
  assert.match(source, /ui\/pin-heart\.webp/);
  assert.match(source, /ui\/calendar-heart\.webp/);
  assert.match(source, /ui\/battery\.webp/);
  assert.match(source, /cat\/study\.webp/);
  assert.match(css, /\.dr-overview\s*\{/);
  assert.match(css, /\.dr-signal-grid\s*\{/);
  assert.match(css, /\.dr-device-grid\s*\{/);
});

test("오늘의 안심 리포트는 부모 홈처럼 섹션 한 장과 평평한 안쪽 행을 쓴다", () => {
  const source = readSource("src/screens/feature/DailySafetyReport.tsx");
  const css = readSource("src/screens/feature/DailySafetyReport.css");

  assert.match(source, /className="hy-card dr-overview"/);
  assert.match(source, /className="hy-card dr-more"/);
  assert.doesNotMatch(source, /dr-hero__mini/);
  assert.match(css, /안심리포트 재디자인/);
  assert.match(css, /\.dr-section \{[^}]*border-radius: var\(--radius-24\)/s);
  assert.match(css, /\.dr-overview-card \{[\s\S]*?background: transparent/);
  assert.match(css, /\.dr-event \{[\s\S]*?background: transparent/);
  assert.match(css, /\.dr-weekly \{[\s\S]*?background: transparent/);
});
