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

test("대화 목록은 아바타를 지연하고 private 첨부는 viewport lease로 요청 범위를 제한한다", () => {
  const memo = source("src/screens/shared/MemoChat.tsx");
  const avatar = /<img\s+src=\{sender\?\.avatar \?\? peer\.avatar\}[^>]*>/s.exec(memo)?.[0] ?? "";
  assert.match(avatar, /loading="lazy"/);
  assert.match(avatar, /decoding="async"/);

  assert.match(
    memo,
    /<MemoImageBubble\s+path=\{m\.imagePath\}\s+press=\{imagePress\}\s+isChildSession=\{isChildSession\}\s+onOpen=\{\(\) => setPreviewImagePath\(m\.imagePath \?\? null\)\}\s+\/>/,
  );
  assert.match(memo, /new IntersectionObserver\(/);
  assert.match(memo, /rootMargin: "360px 0px"/);
  const privateImage = /<img\s+src=\{photo\.url\}[^>]*>/s.exec(memo)?.[0] ?? "";
  const previewImage = /<img\s+src=\{previewImage\.url\}[^>]*>/s.exec(memo)?.[0] ?? "";
  assert.match(privateImage, /decoding="async"/);
  assert.match(privateImage, /alt=\{intl\.formatMessage\(\{ id: "shared\.memo\.photo\.alt" \}\)\}/);
  assert.match(previewImage, /decoding="async"/);
});

test("대화 첫 화면 헤더 아바타는 즉시 요청하고 비동기 디코딩을 쓴다", () => {
  const memo = source("src/screens/shared/MemoChat.tsx");
  const tag = /<img\s+src=\{peer\.avatar\}[^>]*>/.exec(memo)?.[0] ?? "";
  assert.match(tag, /loading="eager"/);
  assert.match(tag, /decoding="async"/);
  assert.doesNotMatch(tag, /fetchPriority="high"/);
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
    // 확대 보기는 핀치/팬을 처리하는 stage 가 공간을 예약한다(이미지는 그 안에서 transform).
    [memoCss, ".mc-photo-preview__stage"],
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
    /<img\s+src=\{asset\("mascot\/wave\.webp"\)\}\s+alt=\{intl\.formatMessage\(\{ id: "core\.brand\.name" \}\)\}[^>]*>/,
    /<img\s+className="ob-role-img"\s+src=\{asset\(ROLE_ICON_ASSETS\.parent\)\}[^>]*>/,
    /<img\s+className="ob-role-img ob-role-img--child"\s+src=\{asset\(ROLE_ICON_ASSETS\.child\)\}[^>]*>/,
    /<img\s+className="ob-role-img"\s+src=\{asset\(ROLE_ICON_ASSETS\.teacher\)\}[^>]*>/,
  ];

  for (const pattern of tags) {
    const tag = pattern.exec(onboarding)?.[0] ?? "";
    assert.match(tag, /loading="eager"/, `eager 누락: ${pattern}`);
    assert.match(tag, /decoding="async"/, `async decoding 누락: ${pattern}`);
    assert.doesNotMatch(tag, /loading="lazy"/);
  }
});

test("역할 선택의 선생님 이미지는 아이콘 슬롯 밖으로 잘리지 않는다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const onboardingCss = source("src/screens/onboarding/Onboarding.css");
  const slot = cssBlock(onboardingCss, ".ob-role-ic");
  const teacher = cssBlock(onboardingCss, ".ob-role-ic--teacher .ob-role-img");

  assert.match(
    onboarding,
    /<span className="ob-role-ic ob-role-ic--teacher">\s*<img\s+className="ob-role-img"\s+src=\{asset\(ROLE_ICON_ASSETS\.teacher\)\}/s,
    "선생님 이미지가 전용 크롭 방지 슬롯 안에 있어야 합니다",
  );

  const px = (body, property) => {
    const match = new RegExp(`${property}:\\s*(\\d+)px`).exec(body);
    assert.ok(match, `${property} 선언을 찾지 못했습니다`);
    return Number(match[1]);
  };

  assert.equal(px(teacher, "width"), px(slot, "width"), "선생님 이미지 너비는 슬롯과 같아야 합니다");
  assert.equal(px(teacher, "height"), px(slot, "height"), "선생님 이미지 높이는 슬롯과 같아야 합니다");
  assert.match(teacher, /object-fit:\s*contain\s*;/, "선생님 원본 전체를 보존해야 합니다");
  assert.match(teacher, /object-position:\s*center\s+top\s*;/, "선생님 머리 위쪽을 고정해야 합니다");
});

test("콜드스타트 스플래시 LCP 이미지는 즉시 높은 우선순위로 요청한다", () => {
  const splash = source("src/screens/Splash.tsx");
  const tag = /<img\b(?=[^>]*className="sp-mascot")[^>]*>/s.exec(splash)?.[0] ?? "";
  assert.match(tag, /loading="eager"/);
  assert.match(tag, /decoding="async"/);
  assert.match(tag, /fetchPriority="high"/);
});

test("프로필 편집 첫 화면의 저장 사진은 즉시 요청하되 LCP 우선순위를 점유하지 않는다", () => {
  const profile = source("src/screens/feature/ProfileEdit.tsx");
  const tag = /<img\s+src=\{previewSrc\}[^>]*>/.exec(profile)?.[0] ?? "";
  assert.match(tag, /loading="eager"/);
  assert.match(tag, /decoding="async"/);
  assert.doesNotMatch(tag, /fetchPriority="high"/);
});

test("안심리포트 이미지는 첫 hero만 high priority이고 나머지는 명시적으로 지연한다", () => {
  const report = source("src/screens/feature/DailySafetyReport.tsx");
  const tags = report.match(/<img\b[\s\S]*?\/>/g) ?? [];
  assert.ok(tags.length >= 20, "안심리포트 이미지 전수 계약이 사라짐");
  for (const tag of tags) {
    assert.match(tag, /loading="(?:eager|lazy)"/, `loading 힌트 누락: ${tag}`);
    assert.match(tag, /decoding="async"/, `async decoding 누락: ${tag}`);
  }
  const highPriority = tags.filter((tag) => /fetchPriority="high"/.test(tag));
  assert.equal(highPriority.length, 1);
  assert.match(highPriority[0], /loading="eager"/);
});
