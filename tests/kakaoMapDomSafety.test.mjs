import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/maps/providers/kakao/KakaoMapAdapter.tsx", import.meta.url),
  "utf8",
);
const componentCss = readFileSync(
  new URL("../src/styles/components.css", import.meta.url),
  "utf8",
);

test("지도 오버레이는 아이 이름과 체류 문구를 HTML 문자열로 해석하지 않는다", () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /document\.createElement\("img"\)/);
  assert.match(source, /avatarImage\.alt\s*=\s*child\.name/);
  assert.match(source, /avatarFrame\.replaceChildren\(avatarImage\)/);
  assert.match(source, /content\.append\(avatarFrame\)/);
  assert.match(source, /timeBadge\.textContent\s*=\s*child\.caption/);
  assert.match(source, /dwellText\.textContent\s*=\s*s\.dwellLabel/);
});

test("악성 이름을 속성 문자열로 보간하는 회귀 경로가 없다", () => {
  assert.doesNotMatch(source, /alt=\[?['"`]\$\{child\.name\}/);
  assert.doesNotMatch(source, /<span[^>]*>\$\{s\.dwellLabel\}<\/span>/);
});

test("Kakao 지도 출처 링크는 SDK 기본 32px 대신 44px 조작 영역을 보장한다", () => {
  assert.match(componentCss, /\.km-canvas a\[href\^="http:\/\/map\.kakao\.com"\]/);
  assert.match(componentCss, /\.km-canvas a\[href\^="https:\/\/map\.kakao\.com"\]/);
  const rule = componentCss.slice(componentCss.indexOf('.km-canvas a[href^="http://map.kakao.com"]'));
  assert.match(rule, /min-width:\s*var\(--control-min-size\)\s*!important/);
  assert.match(rule, /min-height:\s*var\(--control-min-size\)\s*!important/);
});
