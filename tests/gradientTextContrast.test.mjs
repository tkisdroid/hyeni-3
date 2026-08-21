/**
 * CTA 그라디언트·실제 전경색 대비 회귀 계약.
 *
 * 기존 검사는 같은 규칙 안의 단색 채움만 따라가서 그라디언트 stop과 상속된 글자색을
 * 놓쳤다. 이 검사는 토큰을 실제 값으로 펼치고, 모든 stop을 실제 전경색과 대조한다.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const TOKENS_FILE = "src/styles/tokens.css";
const TOKENS = readSource(TOKENS_FILE);
const ACCENTS = ["rose", "peach", "lavender", "mint", "sky", "lemon"];
const AA_BODY = 4.5;
const CSS_FILES = execSync("git ls-files src", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((file) => file.endsWith(".css"));

const normalizeSelector = (selector) => selector.replace(/\s+/g, " ").trim();
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

function parseDeclarations(body) {
  const declarations = new Map();
  for (const match of body.matchAll(/([-\w]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

function parseRules(source) {
  const rules = [];
  for (const match of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selector: normalizeSelector(match[1]),
      declarations: parseDeclarations(match[2]),
    });
  }
  return rules;
}

const ROOT_RULE = parseRules(TOKENS).find((rule) => rule.selector === ":root");
assert.ok(ROOT_RULE, "tokens.css에 :root 선언이 필요합니다");
const ROOT_VARS = Object.fromEntries(
  [...ROOT_RULE.declarations].filter(([name]) => name.startsWith("--")),
);

const ACCENT_VARS = Object.fromEntries(
  ACCENTS.map((accent) => {
    const match = TOKENS.match(
      new RegExp(`\\[data-accent="${accent}"\\]\\s*\\{([^}]*)\\}`),
    );
    assert.ok(match, `${accent} accent 선언이 필요합니다`);
    return [
      accent,
      {
        ...ROOT_VARS,
        ...Object.fromEntries(
          [...parseDeclarations(match[1])].filter(([name]) => name.startsWith("--")),
        ),
      },
    ];
  }),
);

function exactRule(relativePath, selector) {
  const normalized = normalizeSelector(selector);
  const match = parseRules(readSource(relativePath)).find((rule) => rule.selector === normalized);
  assert.ok(match, `${relativePath}에 정확한 ${normalized} 규칙이 필요합니다`);
  return match.declarations;
}

function resolveVars(value, variables) {
  let resolved = value.trim();
  for (let depth = 0; depth < 12 && resolved.includes("var("); depth += 1) {
    const next = resolved.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
      (_whole, name, fallback) => variables[name] ?? fallback?.trim() ?? `var(${name})`,
    );
    if (next === resolved) break;
    resolved = next;
  }
  return resolved;
}

function normalizeHex(value) {
  const hex = value.trim().toLowerCase();
  if (hex === "white") return "#ffffff";
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${[...hex.slice(1)].map((channel) => channel.repeat(2)).join("")}`;
  }
  assert.match(hex, /^#[0-9a-f]{6}$/, `${value}는 계산 가능한 불투명 색상이어야 합니다`);
  return hex;
}

function colorsIn(value) {
  return [...value.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((match) =>
    normalizeHex(match[0]),
  );
}

function luminance(hex) {
  const channels = normalizeHex(hex)
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)];
  const lighter = Math.max(...values);
  const darker = Math.min(...values);
  return (lighter + 0.05) / (darker + 0.05);
}

function variableSetsFor(background) {
  if (background.includes("--cta-grad-accent") || background.includes("--hy-accent-")) {
    return ACCENTS.map((accent) => [accent, ACCENT_VARS[accent]]);
  }
  return [["default", ROOT_VARS]];
}

function assertAccessiblePair(background, foreground, context) {
  for (const [theme, variables] of variableSetsFor(background)) {
    const resolvedBackground = resolveVars(background, variables);
    const resolvedForeground = resolveVars(foreground, variables);
    const foregroundColors = colorsIn(resolvedForeground);
    const stops = colorsIn(resolvedBackground);

    assert.equal(
      foregroundColors.length,
      1,
      `${context}(${theme}) 전경색 ${resolvedForeground}을 하나의 색으로 계산할 수 있어야 합니다`,
    );
    assert.ok(stops.length > 0, `${context}(${theme}) 배경 stop을 계산할 수 있어야 합니다`);

    for (const stop of stops) {
      const ratio = contrastRatio(foregroundColors[0], stop);
      assert.ok(
        ratio >= AA_BODY,
        `${context}(${theme}) ${foregroundColors[0]} / ${stop} = ${ratio.toFixed(2)}:1; 4.5:1 이상이어야 합니다`,
      );
    }
  }
}

const AUDITED_SAME_RULES = [
  ["src/screens/child/AiFriendChat.css", ".afc-bubble--me", "var(--cta-grad-accent)"],
  ["src/screens/child/AiFriendChat.css", ".afc-send", "var(--cta-grad-accent)"],
  // 확인 카드의 실행 버튼(.afc-action 은 병합되지 않은 브랜치 클래스였다 — 2026-08-18 정리).
  ["src/screens/child/AiFriendChat.css", ".afc-confirm__go", "var(--cta-grad-accent)"],
  ["src/screens/child/AiFriendSetup.css", ".afs-cta", "var(--cta-grad-accent)"],
  ["src/screens/child/ChildSos.css", ".cs-root", "var(--cta-grad-danger)"],
  ["src/screens/feature/AiCredit.css", ".ac-buy", "var(--cta-grad-lavender)"],
  ["src/screens/feature/AiSchedule.css", ".ais-confirm", "var(--cta-grad-lavender)"],
  ["src/screens/feature/AppUpdate.css", ".au-cta", "var(--cta-grad-accent)"],
  ["src/screens/feature/ChildInvite.css", ".ci-btn--share", "var(--cta-grad-lavender)"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-save", "var(--cta-grad-danger)"],
  ["src/screens/feature/DaySummary.css", ".ds-panel__cta", "var(--cta-grad-lavender)"],
  ["src/screens/feature/FriendPlay.css", ".fp-cta", "var(--cta-grad-accent)"],
  ["src/screens/feature/LocationStatus.css", ".ls-retry", "var(--cta-grad-info)"],
  ["src/screens/feature/PlaydateAccept.css", ".pa-btn-accept", "var(--cta-grad-mint)"],
  ["src/screens/feature/RemoteAudio.css", ".ra-start", "var(--cta-grad-lavender)"],
  ["src/screens/feature/RemoteRing.css", ".rr-cta", "var(--cta-grad-danger)"],
  ["src/screens/feature/RemoteRing.css", ".rr-modal-confirm", "var(--cta-grad-danger)"],
  ["src/screens/feature/RouteView.css", ".rv-start", "var(--cta-grad-mint)"],
  ["src/screens/feature/RouteView.css", ".rv-empty__home", "var(--cta-grad-mint)"],
  ["src/screens/feature/Subscription.css", ".sub-cta", "var(--cta-grad-accent)"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__cta", "var(--cta-grad-accent)"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__retry", "var(--cta-grad-info)"],
  ["src/screens/teacher/TeacherHome.css", ".th-empty__cta", "var(--cta-grad-mint)"],
  ["src/screens/teacher/TeacherHome.css", ".th-sheet__send", "var(--cta-grad-mint)"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-sheet__send", "var(--cta-grad-mint)"],
  ["src/screens/child/ChildHome.css", ".kd-next__cta", "var(--cta-grad-mint)"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-cta", "var(--cta-grad-accent)"],
  [
    "src/screens/feature/DailySafetyReport.css",
    ".dr-premium button, .dr-primary",
    "var(--cta-grad-lavender)",
  ],
  ["src/screens/feature/SosReceive.css", ".sr-confirm", "var(--cta-grad-mint)"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-primary", "var(--cta-grad-lavender)"],
  [
    "src/screens/shared/MemoChat.css",
    '.mc-root[data-child="true"] .mc-msg--mine .mc-bubble',
    "var(--cta-grad-accent)",
  ],
];

const AUDITED_SPLIT_RULES = [
  {
    file: "src/screens/feature/AiCredit.css",
    backgroundSelector: ".ac-hero",
    foregroundSelectors: [".ac-hero__label", ".ac-hero__num", ".ac-hero__unit"],
    background: "var(--cta-grad-lavender)",
  },
  {
    file: "src/screens/child/ChildSos.css",
    backgroundSelector: ".cs-root",
    foregroundSelectors: [".cs-desc", ".cs-foot", ".cs-result__sub"],
    background: "var(--cta-grad-danger)",
  },
  {
    file: "src/app/ChildDock.css",
    backgroundSelector: ".kdock__sos",
    foregroundSelectors: [".kdock__sos span"],
    background: "var(--cta-grad-danger)",
  },
  {
    file: "src/screens/parent/ParentHome.css",
    backgroundSelector: ".ph-hero",
    foregroundSelectors: [".ph-hero__title", ".ph-hero__title em", ".ph-hero__live"],
    background: "var(--hy-accent-cta)",
  },
  {
    file: "src/screens/onboarding/Onboarding.css",
    backgroundSelector: ".ob-cta--accent",
    foregroundSelectors: [".ob-cta"],
    background: "var(--cta-grad-accent)",
  },
  {
    file: "src/screens/onboarding/Onboarding.css",
    backgroundSelector: ".ob-cta--green",
    foregroundSelectors: [".ob-cta"],
    background: "var(--cta-grad-mint)",
  },
  {
    file: "src/screens/onboarding/Onboarding.css",
    backgroundSelector: ".ob-cta--lav",
    foregroundSelectors: [".ob-cta"],
    background: "var(--cta-grad-lavender)",
  },
  {
    file: "src/screens/child/overlays/ChildSheet.css",
    backgroundSelector: ".ks-cta--go",
    foregroundSelectors: [".ks-cta"],
    background: "var(--cta-grad-mint)",
  },
  {
    file: "src/screens/shared/MemoChat.css",
    backgroundSelector: '.mc-root[data-child="true"] .mc-send',
    foregroundSelectors: [".mc-send"],
    background: "var(--cta-grad-accent)",
  },
  {
    file: "src/screens/feature/TrialLock.css",
    backgroundSelector: ".tl-hero--trial",
    foregroundSelectors: [".tl-hero"],
    background: "var(--cta-grad-lavender)",
  },
  {
    file: "src/screens/feature/TrialLock.css",
    backgroundSelector: ".tl-hero--active",
    foregroundSelectors: [".tl-hero"],
    background: "var(--cta-grad-accent)",
  },
  {
    file: "src/screens/teacher/TeacherHome.css",
    backgroundSelector: ".th-hero",
    foregroundSelectors: [".th-hero__school", ".th-hero__name"],
    background: "var(--cta-grad-mint)",
  },
  {
    file: "src/screens/onboarding/Onboarding.css",
    backgroundSelector: ".ob-survey-card--on .ob-survey-check",
    foregroundSelectors: [".ob-survey-check"],
    background: "var(--hy-accent-cta)",
  },
];

test("CTA 그라디언트 토큰은 모든 stop과 테마에서 흰 라벨 AA를 만족한다", () => {
  for (const name of [
    "--cta-grad-accent",
    "--cta-grad-danger",
    "--cta-grad-lavender",
    "--cta-grad-mint",
    "--cta-grad-info",
  ]) {
    assertAccessiblePair(`var(${name})`, "#fff", name);
  }
});

test("검수한 CTA 규칙은 안전한 그라디언트와 실제 전경색을 함께 유지한다", () => {
  for (const [file, selector, expectedBackground] of AUDITED_SAME_RULES) {
    const declarations = exactRule(file, selector);
    assert.equal(declarations.get("background"), expectedBackground, `${file} ${selector}`);
    const foreground = declarations.get("color");
    assert.ok(foreground, `${file} ${selector}에 실제 전경색이 필요합니다`);
    assertAccessiblePair(expectedBackground, foreground, `${file} ${selector}`);
  }
});

test("배경과 글자색이 서로 다른 규칙에 있어도 실제 조합을 검증한다", () => {
  for (const item of AUDITED_SPLIT_RULES) {
    const backgroundRule = exactRule(item.file, item.backgroundSelector);
    assert.equal(
      backgroundRule.get("background"),
      item.background,
      `${item.file} ${item.backgroundSelector}`,
    );
    for (const foregroundSelector of item.foregroundSelectors) {
      const foreground = exactRule(item.file, foregroundSelector).get("color");
      assert.ok(foreground, `${item.file} ${foregroundSelector}에 실제 전경색이 필요합니다`);
      assertAccessiblePair(
        item.background,
        foreground,
        `${item.file} ${item.backgroundSelector} → ${foregroundSelector}`,
      );
    }
  }
});

test("작은 안내 문구와 보조 버튼은 투명도로 대비를 낮추지 않는다", () => {
  const trialTextSelectors = [".tl-hero__dday", ".tl-hero__sub"];
  for (const selector of trialTextSelectors) {
    const declarations = exactRule("src/screens/feature/TrialLock.css", selector);
    assert.equal(declarations.has("opacity"), false, `${selector}에 반투명 글자를 쓰지 않습니다`);
    assert.equal(declarations.get("color"), "#fff", `${selector}는 불투명 흰색을 사용합니다`);
    assertAccessiblePair(
      "var(--cta-grad-lavender)",
      declarations.get("color"),
      `TrialLock ${selector}`,
    );
    assertAccessiblePair(
      "var(--cta-grad-accent)",
      declarations.get("color"),
      `TrialLock ${selector}`,
    );
  }

  const opaqueDangerSurfaces = [
    [".cs-query-note", "var(--danger-soft)", "var(--danger-text)"],
    [".cs-cancel", "var(--bg-card)", "var(--danger-text)"],
    [".cs-ghost", "var(--bg-card)", "var(--danger-text)"],
  ];
  for (const [selector, expectedBackground, expectedForeground] of opaqueDangerSurfaces) {
    const declarations = exactRule("src/screens/child/ChildSos.css", selector);
    assert.equal(declarations.get("background"), expectedBackground, selector);
    assert.equal(declarations.get("color"), expectedForeground, selector);
    assertAccessiblePair(expectedBackground, expectedForeground, `ChildSos ${selector}`);
  }
});

test("상태·경고·포커스 표식은 흐려지지 않는 의미 토큰을 유지한다", () => {
  assert.equal(
    /\.fc-device--pending\s*\{[^}]*opacity\s*:/s.test(
      readSource("src/screens/feature/FamilyConnection.css"),
    ),
    false,
    "연결 대기 카드는 자식 텍스트까지 함께 흐리지 않습니다",
  );
  assert.equal(
    exactRule("src/screens/feature/WeeklyFamilyReport.css", ".wr-preview__item").has("opacity"),
    false,
    "리포트 미리보기는 카드 전체 opacity로 가독성을 낮추지 않습니다",
  );

  const semanticForegrounds = [
    ["src/screens/parent/ParentFamily.css", ".pf-add__lock-sub", "var(--gold-text)"],
    ["src/screens/feature/Subscription.css", ".sub-active__check", "var(--gold-text)"],
    ["src/screens/feature/Subscription.css", ".sub-benefit__check", "var(--gold-text)"],
    [
      "src/screens/feature/DaySummary.css",
      ".ds-hero--caution .ds-hero__status",
      "var(--gold-text)",
    ],
    [
      "src/screens/feature/DaySummary.css",
      ".ds-hero--caution .ds-hero__date",
      "var(--gold-text)",
    ],
    ["src/screens/feature/FriendPlay.css", ".fp-waiting", "var(--gold-text)"],
    ["src/components/MapPickerSheet.css", ".mps-sel svg", "var(--hy-accent-text)"],
  ];
  for (const [file, selector, expected] of semanticForegrounds) {
    assert.equal(exactRule(file, selector).get("color"), expected, `${file} ${selector}`);
  }

  const adminFocus = [
    "src/screens/admin/AdminAiPrompt.css",
    ".aap-textarea:focus, .aap-textarea:focus-visible",
  ];
  assert.equal(exactRule(...adminFocus).get("outline-color"), "var(--focus-ring-color)");

  // 메시지 입력 중에는 사용자가 요청한 대로 색 테두리를 만들지 않는다. 투명 outline과
  // 입력줄 전체의 중립 명도 링으로 키보드 focus 위치는 계속 구분한다.
  const memoFocus = exactRule(
    "src/screens/shared/MemoChat.css",
    ".mc-input:focus, .mc-input:focus-visible",
  );
  assert.equal(memoFocus.get("outline"), "2px solid transparent");
  assert.match(
    exactRule("src/screens/shared/MemoChat.css", ".mc-inputbar:focus-within").get("box-shadow") ?? "",
    /rgba\(38, 54, 74, 0\.16\)/,
  );

  const parentFamily = readSource("src/screens/parent/ParentFamily.tsx");
  const parentLocation = readSource("src/screens/parent/ParentLocation.tsx");
  assert.match(parentFamily, /<Lock[^>]*color="var\(--gold-text\)"/);
  assert.doesNotMatch(parentFamily, /<Lock[^>]*color="var\(--gold-600\)"/);
  assert.match(parentLocation, /<AlertTriangle[^>]*color="var\(--gold-text\)"/);
  assert.match(parentLocation, /<Crown[^>]*color="var\(--gold-text\)"/);
  assert.doesNotMatch(
    parentLocation,
    /<(?:AlertTriangle|Crown)[^>]*color="var\(--gold-600\)"/,
  );

  assert.match(
    readSource("src/screens/child/ChildTimetable.tsx"),
    /<Check[^>]*color="var\(--mint-text\)"/,
  );
  assert.match(
    readSource("src/screens/feature/PermDenied.tsx"),
    /<BatteryCharging[^>]*color="var\(--mint-text\)"/,
  );
});

test("활성 토글·선택 하트·진행 중 CTA는 밝은 테마에서도 경계를 유지한다", () => {
  for (const [file, selector] of [
    ["src/screens/child/ChildSettings.css", ".ks-toggle.on"],
    ["src/screens/parent/ParentSettings.css", '.ps-switch[data-on="true"]'],
    ["src/screens/feature/NotificationSettings.css", '.nst-switch[data-on="true"]'],
  ]) {
    assert.equal(
      exactRule(file, selector).get("background"),
      "var(--hy-accent-cta)",
      `${file} ${selector}`,
    );
  }

  const aiCredit = readSource("src/screens/feature/AiCredit.tsx");
  assert.equal(
    (aiCredit.match(/\?\s*"var\(--hy-accent-cta\)"\s*:\s*"var\(--line-soft\)"/g) ?? [])
      .length,
    6,
    "AI 설정의 여섯 토글이 모두 고대비 ON 트랙을 사용합니다",
  );
  assert.doesNotMatch(
    aiCredit,
    /\?\s*"var\(--hy-accent\)"\s*:\s*"var\(--line-soft\)"/,
  );

  const feedback = readSource("src/screens/feature/Feedback.css");
  const selectedFeedbackKind = exactRule(
    "src/screens/feature/Feedback.css",
    '.fb-kind[data-selected="true"]',
  );
  assert.equal(selectedFeedbackKind.get("background"), "var(--hy-accent-soft)");
  assert.equal(selectedFeedbackKind.get("color"), "var(--hy-accent-text)");
  assert.doesNotMatch(feedback, /background:\s*var\(--hy-accent\)[\s\S]{0,100}color:\s*(?:white|#fff)/i);

  const remoteRingBusy = exactRule(
    "src/screens/feature/RemoteRing.css",
    '.rr-cta[aria-busy="true"]:disabled',
  );
  assert.equal(remoteRingBusy.get("background"), "var(--cta-grad-danger)");
  assert.equal(remoteRingBusy.get("opacity"), "var(--busy-opacity)");
});

test("전체화면 원격 기능은 상·하단 safe-area를 함께 확보한다", () => {
  for (const [file, idleSelector, activeSelector] of [
    ["src/screens/feature/RemoteAudio.css", ".ra-idle", ".ra-listen"],
    ["src/screens/feature/RemoteRing.css", ".rr-idle", ".rr-ring"],
  ]) {
    const idlePadding = exactRule(file, idleSelector).get("padding");
    const activePadding = exactRule(file, activeSelector).get("padding");
    assert.match(idlePadding, /env\(safe-area-inset-top,\s*0px\)/, `${file} ${idleSelector}`);
    assert.match(
      idlePadding,
      /env\(safe-area-inset-bottom,\s*0px\)/,
      `${file} ${idleSelector}`,
    );
    assert.match(activePadding, /env\(safe-area-inset-top,\s*0px\)/, `${file} ${activeSelector}`);
    assert.match(
      activePadding,
      /env\(safe-area-inset-bottom,\s*0px\)/,
      `${file} ${activeSelector}`,
    );
  }
});

test("단색 CTA와 선택 상태도 전경색에 맞는 AA 전용 토큰을 쓴다", () => {
  const solidPairs = [
    ["src/screens/parent/ChildDetail.css", ".cd-confirm__delete", "var(--danger-cta)", "#fff"],
    [
      "src/screens/teacher/TeacherReleaseGate.css",
      ".trg-dialog__delete",
      "var(--danger-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/parent/ParentSettings.css",
      ".ps-modal__btn--danger",
      "var(--danger-cta)",
      "#fff",
    ],
    [
      "src/components/ChildLocationPermissionDialog.css",
      ".clp-primary",
      "var(--mint-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/teacher/TeacherReleaseGate.css",
      ".trg-primary",
      "var(--mint-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/feature/SosReceive.css",
      ".sr-map__label",
      "var(--danger-cta)",
      "#fff",
    ],
    ["src/screens/feature/SosReceive.css", ".sr-banner", "var(--danger-cta)", "#fff"],
    ["src/screens/feature/SosReceive.css", ".sr-act--call", "var(--danger-cta)", "#fff"],
    [
      "src/screens/feature/RemoteRing.css",
      ".rr-childchip--active",
      "var(--cream-soft)",
      "var(--gold-text)",
    ],
    [
      "src/screens/feature/SosReceive.css",
      ".sr-banner-chip",
      "var(--bg-card)",
      "var(--fg-primary)",
    ],
    ["src/app/ChildDock.css", ".kdock__badge", "var(--hy-accent-cta)", "var(--bg-card)"],
    [
      "src/screens/child/ChildHome.css",
      ".kd-memo-banner__badge",
      "var(--hy-accent-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/child/ChildHome.css",
      ".kd-tile__badge",
      "var(--hy-accent-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/child/StickerBook.css",
      ".sb-slot__new",
      "var(--hy-accent-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/feature/NotificationSettings.css",
      ".nst-quiet__apply",
      "var(--hy-accent-cta)",
      "var(--bg-card)",
    ],
    [
      "src/screens/feature/RemoteRing.css",
      ".rr-modal-cancel",
      "var(--bg-body)",
      "var(--fg-secondary)",
    ],
    [
      "src/screens/feature/RemoteRing.css",
      ".rr-stop",
      "#fff",
      "var(--danger-text)",
    ],
    [
      "src/screens/feature/ChildInvite.css",
      ".ci-btn--copy",
      "var(--rose-soft)",
      "var(--rose-text)",
    ],
    [
      "src/screens/feature/RouteView.css",
      ".rv-step__num--pink",
      "var(--rose-soft)",
      "var(--rose-text)",
    ],
    [
      "src/screens/parent/ParentLocation.css",
      ".pl-journey__order",
      "var(--mint-cta)",
      "#fff",
    ],
    [
      "src/styles/components.css",
      '.hy-tab[data-active="true"] .hy-tab__icon',
      "var(--hy-accent-soft)",
      "var(--hy-accent-text)",
    ],
    [
      "src/screens/onboarding/Onboarding.css",
      ".ob-social--naver",
      "#00843c",
      "#fff",
    ],
    [
      "src/screens/teacher/TeacherHome.css",
      ".th-hero__attend",
      "var(--mint-text)",
      "#fff",
    ],
    [
      "src/screens/parent/ParentCalendar.css",
      ".pc-btn--danger",
      "var(--danger-cta)",
      "#fff",
    ],
    [
      "src/screens/parent/ParentCalendar.css",
      ".pc-event__child--warn",
      "var(--cream-soft)",
      "var(--gold-text)",
    ],
  ];

  for (const [file, selector, expectedBackground, expectedForeground] of solidPairs) {
    const declarations = exactRule(file, selector);
    assert.equal(declarations.get("background"), expectedBackground, `${file} ${selector}`);
    assert.equal(declarations.get("color"), expectedForeground, `${file} ${selector}`);
    assertAccessiblePair(expectedBackground, expectedForeground, `${file} ${selector}`);
  }

  assert.equal(
    exactRule("src/screens/feature/SosReceive.css", ".sr-banner-meta").has("opacity"),
    false,
    "긴급 배너 보조 문구에 반투명도를 적용하지 않습니다",
  );
  assert.equal(
    exactRule("src/screens/shared/MemoChat.css", ".mc-daysep span").get("color"),
    "var(--fg-secondary)",
    "반투명 날짜 구분면에는 더 진한 보조 문구 토큰을 사용합니다",
  );
  for (const [file, selector] of [
    ["src/screens/shared/MemoChat.css", ".mc-loc-title"],
  ]) {
    assert.equal(
      exactRule(file, selector).has("opacity"),
      false,
      `${file} ${selector}는 상속된 안전 색상을 반투명화하지 않습니다`,
    );
  }

  const surfaceTextPairs = [
    ["src/screens/teacher/TeacherHome.css", ".th-viewall", "var(--mint-text)"],
    ["src/screens/teacher/TeacherStudents.css", ".ts-meta__count", "var(--mint-text)"],
    ["src/screens/teacher/TeacherTimetable.css", ".tt-meta__count", "var(--mint-text)"],
    [
      "src/screens/teacher/TeacherTimetable.css",
      ".tt-day-chip--today .tt-day-chip__dow",
      "var(--mint-text)",
    ],
  ];
  for (const [file, selector, expectedForeground] of surfaceTextPairs) {
    const foreground = exactRule(file, selector).get("color");
    assert.equal(foreground, expectedForeground, `${file} ${selector}`);
    assertAccessiblePair("var(--bg-card)", foreground, `${file} ${selector}`);
  }

  const activeStayBackground = exactRule(
    "src/screens/parent/ParentLocation.css",
    ".pl-journey__stay--selected .pl-journey__order",
  ).get("background");
  assert.equal(activeStayBackground, "var(--mint-text)");
  assertAccessiblePair(activeStayBackground, "#fff", "ParentLocation active stay number");

  const remoteSquareBackground = exactRule(
    "src/screens/feature/RemoteRing.css",
    ".rr-stop-square",
  ).get("background");
  assert.equal(remoteSquareBackground, "var(--danger-text)");
  assertAccessiblePair("#fff", remoteSquareBackground, "RemoteRing stop square");

  const remoteCallBackground = exactRule(
    "src/screens/feature/RemoteAudio.css",
    ".ra-ctrl-call",
  ).get("background");
  assert.equal(remoteCallBackground, "var(--mint-cta)");
  assert.match(
    readSource("src/screens/feature/RemoteAudio.tsx"),
    /className="ra-ctrl-call[\s\S]*?<Phone[^>]*color="#fff"/,
  );
  assertAccessiblePair(remoteCallBackground, "#fff", "RemoteAudio call icon");

  const accentCheckSurfaces = [
    ["src/screens/child/ChildHome.css", '.kd-prep__check[data-done="true"]'],
    [
      "src/screens/parent/ParentHome.css",
      '.ph-prep-check.ph-neu-control[data-done="true"]',
    ],
    [
      "src/screens/child/overlays/ChildSheet.css",
      '.ks-friend[aria-pressed="true"] .ks-friend__check',
    ],
    ["src/screens/feature/PairingWizard.css", ".pw-photo__edit"],
    ["src/screens/feature/ProfileEdit.css", ".pe-photo__edit"],
  ];
  for (const [file, selector] of accentCheckSurfaces) {
    const background = exactRule(file, selector).get("background");
    assert.equal(background, "var(--hy-accent-cta)", `${file} ${selector}`);
    assertAccessiblePair(background, "#fff", `${file} ${selector}`);
  }

  for (const file of [
    "src/screens/child/ChildHome.tsx",
    "src/screens/parent/ParentHome.tsx",
    "src/screens/feature/Supplies.tsx",
    "src/screens/child/overlays/PlaydateSheet.tsx",
    "src/screens/onboarding/Onboarding.tsx",
  ]) {
    const source = readSource(file);
    assert.doesNotMatch(
      source,
      /background:\s*[^,\n]*\?\s*"var\(--hy-accent\)"\s*:/,
      `${file}의 선택 완료 면에 밝은 accent 채움을 쓰지 않습니다`,
    );
  }
  assert.match(
    readSource("src/screens/feature/Supplies.tsx"),
    /background:\s*s\.done\s*\?\s*"var\(--hy-accent-cta\)"/,
  );
  assert.match(
    readSource("src/screens/onboarding/Onboarding.tsx"),
    /background:\s*gender === g\.value\s*\?\s*"var\(--hy-accent-cta\)"/,
  );

  const pulsePairs = [
    [
      "src/screens/feature/RemoteAudio.css",
      ".ra-pulse-core",
      "radial-gradient(circle at 50% 40%, var(--danger-cta), var(--danger-text))",
    ],
    [
      "src/screens/feature/RemoteAudio.css",
      '.ra-listen[data-receiving="false"] .ra-pulse-core',
      "radial-gradient(circle at 50% 40%, var(--lav-600), var(--lav-text))",
    ],
    [
      "src/screens/feature/RemoteRing.css",
      ".rr-pulse-core",
      "radial-gradient(circle at 50% 40%, var(--danger-cta), var(--danger-text))",
    ],
  ];
  for (const [file, selector, expectedBackground] of pulsePairs) {
    const background = exactRule(file, selector).get("background");
    assert.equal(background, expectedBackground, `${file} ${selector}`);
    assertAccessiblePair(background, "#fff", `${file} ${selector} white icon`);
  }
});

test("선택 칩·리본은 밝은 채움과 진한 문구 토큰을 짝지어 쓴다", () => {
  const pairs = [
    {
      file: "src/screens/child/AiFriendSetup.css",
      backgroundSelector: ".afs-chip--on",
      foregroundSelector: ".afs-chip--on",
      background: "var(--hy-accent-soft)",
      foreground: "var(--hy-accent-text)",
    },
    {
      file: "src/screens/feature/Subscription.css",
      backgroundSelector: ".sub-plan__ribbon",
      foregroundSelector: ".sub-plan__ribbon",
      background: "var(--rose-soft)",
      foreground: "var(--rose-text)",
    },
    {
      file: "src/screens/teacher/TeacherTimetable.css",
      backgroundSelector: ".tt-day-chip--on",
      foregroundSelector:
        ".tt-day-chip--on .tt-day-chip__dow, .tt-day-chip--on .tt-day-chip__num",
      background: "var(--mint-soft)",
      foreground: "var(--mint-text)",
    },
  ];

  for (const pair of pairs) {
    const background = exactRule(pair.file, pair.backgroundSelector).get("background");
    const foreground = exactRule(pair.file, pair.foregroundSelector).get("color");
    assert.equal(background, pair.background, `${pair.file} ${pair.backgroundSelector}`);
    assert.equal(foreground, pair.foreground, `${pair.file} ${pair.foregroundSelector}`);
    assertAccessiblePair(background, foreground, `${pair.file} soft pair`);
  }
});

test("활성 CSS의 같은 규칙 안에 있는 그라디언트와 글자색을 전수 계산한다", () => {
  const checked = [];

  for (const file of CSS_FILES) {
    for (const rule of parseRules(readSource(file))) {
      if (rule.selector.includes(":disabled")) continue;
      const background =
        rule.declarations.get("background") ?? rule.declarations.get("background-image");
      const foreground = rule.declarations.get("color");
      if (!background || !foreground) continue;

      const namedCta = /var\(--cta-grad-/.test(background);
      const inlineWhite =
        /linear-gradient\(/.test(background) &&
        /^(?:#fff(?:fff)?|white|var\(--bg-card\))$/i.test(foreground);
      if (!namedCta && !inlineWhite) continue;

      const resolvedStops = colorsIn(resolveVars(background, ROOT_VARS));
      if (!namedCta && resolvedStops.length === 0) continue;
      assertAccessiblePair(background, foreground, `${file} ${rule.selector}`);
      checked.push(`${file} ${rule.selector}`);
    }
  }

  assert.ok(checked.length >= 40, `그라디언트+전경색 검사 범위가 축소되었습니다: ${checked.length}개`);
});

test("검사기는 과거 파스텔 그라디언트 위 흰 글자 실패를 실제로 검출한다", () => {
  assert.throws(
    () =>
      assertAccessiblePair(
        "linear-gradient(120deg, #b79dfb, #8b6bec)",
        "#fff",
        "회귀 fixture",
      ),
    /4\.5:1 이상/,
  );
});
