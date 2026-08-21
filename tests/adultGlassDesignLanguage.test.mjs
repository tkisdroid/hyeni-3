import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const glass = read("src/styles/glass.css");
const shell = read("src/app/AppShell.tsx");

test("어른 모드 디자인 언어는 glass.css 한 곳에서 .hy-adult 로만 적용된다", () => {
  // 셸이 어른 화면에만 클래스를 붙인다.
  assert.match(shell, /className="hy-app hy-adult" data-role="parent"/);
  assert.match(shell, /className="hy-app hy-adult" data-accent="mint"/);
  // PushShell 은 아이도 지나가므로 세션 role 로 판정해야 한다.
  assert.match(shell, /role === "child" \? "" : " hy-adult"/);
  assert.doesNotMatch(shell, /data-role="child"[^>]*hy-adult/);

  // 팔레트·바닥은 glass.css 가 정본이다.
  for (const token of ["--ph-glass-fill", "--ph-object-raise", "--ph-ink", "--ph-link", "--ph-hairline"]) {
    assert.ok(glass.includes(`${token}:`), `${token} 정의가 glass.css 에 있어야 한다`);
  }
  assert.match(glass, /\.hy-adult \.hy-screen::before/);
});

test("화면별 redesign 파일은 공용 팔레트·바닥·탭바를 다시 정의하지 않는다", () => {
  const redesigns = ["src/screens/parent/ParentHome.redesign.css", "src/screens/parent/ParentLocation.redesign.css"];
  for (const path of redesigns) {
    const css = read(path);
    assert.doesNotMatch(css, /--ph-ink\s*:/, `${path} 는 잉크 팔레트를 다시 정의하면 안 된다`);
    assert.doesNotMatch(css, /--ph-glass-fill\s*:/, `${path} 는 유리 채움을 다시 정의하면 안 된다`);
    assert.doesNotMatch(css, /\.hy-tabbar__inner\s*\{/, `${path} 는 탭바를 다시 정의하면 안 된다`);
  }
});

test("어른 화면 루트는 자기 배경을 칠하지 않고 공용 오로라를 쓴다", () => {
  // 화면마다 bespoke 그라데이션을 칠하던 것이 '일관성 없음'의 실체였다.
  // 정본 목록에 없는 루트가 새로 배경을 칠하면 이 테스트가 잡는다.
  const declared = new Set(
    (glass.match(/\.[a-z][\w-]*(?=[,\s)])/g) ?? []).map((s) => s.slice(1)),
  );
  const missing = [];
  const dirs = ["src/screens/feature", "src/screens/parent", "src/screens/teacher", "src/screens/onboarding"];
  for (const dir of dirs) {
    for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
      if (!name.endsWith(".css")) continue;
      const css = read(join(dir, name).replaceAll("\\", "/"));
      for (const m of css.matchAll(/(^|\})\s*(\.[\w-]+)(?:--[\w-]+)?\s*\{([^}]*)\}/g)) {
        const selector = m[2].slice(1);
        const body = m[3];
        // 화면 루트로 볼 수 있는 이름만 검사한다(-screen/-root/-wrap).
        if (!/-(screen|root|wrap)$/.test(selector)) continue;
        if (selector === "sr-root") continue; // SOS 수신의 붉은 바닥은 의도된 신호다.
        if (!/background(-image)?\s*:\s*(linear|radial)-gradient/.test(body)) continue;
        if (!declared.has(selector)) missing.push(`${dir}/${name} .${selector}`);
      }
    }
  }
  assert.deepEqual(missing, [], `공용 바닥으로 넘기지 않은 화면 루트:\n${missing.join("\n")}`);
});

test("이동 기록 도구막대는 좌우 화살표 없이 날짜 하나로 고른다", () => {
  const toolbar = read("src/screens/parent/LocationHistoryToolbar.tsx");
  assert.match(toolbar, /type="date"/);
  assert.match(toolbar, /parent\.location\.history\.pickDay/);
  // 하루씩 밟는 버튼은 제거됐다(30일 전으로 가려면 29번을 눌러야 했다).
  assert.doesNotMatch(toolbar, /ChevronLeft|ChevronRight|onPrevious|onNext/);
});

test("위치 실시간 카드와 이동 기록 카드는 같은 판·같은 행 높이를 쓴다", () => {
  const css = read("src/screens/parent/ParentLocation.redesign.css");
  assert.match(css, /\.pl-root \.pl-sheet,\s*\n\s*\.pl-root \.pl-visited \{/);
  assert.match(css, /\.pl-root \.pl-visited__row \{[^}]*min-height: 44px/);
  // 4색 파스텔 액션 타일은 한 재질로 통일했다.
  assert.match(css, /\.pl-root \.pl-memo-btn,/);
});
