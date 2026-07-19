import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(path) {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

test("대화의 네트워크 프로필·첨부 이미지는 지연 로드와 비동기 디코딩을 쓴다", () => {
  const memo = source("src/screens/shared/MemoChat.tsx");
  const imageTags = [
    /<img\s+src=\{peer\.avatar\}[^>]*>/,
    /<img\s+src=\{sender\?\.avatar \?\? peer\.avatar\}[^>]*>/,
    /<img\s+src=\{childPhotoProxyUrl\(m\.imagePath\) \?\? undefined\}[^>]*>/,
    /<img\s+src=\{childPhotoProxyUrl\(previewImagePath\) \?\? undefined\}[^>]*>/,
  ];

  for (const pattern of imageTags) {
    const tag = pattern.exec(memo)?.[0] ?? "";
    assert.match(tag, /loading="lazy"/, `lazy 누락: ${pattern}`);
    assert.match(tag, /decoding="async"/, `async decoding 누락: ${pattern}`);
  }
});

test("가족 화면의 네트워크 프로필 이미지는 지연 로드와 비동기 디코딩을 쓴다", () => {
  const family = source("src/screens/parent/ParentFamily.tsx");
  for (const expression of ["p.avatar", "c.avatar"]) {
    const tag = new RegExp(`<img\\s+src=\\{avatarSrc\\(${expression.replace(".", "\\.")}\\)\\}[^>]*>`).exec(family)?.[0] ?? "";
    assert.match(tag, /loading="lazy"/, `${expression} lazy 누락`);
    assert.match(tag, /decoding="async"/, `${expression} async decoding 누락`);
  }
});

test("네트워크 이미지 슬롯은 다운로드 전에도 크기와 비율을 예약한다", () => {
  const memoCss = source("src/screens/shared/MemoChat.css");
  const familyCss = source("src/screens/parent/ParentFamily.css");
  const slots = [
    [memoCss, ".mc-peer-avatar img"],
    [memoCss, ".mc-msg-avatar img"],
    [memoCss, ".mc-bubble--img img"],
    [memoCss, ".mc-photo-preview__panel > img"],
    [familyCss, ".pf-parent__avatar img"],
    [familyCss, ".pf-child__avatar img"],
  ];

  for (const [css, selector] of slots) {
    assert.match(cssBlock(css, selector), /aspect-ratio:\s*[^;]+;/, `${selector} aspect-ratio 누락`);
  }
});

test("첫 viewport의 온보딩 hero와 역할 이미지는 eager 계약을 유지한다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const tags = [
    /<img\s+src=\{asset\("mascot\/wave\.webp"\)\}\s+alt="혜니캘린더"[^>]*>/,
    /<img\s+className="ob-role-img"\s+src=\{asset\(ROLE_ICON_ASSETS\.parent\)\}[^>]*>/,
    /<img\s+className="ob-role-img ob-role-img--child"\s+src=\{asset\(ROLE_ICON_ASSETS\.child\)\}[^>]*>/,
  ];

  for (const pattern of tags) {
    const tag = pattern.exec(onboarding)?.[0] ?? "";
    assert.match(tag, /loading="eager"/, `eager 누락: ${pattern}`);
    assert.match(tag, /decoding="async"/, `async decoding 누락: ${pattern}`);
    assert.doesNotMatch(tag, /loading="lazy"/);
  }
});
