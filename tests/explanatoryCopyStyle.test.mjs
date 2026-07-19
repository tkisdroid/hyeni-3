import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (path) => readFileSync(resolve(rootDir, path), "utf8");

const components = readSource("src/styles/components.css");

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(source)?.[1] ?? "";
}

function literalTagsWithClass(source, className) {
  return [...source.matchAll(/<[A-Za-z][^>]*className="[^"]*"[^>]*>/gs)]
    .map((match) => match[0])
    .filter((tag) => {
      const classes = /className="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
      return classes.includes(className);
    });
}

function assertAllTagsUseExplain(file, className) {
  const source = readSource(file);
  const tags = literalTagsWithClass(source, className);
  assert.ok(tags.length > 0, `${file}에서 .${className} 설명 요소를 찾지 못했습니다`);
  for (const tag of tags) {
    assert.match(tag, /className="[^"]*\bhy-explain\b[^"]*"/, `${file} .${className}에 hy-explain이 필요합니다`);
  }
}

test("공통 설명문은 기존 배경을 유지하면서 무테두리·무그림자와 읽기 쉬운 한국어 조판을 제공한다", () => {
  const explain = cssBlock(components, ".hy-explain.hy-explain");
  const lines = cssBlock(components, ".hy-explain__lines");
  const line = cssBlock(components, ".hy-explain__line");
  const nestedLine = cssBlock(components, ".hy-explain.hy-explain .hy-explain__line");

  assert.ok(explain, ".hy-explain.hy-explain 공통 규칙이 필요합니다");
  assert.match(explain, /border:\s*0\s*;/);
  assert.match(explain, /box-shadow:\s*none\s*;/);
  assert.doesNotMatch(explain, /--type-body-sm-line-height\s*:/, "공통 설명문이 정본 타이포 토큰을 재정의하면 안 됩니다");
  assert.match(explain, /font-size:\s*var\(--type-body-sm\)\s*;/);
  assert.match(explain, /font-weight:\s*var\(--type-body-sm-weight\)\s*;/);
  assert.match(explain, /line-height:\s*var\(--type-body-sm-line-height\)\s*;/);
  assert.match(explain, /word-break:\s*keep-all\s*;/);
  assert.match(explain, /overflow-wrap:\s*anywhere\s*;/);
  assert.match(explain, /text-wrap:\s*pretty\s*;/);
  assert.doesNotMatch(explain, /background(?:-color)?\s*:/, "화면별 설명 배경색은 유지해야 합니다");

  assert.match(lines, /display:\s*flex\s*;/);
  assert.match(lines, /flex-direction:\s*column\s*;/);
  assert.match(lines, /gap:\s*var\(--spacing-4\)\s*;/);
  assert.match(line, /display:\s*block\s*;/);
  assert.match(nestedLine, /line-height:\s*1\.55\s*;/);
  assert.match(nestedLine, /word-break:\s*keep-all\s*;/);
  assert.match(nestedLine, /overflow-wrap:\s*anywhere\s*;/);
  assert.match(nestedLine, /text-wrap:\s*pretty\s*;/);
  assert.match(nestedLine, /margin-block:\s*0\s*;/);

  const commonRules = `${explain}\n${lines}\n${line}\n${nestedLine}`;
  assert.doesNotMatch(commonRules, /!important/);
  assert.doesNotMatch(commonRules, /#[0-9a-f]{3,8}\b|rgba?\(/i, "공통 설명문에 새 하드코딩 색상을 추가하면 안 됩니다");
});

test("필수 설명 상자는 공통 스타일을 사용하고 긴 안전 문구를 문장별로 나눈다", () => {
  const notification = readSource("src/screens/feature/NotificationSettings.tsx");
  const locationStatus = readSource("src/screens/feature/LocationStatus.tsx");

  for (const [file, className] of [
    ["src/screens/feature/NotificationSettings.tsx", "nst-safety-note"],
    ["src/screens/feature/RemoteAudio.tsx", "ra-trust-card"],
    ["src/screens/feature/RemoteAudio.tsx", "ra-webnote"],
    ["src/screens/teacher/TeacherTimetable.tsx", "tt-note"],
  ]) {
    assertAllTagsUseExplain(file, className);
  }

  assert.match(
    notification,
    /className="hy-explain__lines"[\s\S]*?className="hy-explain__line">위험·SOS·미도착 알림은 항상 전달 대상으로 처리돼요\.<\/span>[\s\S]*?className="hy-explain__line">위 토글은 일반 위치 소식에만 적용돼요\.<\/span>/,
  );
  assert.match(
    locationStatus,
    /className="ls-permit hy-explain"[\s\S]*?className="hy-explain__lines"[\s\S]*?className="hy-explain__line">아이 기기의 위치 권한이 꺼져 있거나 GPS가 잡히지 않으면 갱신이 지연될 수 있어요\.<\/span>[\s\S]*?className="hy-explain__line">아이 기기에서 위치 권한과 GPS를 확인해 주세요\.<\/span>/,
  );
});

test("순수 설명과 인라인 도움말은 화면별 이름을 유지한 채 공통 조판을 사용한다", () => {
  const targets = [
    ["src/screens/feature/AiSchedule.tsx", "ais-hint"],
    ["src/screens/feature/AiSchedule.tsx", "ais-edit-note"],
    ["src/screens/feature/AiCredit.tsx", "ac-note"],
    ["src/screens/feature/AiCredit.tsx", "ac-field__hint"],
    ["src/screens/feature/LocationSettings.tsx", "lset-note"],
    ["src/screens/feature/LocationStatus.tsx", "ls-permit"],
    ["src/screens/feature/PhoneSetup.tsx", "psu-note"],
    ["src/screens/feature/PairingWizard.tsx", "pw-note"],
    ["src/screens/feature/RemoteAudio.tsx", "ra-start-note"],
    ["src/screens/feature/RemoteAudioAudit.tsx", "raa-note"],
    ["src/screens/feature/Subscription.tsx", "sub-note"],
    ["src/screens/onboarding/Onboarding.tsx", "ob-teacher-note"],
    ["src/screens/parent/ParentAccount.tsx", "pa-note"],
    ["src/screens/parent/SocialLinks.tsx", "pa-note"],
    ["src/screens/teacher/TeacherReleaseGate.tsx", "trg-notice"],
    ["src/screens/child/ChildSettings.tsx", "ks-help-item"],
    ["src/screens/parent/EventForm.tsx", "ef-note"],
    ["src/screens/feature/DataSync.tsx", "ds-note"],
    ["src/screens/feature/DangerZoneForm.tsx", "dzf-hint"],
    ["src/screens/feature/DangerZoneForm.tsx", "dzf-toggle-note"],
    ["src/screens/feature/FamilyConnection.tsx", "fc-note"],
    ["src/screens/feature/NotificationSettings.tsx", "nst-note"],
    ["src/screens/teacher/TeacherNotice.tsx", "tn-hint"],
    ["src/screens/teacher/TeacherStudents.tsx", "ts-hint"],
  ];

  for (const [file, className] of targets) assertAllTagsUseExplain(file, className);

  const profile = readSource("src/screens/feature/ProfileEdit.tsx");
  const profileHints = literalTagsWithClass(profile, "pe-hint");
  const normalHints = profileHints.filter((tag) => !tag.includes("pe-hint--warn"));
  assert.ok(normalHints.length > 0);
  for (const tag of normalHints) assert.match(tag, /\bhy-explain\b/);
  assert.doesNotMatch(
    profileHints.find((tag) => tag.includes("pe-hint--warn")) ?? "",
    /\bhy-explain\b/,
    "권한 경고는 일반 설명문으로 평탄화하면 안 됩니다",
  );
});

test("인용·수치·상태·행동 요소는 설명문 공통 스타일에 섞이지 않는다", () => {
  for (const [file, className] of [
    ["src/screens/feature/PlaydateAccept.tsx", "pa-note"],
    ["src/screens/feature/DailySafetyReport.tsx", "dr-note"],
    ["src/screens/feature/RouteView.tsx", "rv-info"],
    ["src/screens/teacher/TeacherHome.tsx", "th-note"],
    ["src/screens/child/overlays/DaySheet.tsx", "ks-day__notice"],
    ["src/screens/feature/FriendPlay.tsx", "fp-note--parent"],
  ]) {
    const tags = literalTagsWithClass(readSource(file), className);
    assert.ok(tags.length > 0, `${file}에서 제외 대상 .${className}을 찾지 못했습니다`);
    for (const tag of tags) assert.doesNotMatch(tag, /\bhy-explain\b/, `${file} .${className}은 설명문 대상이 아닙니다`);
  }

  assert.doesNotMatch(components, /\[class[^\]]*\*=[^\]]*(?:note|hint|help)[^\]]*\]/i);
  assert.doesNotMatch(components, /\.(?:[^\s,{]*-)?(?:note|hint|help)(?:[^\s,{]*)?\s*(?:,|\{)/i, "의미가 다른 *-note 계열을 전역 선택하면 안 됩니다");
});
