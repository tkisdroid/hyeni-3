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

test("부모 오늘경로 패널은 명시적 토글과 최소 조작 크기를 제공한다", () => {
  const css = readCss("src/screens/parent/ParentLocation.css");

  assert.match(css, /\.pl-journey__toggle\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.doesNotMatch(css, /\.pl-stays--collapsed/);
});

test("부모 이동 기록은 세로 하단 패널과 가로 왼쪽 패널로 배치된다", () => {
  const css = readCss("src/screens/parent/ParentLocation.css");

  assert.match(css, /\.pl-journey\s*\{[^}]*left:\s*16px[^}]*right:\s*16px[^}]*bottom:/s);
  assert.match(css, /@media\s*\(min-width:\s*720px\)[\s\S]*\.pl-journey\s*\{[^}]*width:\s*392px[^}]*left:\s*16px/s);
  assert.match(css, /\.pl-journey__toggle\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
});

test("아이 화면은 TopBar 가 없으므로 각자 상단 안전영역을 챙긴다(상태바 겹침 금지)", () => {
  // 실기기(razr, safe-area-inset-top=42px)에서 스티커북·AI친구·SOS 상단이 상태바에 가려졌다.
  const home = readCss("src/screens/child/ChildHome.css");
  assert.match(home, /--kd-safe: env\(safe-area-inset-top, 0px\)/);
  assert.match(home, /\.kd-map\s*\{[^}]*padding-top: var\(--kd-safe\)/s);

  const sticker = readCss("src/screens/child/StickerBook.css");
  assert.match(sticker, /\.sb-head\s*\{[^}]*padding: calc\(16px \+ env\(safe-area-inset-top, 0px\)\)/s);

  const ai = readCss("src/screens/child/AiFriendChat.css");
  assert.match(ai, /\.afc-header\s*\{[^}]*padding: calc\(12px \+ env\(safe-area-inset-top, 0px\)\)/s);

  const sos = readCss("src/screens/child/ChildSos.css");
  assert.match(sos, /\.cs-page\s*\{[^}]*padding: calc\(16px \+ env\(safe-area-inset-top, 0px\)\)/s);
  assert.match(sos, /\.cs-result\s*\{[^}]*padding: calc\(24px \+ env\(safe-area-inset-top, 0px\)\)/s);
});

test("학습 화면은 일반 상세 화면과 같은 상단 안전 여백을 확보한다", () => {
  const parentStudy = readCss("src/features/study/parent-study.css");
  assert.match(
    parentStudy,
    /\.parent-study-screen\s*\{[^}]*padding:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 16px\) 16px 16px/s,
  );

  const studyAccess = readCss("src/features/study/study-access.css");
  assert.match(
    studyAccess,
    /\.study-access-screen\s*\{[^}]*padding:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 16px\) 16px 24px/s,
  );
});

test("아이 홈 구름 장식은 날짜 칩·제목 밴드(스테이지 0~92px)를 침범하지 않는다", () => {
  // 반투명 흰 알약이 제목 뒤에 깔리면 장식이 아니라 렌더 깨짐처럼 보인다(razr 실기기 제보).
  // 구름 덩이(::before)가 몸통 위로 약 20px 솟으므로 밴드보다 20px 넉넉히 내려야 한다.
  const home = readCss("src/screens/child/ChildHome.css");
  const tops = [...home.matchAll(/\.kd-map__cloud--[ab]\s*\{[^}]*?top:\s*(\d+)px/gs)].map((m) => Number(m[1]));

  assert.equal(tops.length, 2, "구름 2개의 top 을 찾지 못했다");
  for (const top of tops) assert.ok(top >= 112, `구름 top=${top}px 은 제목 밴드(0~92px)와 겹친다`);
  // 겹친 덩이의 이음선을 없애려면 알파를 background 가 아니라 opacity 로 줘야 한다.
  assert.match(home, /\.kd-map__cloud\s*\{[^}]*background: #fff;[^}]*opacity: 0\.85/s);
  assert.match(home, /\.kd-map__cloud::before,\s*\n\.kd-map__cloud::after/);
});

test("아이 하단 독은 내비게이션 바 영역까지 배경을 덮는다(콘텐츠 비침 방지)", () => {
  const dock = readCss("src/app/ChildDock.css");
  assert.match(dock, /\.kdock\s*\{[^}]*bottom: 0/s);
  assert.match(dock, /\.kdock\s*\{[^}]*padding: 24px 14px calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\)/s);
  assert.match(dock, /\.kdock\s*\{[^}]*background: linear-gradient/s);
  // 페이드 영역이 클릭을 먹지 않도록.
  assert.match(dock, /\.kdock\s*\{[^}]*pointer-events: none/s);
  assert.match(dock, /\.kdock > \*\s*\{\s*pointer-events: auto/s);
});

test("Capacitor 네이티브 앱은 가로 폭에서도 데스크톱 폰 프레임과 좌우 여백을 만들지 않는다", () => {
  const entry = readCss("src/main.tsx");
  const global = readCss("src/styles/global.css");

  assert.match(entry, /document\.documentElement\.toggleAttribute\("data-hy-native",\s*isNativePlatform\(\)\)/);
  assert.match(global, /html\[data-hy-native\]\s+body\s*\{[^}]*background:\s*var\(--bg-body\)/s);
  assert.match(global, /html\[data-hy-native\]\s+\.hy-app\s*\{[^}]*max-width:\s*none/s);
  assert.match(global, /html\[data-hy-native\]\s+\.hy-app\s*\{[^}]*margin:\s*0/s);
  assert.match(global, /html\[data-hy-native\]\s+\.hy-app\s*\{[^}]*border-radius:\s*0/s);
  assert.match(global, /html\[data-hy-native\]\s+:is\([^)]*\.mps-sheet[^)]*\.ofb-root[^)]*\.ks-layer[^)]*\.pc-sheet-root[^)]*\)\s*\{[^}]*max-width:\s*none/s);
});
