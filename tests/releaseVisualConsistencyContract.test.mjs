import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(path) {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

test("작은 유틸리티 아이콘은 16·18·20·22px와 2.2·2.4 stroke 척도를 쓴다", () => {
  const tabBar = source("src/app/TabBar.tsx");
  const offline = source("src/components/ui/OfflineBanner.tsx");
  const picker = source("src/components/MapPickerSheet.tsx");
  const queryState = source("src/components/ui/ScreenQueryState.tsx");
  const childHome = source("src/screens/child/ChildHome.tsx");

  assert.match(tabBar, /<t\.Icon size=\{22\} strokeWidth=\{active \? 2\.4 : 2\.2\}/);
  assert.match(offline, /<WifiOff size=\{16\} strokeWidth=\{2\.4\}/);
  assert.match(picker, /<Home size=\{16\} strokeWidth=\{2\.4\}/);
  assert.match(picker, /<MapPin size=\{16\} strokeWidth=\{2\.4\}/);
  assert.match(picker, /<MapPin size=\{16\} strokeWidth=\{2\.2\}/);
  assert.match(queryState, /<RefreshCw[\s\S]*?size=\{18\}[\s\S]*?strokeWidth=\{2\.4\}/);
  assert.match(childHome, /<MapPin size=\{22\} strokeWidth=\{2\.4\}/);
  assert.match(childHome, /<Settings2 size=\{22\} strokeWidth=\{2\.4\}/);
});

test("제목·연결 상태·삭제 모달의 의미 아이콘은 Lucide로 고정한다", () => {
  const childHome = source("src/screens/child/ChildHome.tsx");
  const childSettings = source("src/screens/child/ChildSettings.tsx");
  const parentSettings = source("src/screens/parent/ParentSettings.tsx");
  const teacherSettings = source("src/screens/teacher/TeacherSettings.tsx");

  for (const [Icon, label] of [
    ["Backpack", "가방 챙기기"],
    ["MessageCircle", "지금 상태 보내기"],
    ["Palette", "내 색깔 고르기"],
  ]) {
    assert.match(childHome, new RegExp(`<${Icon} size=\\{20\\} strokeWidth=\\{2\\.2\\}[^>]*\\/>\\s*${label}`));
  }
  assert.doesNotMatch(childHome, /🎒\s*가방 챙기기|💬\s*지금 상태 보내기|🎨\s*내 색깔 고르기/);

  assert.match(childSettings, /function connectionLabel[\s\S]*:\s*\{ Icon: LucideIcon; text: string \}/);
  assert.match(childSettings, /<conn\.Icon size=\{16\} strokeWidth=\{2\.2\}/);
  assert.doesNotMatch(childSettings, /conn\.emoji|emoji:\s*"(?:👩|👨|👪|🔗)/);

  for (const settings of [parentSettings, teacherSettings]) {
    assert.match(settings, /<div className="ps-modal__emoji" aria-hidden="true">\s*<Trash2 size=\{24\} strokeWidth=\{2\.2\}/);
    assert.doesNotMatch(settings, /<div className="ps-modal__emoji">🗑️<\/div>/);
  }
});

test("보고된 비표준 모서리 반경은 디자인 토큰으로 정규화한다", () => {
  const expectations = [
    ["src/styles/components.css", ".hy-tabbar__inner", "var(--radius-pill)"],
    ["src/screens/feature/RouteView.css", ".rv-start", "var(--radius-16)"],
    ["src/screens/feature/RouteView.css", ".rv-fallback__kakao", "var(--radius-16)"],
    ["src/screens/feature/Supplies.css", ".sup-status__retry", "var(--radius-16)"],
    ["src/screens/feature/Supplies.css", ".sup-row", "var(--radius-16)"],
    ["src/screens/feature/Supplies.css", ".sup-check", "var(--radius-8)"],
    ["src/screens/feature/Supplies.css", ".sup-label", "var(--radius-8)"],
    ["src/screens/feature/Supplies.css", ".sup-iconbtn", "var(--radius-8)"],
    ["src/screens/feature/Subscription.css", ".sub-active__badge", "var(--radius-16)"],
    ["src/screens/feature/Subscription.css", ".sub-benefit__icon", "var(--radius-12)"],
    ["src/screens/feature/Subscription.css", ".sub-cta", "var(--radius-16)"],
    ["src/screens/feature/WeeklyFamilyReport.css", ".wr-hero__icon", "var(--radius-16)"],
    ["src/screens/feature/WeeklyFamilyReport.css", ".wr-empty__icon", "var(--radius-16)"],
    ["src/screens/feature/WeeklyFamilyReport.css", ".wr-state__icon", "var(--radius-16)"],
    ["src/screens/feature/SosReceive.css", ".sr-retry", "var(--radius-16)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-input", "var(--radius-16)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-role-logo", "var(--radius-24)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-role-ic", "var(--radius-16)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-teacher-logo", "var(--radius-24)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-loginbtn", "var(--radius-16)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-datebtn", "var(--radius-16)"],
    ["src/screens/onboarding/Onboarding.css", ".ob-pair-cell", "var(--radius-12)"],
  ];

  for (const [file, selector, radius] of expectations) {
    const body = cssBlock(source(file), selector);
    assert.match(body, new RegExp(`border-radius:\\s*${radius.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;`), `${file} ${selector}`);
  }
});

test("조회 재시도 버튼은 진행 중 상태를 보조기술과 시각적으로 구분한다", () => {
  const queryState = source("src/components/ui/ScreenQueryState.tsx");
  const queryCss = source("src/components/ui/ScreenQueryState.css");
  assert.match(queryState, /className="sqs-retry hy-press"[\s\S]*?aria-busy=\{retrying\}/);
  assert.match(cssBlock(queryCss, '.sqs-retry[aria-busy="true"]:disabled'), /opacity:\s*var\(--busy-opacity\)\s*;/);
  assert.match(cssBlock(queryCss, '.sqs-retry[aria-busy="true"]:disabled'), /cursor:\s*progress\s*;/);
  assert.match(cssBlock(queryCss, ".sqs-retry:disabled"), /cursor:\s*not-allowed\s*;/);
});
