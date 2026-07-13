import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/KakaoMap.tsx", import.meta.url),
  "utf8",
);

test("지도 오버레이는 아이 이름과 체류 문구를 HTML 문자열로 해석하지 않는다", () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /document\.createElement\("img"\)/);
  assert.match(source, /avatarImage\.alt\s*=\s*child\.name/);
  assert.match(source, /content\.replaceChildren\(avatarImage\)/);
  assert.match(source, /dwellText\.textContent\s*=\s*s\.dwellLabel/);
});

test("악성 이름을 속성 문자열로 보간하는 회귀 경로가 없다", () => {
  assert.doesNotMatch(source, /alt=\[?['"`]\$\{child\.name\}/);
  assert.doesNotMatch(source, /<span[^>]*>\$\{s\.dwellLabel\}<\/span>/);
});
