/**
 * 색상 대비·모서리 반경 계약 (2026-07-30 디자인 검수)
 *
 * 실기기·헤드리스 계측에서 확인한 두 결함군을 정적으로 고정한다.
 *  ① 파스텔 팔레트 위 흰 글자는 어떤 테마색에서도 WCAG AA 를 만족할 수 없다(1.4~2.8:1).
 *     → 흰 라벨을 올리는 채움은 --*-cta 토큰만 쓴다.
 *  ② 문구용 토큰은 자기 채움과 앱의 네 표면 모두에서 4.5:1 이상이어야 한다.
 *  ③ 모서리 반경은 8/12/16/20/24px·pill 만 쓴다(장식·기기 프레임 제외).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const TOKENS = readFileSync("src/styles/tokens.css", "utf8");
const CSS_FILES = execSync("git ls-files src", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((f) => f.endsWith(".css"));

/** tokens.css 의 :root 선언에서 토큰 값을 읽는다. */
function token(name) {
  const m = TOKENS.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `${name} 토큰이 hex 로 선언되어 있어야 한다`);
  return m[1];
}

/** [data-accent="x"] 한 줄에서 특정 토큰 값을 읽는다. */
function accentToken(accent, name) {
  const line = TOKENS.split(/\r?\n/).find((l) => l.includes(`[data-accent="${accent}"]`));
  assert.ok(line, `${accent} 테마 선언이 있어야 한다`);
  const m = line.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `${accent} 테마에 ${name} 가 있어야 한다`);
  return m[1];
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const AA_BODY = 4.5;
const SURFACES = ["--bg-card", "--bg-app", "--bg-page", "--bg-body"];
const ACCENTS = ["rose", "peach", "lavender", "mint", "sky", "lemon"];

test("보조·강조 문구 토큰은 앱의 네 표면 모두에서 AA(4.5:1) 이상이다", () => {
  const surfaces = SURFACES.map((s) => [s, token(s)]);
  for (const fg of ["--fg-muted", "--fg-placeholder", "--fg-secondary", "--fg-body", "--fg-tertiary"]) {
    const fgHex = token(fg);
    for (const [name, bgHex] of surfaces) {
      const ratio = contrast(fgHex, bgHex);
      assert.ok(
        ratio >= AA_BODY,
        `${fg}(${fgHex}) 는 ${name}(${bgHex}) 위에서 ${ratio.toFixed(2)}:1 — 4.5:1 이상이어야 한다`,
      );
    }
  }
});

test("테마별 --hy-accent-text 는 자기 soft 채움과 네 표면 모두에서 AA 이상이다", () => {
  const surfaceHex = SURFACES.map((s) => token(s));
  for (const accent of ACCENTS) {
    const fg = accentToken(accent, "--hy-accent-text");
    const soft = accentToken(accent, "--hy-accent-soft");
    for (const bg of [soft, ...surfaceHex]) {
      const ratio = contrast(fg, bg);
      assert.ok(
        ratio >= AA_BODY,
        `${accent} --hy-accent-text(${fg}) 는 ${bg} 위에서 ${ratio.toFixed(2)}:1 — 4.5:1 이상이어야 한다`,
      );
    }
  }
});

test("흰 라벨을 올리는 CTA 채움은 라벨 크기와 무관하게 AA 이상이다", () => {
  // WCAG 큰 글씨 완화(3:1)는 굵은 글씨라도 18.66px 이상에만 적용된다.
  // 18px/700 버튼에는 4.5:1 이 그대로 걸리므로 크기에 의존하지 않는 값을 요구한다.
  for (const accent of ACCENTS) {
    const cta = accentToken(accent, "--hy-accent-cta");
    const ratio = contrast("#FFFFFF", cta);
    assert.ok(
      ratio >= AA_BODY,
      `${accent} --hy-accent-cta(${cta}) 위 흰 글자가 ${ratio.toFixed(2)}:1 — 4.5:1 이상이어야 한다`,
    );
  }
  for (const name of ["--hy-accent-cta", "--mint-cta", "--danger-cta"]) {
    const ratio = contrast("#FFFFFF", token(name));
    assert.ok(ratio >= AA_BODY, `${name} 위 흰 글자가 ${ratio.toFixed(2)}:1 — 4.5:1 이상이어야 한다`);
  }
});

test("일정 카테고리 신호색은 자기 soft 채움 위에서 AA 이상이다", () => {
  for (const cat of ["school", "sports", "hobby", "friend", "other"]) {
    const fg = token(`--cat-${cat}-text`);
    const bg = token(`--cat-${cat}-soft`);
    const ratio = contrast(fg, bg);
    assert.ok(
      ratio >= AA_BODY,
      `--cat-${cat}-text(${fg}) 는 --cat-${cat}-soft(${bg}) 위에서 ${ratio.toFixed(2)}:1 — 4.5:1 이상이어야 한다`,
    );
  }
});

test("파스텔 채움 위에 흰 글자를 올리지 않는다(CTA 채움 토큰만 허용)", () => {
  // 흰 글자와 짝지으면 안 되는 채움 — 어떤 크기에서도 AA 에 못 미친다.
  const PASTEL_FILL = /background(-color)?:[^;]*(var\(--hy-accent\)|var\(--hy-accent-light\)|var\(--hy-accent-deep\)|var\(--mint-400\)|var\(--mint-500\)|var\(--mint-600\)|var\(--gold-400\)|var\(--rose-500\)|var\(--danger-strong\)|var\(--lav-400\))/;
  const WHITE_TEXT = /color:\s*(#fff(fff)?|white)\b/i;
  const offenders = [];

  for (const file of CSS_FILES) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let selector = "";
    let fill = null;
    lines.forEach((line, i) => {
      const open = line.match(/^([^{}]*[^\s{])\s*\{\s*$/);
      if (open) { selector = open[1].trim(); fill = null; }
      if (PASTEL_FILL.test(line)) fill = { line: line.trim(), at: i + 1 };
      if (WHITE_TEXT.test(line) && fill) {
        offenders.push(`${file}:${fill.at}  ${selector}  ${fill.line}`);
        fill = null;
      }
      if (line.trim() === "}") fill = null;
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `파스텔 채움 + 흰 글자 조합은 AA 에 못 미친다. --hy-accent-cta / --mint-cta / --danger-cta 를 쓰거나\n`
      + `soft 채움 + --hy-accent-text 조합으로 내려야 한다:\n${offenders.join("\n")}`,
  );
});

test("모서리 반경은 8/12/16/20/24px·pill 만 쓴다", () => {
  const SCALE = new Set([0, 8, 12, 16, 20, 24, 999]);
  // UI 표면이 아닌 것들 — 그림(색종이·블롭·orb), 폰 베젤 프레임, 인라인 링크 focus ring.
  const EXEMPT = [/confetti/, /\.pl-blob/, /\.dr-hero__orb\b/, /\.hy-app\b/, /:focus-visible\b/];
  const offenders = [];

  for (const file of CSS_FILES) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let selector = "";
    lines.forEach((line, i) => {
      const open = line.match(/^([^{}]*[^\s{])\s*\{\s*$/);
      if (open) selector = open[1].trim();
      if (!/border(-[a-z]+)*-radius\s*:/.test(line)) return;
      if (EXEMPT.some((re) => re.test(selector))) return;
      for (const m of line.matchAll(/(\d+)px/g)) {
        const px = Number(m[1]);
        if (!SCALE.has(px)) offenders.push(`${file}:${i + 1}  ${selector}  ${px}px`);
      }
    });
  }

  assert.deepEqual(offenders, [], `반경 스케일 이탈:\n${offenders.join("\n")}`);
});

test("선택 가능한 칩의 미선택 상태는 하드코딩 hex 대신 중립 토큰을 쓴다", () => {
  for (const file of ["src/screens/parent/EventForm.tsx", "src/screens/feature/PlaceForm.tsx"]) {
    const src = readFileSync(file, "utf8");
    if (file.endsWith("EventForm.tsx")) {
      // 일정 칩은 공통 CSS가 채움을 정하고 화면은 상태 글자색만 정한다.
      const css = readFileSync("src/screens/parent/EventForm.css", "utf8");
      assert.match(css, /\.ef-chip \{[^}]*background: var\(--control-fill\)/, "일정 칩은 공통 유리 채움 토큰을 사용해야 한다");
      assert.doesNotMatch(src, /background: IDLE_BG/);
    } else {
      assert.match(src, /const IDLE_BG = "var\(--bg-chip-idle\)"/, `${file} 의 미선택 채움은 토큰이어야 한다`);
    }
    assert.match(src, /const IDLE_COLOR = "var\(--fg-tertiary\)"/, `${file} 의 미선택 라벨은 토큰이어야 한다`);
  }
});
