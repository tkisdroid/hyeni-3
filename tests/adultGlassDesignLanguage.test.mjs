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
  assert.match(shell, /const isChild = role === "child"/);
  assert.match(shell, /isChild \? "" : " hy-adult"/);
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

test("서리 스크림은 가릴 것이 생겼을 때만 켠다", () => {
  const shell = read("src/app/AppShell.tsx");
  const hook = read("src/app/useScrolledShell.ts");

  // 어른 셸 3개의 스크롤 영역이 스크롤 상태를 알린다(아이 셸은 이 언어를 쓰지 않는다).
  assert.equal((shell.match(/const scrolledRef = useScrolledShell\(\);/g) ?? []).length, 3);
  assert.equal((shell.match(/<main className="hy-screen[^"]*" ref=\{scrolledRef\}/g) ?? []).length, 3);
  assert.match(hook, /dataset\.scrolled/);
  assert.match(hook, /passive: true/);

  // 맨 위에서는 스크림이 없어야 오로라 위에 납작한 사각형이 생기지 않는다.
  assert.match(glass, /\.hy-adult \.hy-screen\[data-scrolled\] :is\(/);
  const topbarRule = glass.match(/\.hy-adult \.hy-topbar \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(topbarRule, /background: transparent/);
});

test("알림 화면의 필터는 sticky 헤더가 아니라 메인 섹션 안에 있다", () => {
  const source = read("src/screens/feature/Notifications.tsx");
  const listAt = source.indexOf('<div className="hy-content nc-list">');
  const filtersAt = source.indexOf('<div className="nc-filters">');
  assert.ok(listAt > 0 && filtersAt > listAt, "필터는 목록(.nc-list) 안에 있어야 한다");
  // 헤더에 둘째 줄을 붙이면 스크림·마스크 경계에 걸린다.
  assert.doesNotMatch(source, /nc-top/);
});

test("하단 메뉴는 바로가기로 들어간 화면에서도 보인다", () => {
  // 바로가기 목적지는 전부 PushShell 아래인데 여기에만 탭바가 없었다(2026-08-21 TK 제보).
  const pushBody = shell.slice(shell.indexOf("export function PushShell()"));
  assert.match(pushBody, /showNav && role === "parent" && <TabBar tabs=\{parentTabs\} iconOnly \/>/);
  assert.match(pushBody, /showNav && role === "teacher" && <TabBar tabs=\{teacherTabs\} \/>/);

  // 갈 곳이 없거나 일부러 가둬 둔 화면에서는 숨긴다.
  for (const path of ["/onboarding", "/app-update", "/perm-denied"]) {
    assert.ok(shell.includes(`"${path}"`), `${path} 는 하단 메뉴 예외 목록에 있어야 한다`);
  }

  // 새로 생긴 탭바에 내용이 가리지 않도록 스크롤 영역이 자리를 마련한다.
  assert.match(pushBody, /data-nav=\{showNav && !isChild \? "push" : undefined\}/);
  assert.match(glass, /\.hy-adult \.hy-screen\[data-nav="push"\] \{[^}]*padding-bottom/);
});

test("화면을 옮기면 처음은 최상단, 다시 찾으면 보던 자리로 돌아간다", () => {
  const hook = read("src/app/useScrolledShell.ts");

  // 화면 구분은 경로(+쿼리) 기준이다 — 탭으로 다시 들어가도 보던 자리를 찾아야 한다.
  assert.match(hook, /const screenKey = `\$\{pathname\}\$\{search\}`/);
  assert.match(hook, /savedPositions\.get\(screenKey\)/);
  // 처음 보는 화면은 반드시 맨 위에서 시작한다.
  assert.match(hook, /saved === undefined \|\| saved <= 0[\s\S]{0,80}scrollTop = 0/);
  // 지연 청크·쿼리로 내용이 늦게 자라므로 한 번으로는 못 돌아간다.
  assert.match(hook, /requestAnimationFrame\(apply\)/);
  // 사용자가 손대면 즉시 그만둔다(복원이 조작을 이기면 안 된다).
  assert.match(hook, /addEventListener\("pointerdown", stop/);
  // 무한히 쌓이지 않게 오래된 것부터 버린다.
  assert.match(hook, /MAX_REMEMBERED/);
});

test("절대 배치 루트 화면은 하단 메뉴 위로 바닥을 끌어올린다", () => {
  // padding 은 position:absolute + inset:0 루트에 통하지 않는다.
  // 실제로 '기기 찾기'의 [지금 울리기] 버튼이 탭바에 가려졌다.
  assert.match(glass, /\.hy-adult \.hy-screen\[data-nav="push"\] :is\(\.rr-root, \.ra-root, \.sr-root\) \{[^}]*bottom: var\(--hy-nav-inset\)/);
});
