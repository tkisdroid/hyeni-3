/**
 * 출시 화면 버튼 계층 계약.
 * 주요 CTA 52px · 보조 버튼 48px · 아이콘 버튼 44px을 의미 토큰으로 고정한다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const normalizeSelector = (selector) => selector.replace(/\s+/g, " ").trim();

function declarations(relativePath, selector) {
  const source = readSource(relativePath).replace(/\/\*[\s\S]*?\*\//g, "");
  const normalized = normalizeSelector(selector);

  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (normalizeSelector(match[1]) !== normalized) continue;
    return new Map(
      [...match[2].matchAll(/([-\w]+)\s*:\s*([^;]+);/g)].map((item) => [
        item[1],
        item[2].trim(),
      ]),
    );
  }

  assert.fail(`${relativePath}에 정확한 ${normalized} 규칙이 필요합니다`);
}

function tokenValue(name) {
  const match = readSource("src/styles/tokens.css").match(
    new RegExp(`${name.replaceAll("-", "\\-")}\\s*:\\s*([^;]+);`),
  );
  assert.ok(match, `${name} 토큰이 필요합니다`);
  return match[1].trim();
}

const PRIMARY_BUTTONS = [
  ["src/screens/onboarding/Onboarding.css", ".ob-cta"],
  ["src/screens/child/AiFriendSetup.css", ".afs-cta"],
  ["src/screens/feature/AiSchedule.css", ".ais-confirm"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-save"],
  ["src/screens/feature/Feedback.css", ".fb-submit"],
  ["src/screens/feature/FriendPlay.css", ".fp-cta"],
  ["src/screens/feature/FriendPlay.css", ".fp-end"],
  ["src/screens/feature/PhoneSetup.css", ".psu-save"],
  ["src/screens/feature/ProfileEdit.css", ".pe-save"],
  ["src/screens/feature/RouteView.css", ".rv-start"],
  ["src/screens/feature/SosReceive.css", ".sr-confirm"],
  ["src/screens/feature/TrialLock.css", ".tl-cta"],
  ["src/screens/parent/EventForm.css", ".ef-save"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-send"],
  ["src/screens/child/ChildLocationStatus.css", ".cls-cta"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-cta"],
  ["src/screens/child/ChildHome.css", ".kd-next__cta"],
  ["src/screens/feature/AppUpdate.css", ".au-cta"],
  ["src/screens/feature/LocationStatus.css", ".ls-retry"],
  ["src/screens/teacher/TeacherHome.css", ".th-sheet__send"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-sheet__send"],
  ["src/screens/feature/RemoteAudio.css", ".ra-start"],
  ["src/screens/feature/RemoteRing.css", ".rr-cta"],
  ["src/screens/feature/Subscription.css", ".sub-cta"],
  ["src/screens/feature/PairingWizard.css", ".pw-cta"],
  ["src/screens/feature/PlaceForm.css", ".pf-save"],
  ["src/screens/onboarding/Onboarding.css", ".ob-loginbtn"],
  ["src/screens/feature/AiCredit.css", ".ac-save-detail"],
];

test("버튼 높이 토큰은 52px·48px·44px 계층을 유지한다", () => {
  assert.equal(tokenValue("--control-height-primary"), "52px");
  assert.equal(tokenValue("--control-height-secondary"), "48px");
  assert.equal(tokenValue("--control-size-icon"), "44px");
});

test("주요 CTA는 모두 52px 토큰을 쓰고 flex 컨테이너에서 압축되지 않는다", () => {
  for (const [file, selector] of PRIMARY_BUTTONS) {
    const rule = declarations(file, selector);
    assert.equal(
      rule.get("height"),
      "var(--control-height-primary)",
      `${file} ${selector} 높이`,
    );
    assert.equal(rule.get("flex"), "none", `${file} ${selector} flex 압축 방지`);
  }
});

test("온보딩 소셜 버튼은 보조 48px 계층을 유지한다", () => {
  for (const [file, selector] of [
    ["src/screens/onboarding/Onboarding.css", ".ob-social"],
    ["src/screens/feature/DataSync.css", ".ds-sync__btn"],
  ]) {
    const rule = declarations(file, selector);
    assert.equal(rule.get("height"), "var(--control-height-secondary)", `${file} ${selector}`);
    assert.equal(rule.get("flex"), "none", `${file} ${selector}`);
  }
});

test("공통 아이콘 버튼은 네 방향 모두 44px 아이콘 조작 토큰을 쓴다", () => {
  const rule = declarations("src/styles/components.css", ".hy-iconbtn");
  for (const property of ["width", "height", "min-width", "min-height"]) {
    assert.equal(rule.get(property), "var(--control-size-icon)", `.hy-iconbtn ${property}`);
  }
  assert.equal(rule.get("flex"), "none");
});

test("SOS 유지·통화와 원격청취 원형 제어는 목적별 큰 조작 영역을 보존한다", () => {
  const exceptions = [
    ["src/screens/child/ChildSos.css", ".cs-hold", "184px"],
    ["src/screens/child/ChildSos.css", ".cs-callbtn", "60px"],
    ["src/screens/feature/RemoteAudio.css", ".ra-ctrl-stop", "76px"],
    ["src/screens/feature/RemoteAudio.css", ".ra-ctrl-call", "58px"],
  ];

  for (const [file, selector, expectedHeight] of exceptions) {
    const rule = declarations(file, selector);
    assert.equal(rule.get("height"), expectedHeight, `${file} ${selector}`);
    assert.notEqual(rule.get("height"), "var(--control-height-primary)");
  }
});
