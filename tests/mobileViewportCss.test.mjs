import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readCss(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("AI 친구 채팅은 앱 프레임 높이에 맞고 메시지 목록만 스크롤된다", () => {
  const css = readCss("src/screens/child/AiFriendChat.css");

  assert.doesNotMatch(css, /\.afc\s*\{[^}]*min-height:\s*848px/s);
  assert.match(css, /\.afc\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.afc\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.afc-msgs\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.afc-msgs\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.afc-input-wrap\s*\{[^}]*flex:\s*none/s);
  assert.match(css, /\.afc-input-wrap\s*\{[^}]*position:\s*relative/s);
});

test("스티커 전송 화면은 앱 프레임 안에서 본문만 스크롤된다", () => {
  const css = readCss("src/screens/feature/StickerSend.css");

  assert.match(css, /\.ss-wrap\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.ss-wrap\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.ss-body\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /\.ss-body\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.ss-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(css, /120px \+ env\(safe-area-inset-bottom/);
});

test("아이 홈·독·오버레이의 애니메이션은 reduced motion에서 전부 멈춘다", () => {
  // 리디자인(모험 지도)에서 지도 구름·마스코트 걷기·펄스 배지·SOS 링이 모두 CSS 애니메이션이다.
  const home = readCss("src/screens/child/ChildHome.css");
  assert.match(home, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.kd-root \*[\s\S]*animation: none/s);
  assert.match(home, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.kd-root \*[\s\S]*transition: none/s);

  const sheet = readCss("src/screens/child/overlays/ChildSheet.css");
  assert.match(sheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/s);
  // 폭죽 조각은 멈추면 화면만 가리므로 아예 감춘다.
  assert.match(sheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ks-confetti[\s\S]*display: none/s);

  const dock = readCss("src/app/ChildDock.css");
  assert.match(dock, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.kdock__sos[\s\S]*animation: none/s);

  const sticker = readCss("src/screens/child/StickerBook.css");
  assert.match(sticker, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/s);
});

test("아이 홈에는 스스로 도는 타이머가 없다(모션은 전부 CSS 로 제어)", () => {
  // 옛 뉴스 티커(setInterval 자동 회전)는 지도 히어로로 대체됐다.
  // JS 타이머로 도는 UI 가 생기면 reduced-motion CSS 로는 멈출 수 없으므로 금지한다.
  const source = readCss("src/screens/child/ChildHome.tsx");
  assert.doesNotMatch(source, /setInterval/);
});

test("아이 홈 JSX의 주요 색상은 직접 hex 대신 토큰을 사용한다", () => {
  const source = readCss("src/screens/child/ChildHome.tsx");

  assert.doesNotMatch(source, /color="#[0-9A-Fa-f]{3,8}"/);
  assert.doesNotMatch(source, /background:\s*"#[0-9A-Fa-f]{3,8}"/);
  assert.match(source, /var\(--danger-500\)/);
  assert.match(source, /var\(--hy-accent-deep\)/);
  assert.match(source, /var\(--bg-card\)/);
});

test("부모 오늘경로의 오늘 머문 곳 시트는 접힘 transform이 sheet-up 애니메이션에 덮이지 않는다", () => {
  const css = readCss("src/screens/parent/ParentLocation.css");

  assert.match(css, /\.pl-stays\s*\{[^}]*animation:\s*none/s);
  assert.match(css, /\.pl-stays--collapsed\s*\{[^}]*transform:\s*translateY\(calc\(100% \+ 28px\)\)/s);
});

test("부모 오늘경로의 시간대별 경로는 아이 배지 제거 후 위쪽에 붙는다", () => {
  const css = readCss("src/screens/parent/ParentLocation.css");

  assert.match(css, /\.pl-scrub\s*\{[^}]*top:\s*108px/s);
});
