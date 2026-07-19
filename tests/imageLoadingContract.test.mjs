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

function imageTagForExpression(body, expression) {
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<img\\b(?=[^>]*\\bsrc=\\{${escaped}\\})[^>]*>`, "s").exec(body)?.[0] ?? "";
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

test("출시 화면의 동적 가족 아바타는 첫 viewport와 목록 위치에 맞는 로딩 우선순위를 쓴다", () => {
  const eagerInventory = [
    ["src/screens/parent/ParentLocation.tsx", [
      "avatarSrc(childAvatarPath(selected.photo_url))",
      "avatarSrc(childAvatar)",
    ]],
    ["src/screens/parent/ChildDetail.tsx", ["avatarSrc(avatar)"]],
    ["src/screens/parent/ParentSettings.tsx", ["profileAvatar"]],
    ["src/screens/feature/RemoteRing.tsx", ["childAvatar"]],
    ["src/screens/child/ChildSettings.tsx", ["avatarSrc(childAvatarPath(me?.photo_url))"]],
  ];
  const lazyInventory = [
    ["src/screens/parent/ParentHome.tsx", ["avatarSrc(c.avatar)"]],
    ["src/screens/feature/FamilyConnection.tsx", [
      "avatarSrc(avatar)",
      "avatarSrc(avatarFor(c.id).avatar)",
    ]],
    ["src/screens/feature/StickerSend.tsx", ["avatarSrc(childAvatarPath(c.photo_url))"]],
  ];

  for (const [file, expressions] of eagerInventory) {
    const body = source(file);
    for (const expression of expressions) {
      const tag = imageTagForExpression(body, expression);
      assert.ok(tag, `${file}: ${expression} 이미지가 전수 목록에서 사라짐`);
      assert.match(tag, /className="[^"]*hy-network-avatar[^"]*"/, `${file}: ${expression} 비율 클래스 누락`);
      assert.match(tag, /loading="eager"/, `${file}: ${expression} first viewport eager 누락`);
      assert.match(tag, /decoding="async"/, `${file}: ${expression} async decoding 누락`);
    }
  }

  for (const [file, expressions] of lazyInventory) {
    const body = source(file);
    for (const expression of expressions) {
      const tag = imageTagForExpression(body, expression);
      assert.ok(tag, `${file}: ${expression} 이미지가 전수 목록에서 사라짐`);
      assert.match(tag, /className="[^"]*hy-network-avatar[^"]*"/, `${file}: ${expression} 비율 클래스 누락`);
      assert.match(tag, /loading="lazy"/, `${file}: ${expression} below-fold lazy 누락`);
      assert.match(tag, /decoding="async"/, `${file}: ${expression} async decoding 누락`);
      assert.doesNotMatch(tag, /fetchPriority="high"/, `${file}: ${expression} 목록 이미지가 high priority를 점유하면 안 됨`);
    }
  }

  const remoteRing = source("src/screens/feature/RemoteRing.tsx");
  const remoteRingHero = imageTagForExpression(remoteRing, "childAvatar");
  assert.match(remoteRingHero, /fetchPriority="high"/, "실제 LCP 후보인 원격 울림 hero만 high priority여야 합니다");
  for (const [file, expressions] of eagerInventory.filter(([file]) => file !== "src/screens/feature/RemoteRing.tsx")) {
    const body = source(file);
    for (const expression of expressions) {
      assert.doesNotMatch(
        imageTagForExpression(body, expression),
        /fetchPriority="high"/,
        `${file}: ${expression}은 LCP high priority 대상이 아닙니다`,
      );
    }
  }

  const components = source("src/styles/components.css");
  assert.match(cssBlock(components, ".hy-network-avatar"), /aspect-ratio:\s*1\s*\/\s*1\s*;/);
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
