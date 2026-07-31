import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const tokens = readSource("src/styles/tokens.css");
const globalCss = readSource("src/styles/global.css");
const components = readSource("src/styles/components.css");
const loadingCss = readSource("src/components/ui/Loading.css");
const componentSpec = readSource("design-system/spec/COMPONENTS.md");
const brand = readSource("design-system/brand/BRAND.md");
const readme = readSource("design-system/README.md");

function customProperty(source, name) {
  const match = source.match(new RegExp(`${name.replaceAll("-", "\\-")}\\s*:\\s*([^;]+);`));
  assert.ok(match, `${name} 토큰이 필요합니다`);
  return match[1].trim();
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test("9단계 타이포 토큰은 승인된 크기·행간·굵기를 함께 제공한다", () => {
  const typeScale = {
    display: ["32px", "1.2", "800"],
    "title-xl": ["24px", "1.25", "800"],
    "title-lg": ["20px", "1.3", "800"],
    title: ["18px", "1.35", "700"],
    "body-lg": ["16px", "1.5", "600"],
    body: ["15px", "1.5", "500"],
    "body-sm": ["14px", "1.45", "500"],
    label: ["13px", "1.4", "700"],
    caption: ["12px", "1.4", "600"],
  };

  for (const [role, [size, lineHeight, weight]] of Object.entries(typeScale)) {
    assert.equal(customProperty(tokens, `--type-${role}`), size);
    assert.equal(customProperty(tokens, `--type-${role}-line-height`), lineHeight);
    assert.equal(customProperty(tokens, `--type-${role}-weight`), weight);
  }
});

test("간격·radius·shadow·아이콘 primitive가 작은 정본 척도로 제한된다", () => {
  for (const value of [2, 4, 8, 12, 16, 20, 24, 32, 40, 48]) {
    assert.equal(customProperty(tokens, `--spacing-${value}`), `${value}px`);
  }
  for (const value of [8, 12, 16, 20, 24]) {
    assert.equal(customProperty(tokens, `--radius-${value}`), `${value}px`);
  }
  assert.equal(customProperty(tokens, "--radius-pill"), "999px");

  for (const name of ["soft", "floating", "modal"]) {
    assert.notEqual(customProperty(tokens, `--shadow-${name}`), "");
  }
  for (const value of [16, 18, 20, 22, 24]) {
    assert.equal(customProperty(tokens, `--icon-${value}`), `${value}px`);
  }
});

test("보조 글자와 placeholder는 카드·앱 배경에서 WCAG AA 대비를 충족한다", () => {
  const backgrounds = [customProperty(tokens, "--bg-card"), customProperty(tokens, "--bg-app")];
  const foregrounds = [
    customProperty(tokens, "--fg-muted"),
    customProperty(tokens, "--fg-placeholder"),
  ];

  for (const foreground of foregrounds) {
    for (const background of backgrounds) {
      assert.ok(
        contrastRatio(foreground, background) >= 4.5,
        `${foreground} / ${background} 대비가 4.5:1 미만입니다`,
      );
    }
  }
});

test("전역 본문·focus·placeholder·disabled·busy 상태가 의미 토큰을 공유한다", () => {
  assert.match(globalCss, /body\s*\{[^}]*line-height:\s*var\(--type-body-line-height\)/s);
  assert.match(globalCss, /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--focus-ring-color\)/s);
  assert.match(globalCss, /::placeholder[^}]*color:\s*var\(--fg-placeholder\)/s);
  assert.match(globalCss, /:disabled[^}]*cursor:\s*not-allowed/s);
  assert.match(globalCss, /\[aria-disabled="true"\][^}]*opacity:\s*var\(--disabled-opacity\)/s);
  assert.match(globalCss, /\[aria-busy="true"\][^}]*opacity:\s*var\(--busy-opacity\)\s*!important[^}]*cursor:\s*progress\s*!important/s);
});

test("공통 버튼·카드·로더는 44px와 절제된 카드 언어를 사용한다", () => {
  assert.match(components, /\.hy-iconbtn\s*\{[^}]*width:\s*var\(--control-size-icon\)[^}]*height:\s*var\(--control-size-icon\)/s);
  assert.match(components, /\.hy-btn\s*\{[^}]*min-width:\s*var\(--control-min-size\)[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(components, /\.hy-card\s*\{[^}]*border-radius:\s*var\(--radius-16\)[^}]*box-shadow:\s*none/s);
  assert.match(components, /\.hy-loading\s*\{[^}]*gap:\s*var\(--spacing-8\)/s);
  assert.equal(customProperty(tokens, "--control-min-size"), "44px");
  assert.equal(customProperty(tokens, "--control-size-icon"), "44px");
});

test("실제 로더 모듈은 공통 간격·타이포 토큰을 덮어쓰지 않는다", () => {
  assert.match(loadingCss, /\.hy-loading\s*\{[^}]*gap:\s*var\(--spacing-8\)[^}]*padding:\s*var\(--spacing-20\) 0/s);
  assert.match(loadingCss, /\.hy-loading__label\s*\{[^}]*font-size:\s*var\(--type-label\)/s);
  assert.match(loadingCss, /\.hy-loading__label\s*\{[^}]*line-height:\s*var\(--type-label-line-height\)/s);
});

test("디자인 문서는 42px 모순 없이 런타임 정본 척도를 기록한다", () => {
  const documents = `${componentSpec}\n${brand}\n${readme}`;
  assert.doesNotMatch(componentSpec, /\b42(?:px)?\b/);
  assert.match(documents, /최소 터치[^\n]*44(?:px|×44)/);
  assert.match(readme, /런타임 정본[^\n]*src\/styles\/tokens\.css/);
  assert.match(readme, /32 \/ 24 \/ 20 \/ 18 \/ 16 \/ 15 \/ 14 \/ 13 \/ 12/);
  assert.match(readme, /2 \/ 4 \/ 8 \/ 12 \/ 16 \/ 20 \/ 24 \/ 32 \/ 40 \/ 48/);
  assert.match(readme, /16 \/ 18 \/ 20 \/ 22 \/ 24/);
});
