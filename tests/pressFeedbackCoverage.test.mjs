import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

/** 선택자 하나의 본문만 꺼낸다(다른 규칙이 섞이지 않게). */
const rule = (css, selector) => {
  const index = css.indexOf(selector + " {");
  assert.notEqual(index, -1, `${selector} 규칙이 없다`);
  return css.slice(index, css.indexOf("}", index));
};

test("눌림 피드백 기본 도구는 토큰과 최소 터치 크기를 함께 준다", () => {
  const components = read("src/styles/components.css");
  const tokens = read("src/styles/tokens.css");

  assert.match(rule(components, ".hy-press"), /min-height: var\(--control-min-size\)/);
  // 2026-09-26: 누를 땐 90ms 로 즉시 들어가고, 뗄 땐 스프링(--easing-cheer)으로 살짝 튀어 돌아온다.
  assert.match(rule(components, ".hy-press"), /transition:\s*transform 0\.36s var\(--easing-cheer\)/);
  const enabledPress = '.hy-press:active:not(:disabled):not([aria-disabled="true"]):not([aria-busy="true"])';
  assert.match(rule(components, enabledPress), /transform: scale\(var\(--press, 0\.97\)\)/);
  assert.match(rule(components, enabledPress), /transition-duration: 0\.09s/);
  assert.match(tokens, /--duration-fast:/);
  assert.match(tokens, /--easing-standard:/);
});

test("토글 스위치는 켜짐 이동과 별개로 누르는 순간 노브를 눌러 보여준다", () => {
  // 스위치는 hy-press(전체 축소)를 쓰면 트랙이 흔들려 보이므로 노브만 눌린다.
  const location = read("src/screens/feature/LocationSettings.css");
  assert.match(rule(location, ".lset-toggle:active .lset-toggle__knob"), /transform: scale\(0\.9\)/);
  assert.match(
    rule(location, '.lset-toggle[data-on="true"]:active .lset-toggle__knob'),
    /transform: translateX\(18px\) scale\(0\.9\)/,
  );

  const danger = read("src/screens/feature/DangerZoneForm.css");
  assert.match(rule(danger, ".dzf-toggle:active .dzf-toggle__knob"), /transform: scale\(0\.9\)/);
  assert.match(
    rule(danger, '.dzf-toggle[data-on="true"]:active .dzf-toggle__knob'),
    /transform: translateX\(18px\) scale\(0\.9\)/,
  );

  const notice = read("src/screens/teacher/TeacherNotice.css");
  assert.match(rule(notice, ".tn-toggle:active .tn-toggle__knob"), /transform: scale\(0\.9\)/);
  assert.match(
    rule(notice, ".tn-toggle--on:active .tn-toggle__knob"),
    /transform: translateX\(20px\) scale\(0\.9\)/,
  );

  const credit = read("src/screens/feature/AiCredit.css");
  assert.match(rule(credit, ".ac-toggle:active .ac-toggle__knob"), /transform: scale\(0\.9\)/);
  // 노브가 transform 으로 눌리려면 transition 에 transform 도 있어야 한다.
  assert.match(rule(credit, ".ac-toggle__knob"), /transform var\(--duration-fast\)/);
});

test("문장 안 글자 버튼도 눌린 걸 알린다", () => {
  const parentHome = read("src/screens/parent/ParentHome.css");
  assert.match(rule(parentHome, ".ph-prep-edit:active"), /transform: scale\(0\.94\)/);
  assert.match(rule(parentHome, ".ph-prep-edit:active"), /opacity: 0\.75/);

  const notifications = read("src/screens/feature/NotificationSettings.css");
  assert.match(rule(notifications, ".nst-refresh:active"), /opacity: 0\.55/);
  assert.match(rule(notifications, ".nst-refresh"), /transition: opacity var\(--duration-fast\)/);

  const releaseGate = read("src/screens/teacher/TeacherReleaseGate.css");
  assert.match(rule(releaseGate, ".trg-legal button:active"), /opacity: 0\.55/);
});

test("전역 reduced-motion 이 새 눌림 전환도 함께 줄인다", () => {
  const global = read("src/styles/global.css");
  const reduced = global.slice(global.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /transition-duration: 0\.001ms !important/);
  assert.match(reduced, /animation-duration: 0\.001ms !important/);
});

test("닫기용 투명 스크림은 눌림 피드백을 갖지 않는다", () => {
  // 보이지 않는 닫기 영역이 눌려 보이면 무엇이 눌렸는지 오해를 준다(의도된 제외).
  const scrims = [
    ["src/screens/parent/ParentCalendar.css", ".pc-scrim"],
    ["src/screens/parent/ParentAccount.css", ".pa-modal__scrim"],
    ["src/screens/parent/ParentSettings.css", ".ps-modal__scrim"],
    ["src/components/MapPickerSheet.css", ".mps-scrim"],
  ];
  for (const [path, selector] of scrims) {
    const css = read(path);
    assert.ok(css.includes(selector), `${selector} 가 ${path} 에 있어야 한다`);
    assert.ok(
      !new RegExp(`\\${selector}(?![a-zA-Z0-9_-])[^{}]*:active`).test(css),
      `${selector} 에는 눌림 피드백을 주지 않는다`,
    );
  }
});
