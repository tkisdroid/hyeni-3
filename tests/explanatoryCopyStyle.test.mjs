import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (path) => readFileSync(resolve(rootDir, path), "utf8");

const components = readSource("src/styles/components.css");
const koParent = JSON.parse(readSource("locales/ko/parent.json"));
const koBilling = JSON.parse(readSource("locales/ko/billing.json"));
const koShared = JSON.parse(readSource("locales/ko/shared.json"));

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(source)?.[1] ?? "";
}

function cssBlocks(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "gs"))]
    .map((match) => match[1]);
}

function finalDeclaration(blocks, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = blocks.flatMap((block) =>
    [...block.matchAll(new RegExp(`${escaped}\\s*:\\s*([^;]+)\\s*;`, "g"))]
      .map((match) => match[1].trim()),
  );
  return values.at(-1) ?? "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function explanationBlock(file, className, anchor, closingTag = "div") {
  const source = readSource(file);
  const anchorIndex = source.indexOf(anchor);
  assert.ok(anchorIndex >= 0, `${file}에서 기준 문구를 찾지 못했습니다: ${anchor}`);
  const classIndex = source.lastIndexOf(`className="${className}"`, anchorIndex);
  assert.ok(classIndex >= 0, `${file}에서 .${className} 설명 요소를 찾지 못했습니다`);
  const start = source.lastIndexOf("<", classIndex);
  const end = source.indexOf(`</${closingTag}>`, anchorIndex);
  assert.ok(start >= 0 && end >= 0, `${file}의 .${className} 설명 범위를 찾지 못했습니다`);
  return { source, block: source.slice(start, end + closingTag.length + 3) };
}

function assertSentenceLines(block, sentences, expectedLineGroups = 1) {
  const groups = block.match(/className="hy-explain__lines"/g) ?? [];
  assert.equal(groups.length, expectedLineGroups, "조건별 hy-explain__lines 묶음 수가 달라졌습니다");
  for (const sentence of sentences) {
    assert.match(
      block,
      new RegExp(`className="hy-explain__line"\\s*>\\s*${escapeRegex(sentence)}\\s*<\\/span>`),
      `문장을 독립된 설명 행으로 유지해야 합니다: ${sentence}`,
    );
  }
}

function assertMessageLines(block, ids, expectedLineGroups = 1) {
  const groups = block.match(/className="hy-explain__lines"/g) ?? [];
  assert.equal(groups.length, expectedLineGroups, "조건별 hy-explain__lines 묶음 수가 달라졌습니다");
  for (const id of ids) {
    assert.match(
      block,
      new RegExp(`className="hy-explain__line"[\\s\\S]{0,180}${escapeRegex(id)}`),
      `번역 문구를 독립된 설명 행으로 유지해야 합니다: ${id}`,
    );
  }
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
  const explainCascade = cssBlocks(components, ".hy-explain.hy-explain");
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
  assert.equal(
    finalDeclaration(explainCascade, "line-height"),
    "1.55",
    "direct text도 동일 선택자의 최종 cascade에서 1.55 행간을 사용해야 합니다",
  );

  const commonRules = `${explain}\n${lines}\n${line}\n${nestedLine}`;
  assert.doesNotMatch(commonRules, /!important/);
  assert.doesNotMatch(commonRules, /#[0-9a-f]{3,8}\b|rgba?\(/i, "공통 설명문에 새 하드코딩 색상을 추가하면 안 됩니다");
});

test("다문장 설명 다섯 곳은 조건과 문구를 유지한 채 문장별 행으로 나뉜다", () => {
  const aiSchedule = explanationBlock(
    "src/screens/feature/AiSchedule.tsx",
    "ais-hint hy-explain",
    "parent.aiSchedule.imageSearch",
  );
  assert.equal((aiSchedule.block.match(/className="hy-explain__lines"/g) ?? []).length, 1);
  const aiScheduleCopy = {
    "parent.aiSchedule.imageSearch": "AI가 사진에서 일정을 찾습니다.",
    "parent.aiSchedule.imageCredit": "크레딧이 사용될 수 있어요.",
    "parent.aiSchedule.imageServer": "사진은 일정 후보를 찾기 위해 서버로 전송돼요.",
  };
  for (const [id, expected] of Object.entries(aiScheduleCopy)) {
    assert.match(aiSchedule.block, new RegExp(`className="hy-explain__line"[\\s\\S]{0,160}${escapeRegex(id)}`));
    assert.equal(koParent[id], expected);
  }

  const socialLinks = explanationBlock(
    "src/screens/parent/SocialLinks.tsx",
    "pa-note hy-explain",
    "parent.socialLinks.copy017",
  );
  assert.match(socialLinks.block, /\{native\s*\?\s*canUnlink\s*\?/);
  const socialCopy = {
    "parent.socialLinks.copy017": "계정을 바꾸려면 새 계정을 먼저 연결한 뒤 예전 계정을 해제하세요.",
    "parent.socialLinks.copy018": "해제해도 가족·일정 데이터는 그대로예요.",
    "parent.socialLinks.copy019": "지금은 이 소셜 계정이 유일한 로그인 수단이라 해제할 수 없어요.",
    "parent.socialLinks.copy020": "다른 로그인 방법을 먼저 추가해 주세요.",
    "parent.socialLinks.copy021": "소셜 계정 연결은 안드로이드 앱에서 할 수 있어요.",
  };
  assert.equal((socialLinks.block.match(/className="hy-explain__lines"/g) ?? []).length, 3);
  for (const [id, expected] of Object.entries(socialCopy)) {
    assert.match(socialLinks.block, new RegExp(`className="hy-explain__line"[\\s\\S]{0,120}${id.replaceAll(".", "\\.")}`));
    assert.equal(koParent[id], expected);
  }

  const pairingWizard = explanationBlock(
    "src/screens/feature/PairingWizard.tsx",
    "pw-note hy-explain",
    "parent.pairingWizard.primarySaveLine",
    "p",
  );
  assert.match(pairingWizard.block, /\{family\?\.isPrimaryParent\s*\?/);
  assert.equal((pairingWizard.block.match(/className="hy-explain__lines"/g) ?? []).length, 2);
  const pairingWizardCopy = {
    "parent.pairingWizard.primarySaveLine": "연결 코드를 만들면 아이 정보(사진·이름·생년월일·테마색)가 저장돼요.",
    "parent.pairingWizard.primaryInheritLine": "아이 기기에서 코드를 입력하면 이 정보를 이어받아 연결돼요.",
    "parent.pairingWizard.secondarySaveLine": "주 보호자만 아이 정보를 서버에 저장할 수 있어요.",
    "parent.pairingWizard.secondaryPreviewLine": "지금 만든 정보는 초대 화면에 미리보기로 전달돼요.",
  };
  for (const [id, expected] of Object.entries(pairingWizardCopy)) {
    assert.match(pairingWizard.block, new RegExp(`className="hy-explain__line"[\\s\\S]{0,160}${escapeRegex(id)}`));
    assert.equal(koParent[id], expected);
  }

  const aiCredit = explanationBlock(
    "src/screens/feature/AiCredit.tsx",
    "ac-note hy-explain",
    "billing.aiCredit.creditUse",
  );
  assert.equal((aiCredit.block.match(/className="hy-explain__lines"/g) ?? []).length, 1);
  for (const id of ["billing.aiCredit.creditUse", "billing.aiCredit.topUpHint"]) {
    assert.match(aiCredit.block, new RegExp(`className="hy-explain__line"[\\s\\S]{0,160}${escapeRegex(id)}`));
  }
  assert.equal(
    koBilling["billing.aiCredit.creditUse"],
    "AI가 도울 때 크레딧 1회를 써요.",
  );
  assert.equal(koBilling["billing.aiCredit.topUpHint"], "필요할 때 충전해 주세요.");

  const teacherNotice = explanationBlock(
    "src/screens/teacher/TeacherNotice.tsx",
    "tn-hint hy-explain",
    "shared.teacherNotice.hint.empty",
  );
  assert.match(teacherNotice.source, /\{recipientCount === 0 && \(\s*<div className="tn-hint hy-explain">/);
  assertMessageLines(teacherNotice.block, [
    "shared.teacherNotice.hint.empty",
    "shared.teacherNotice.hint.delivery",
  ]);
  assert.equal(koShared["shared.teacherNotice.hint.empty"], "학생을 연결하면 알림장을 보낼 수 있어요.");
  assert.equal(koShared["shared.teacherNotice.hint.delivery"], "보낸 알림장은 연결된 모든 학부모님께 전달돼요.");
});

test("필수 설명 상자는 공통 스타일을 사용하고 긴 안전 문구를 문장별로 나눈다", () => {
  const notification = readSource("src/screens/feature/NotificationSettings.tsx");
  const locationStatus = readSource("src/screens/feature/LocationStatus.tsx");

  for (const [file, className] of [
    ["src/screens/feature/NotificationSettings.tsx", "nst-safety-note"],
    ["src/screens/feature/RemoteAudio.tsx", "ra-trust-card"],
    ["src/screens/teacher/TeacherTimetable.tsx", "tt-note"],
  ]) {
    assertAllTagsUseExplain(file, className);
  }

  assert.match(
    notification,
    /className="hy-explain__lines"[\s\S]*?className="hy-explain__line">위험·SOS·미도착 알림은 항상 전달 대상으로 처리돼요\.<\/span>[\s\S]*?className="hy-explain__line">위 토글은 부모가 받는 일반 위치 소식에만 적용돼요\.<\/span>/,
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
