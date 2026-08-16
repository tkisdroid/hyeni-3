import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

function read(path) {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function catalog(locale) {
  return JSON.parse(read(`locales/${locale}/shared.json`));
}

const gate = read("src/screens/teacher/TeacherReleaseGate.tsx");
const home = read("src/screens/teacher/TeacherHome.tsx");
const settings = read("src/screens/teacher/TeacherSettings.tsx");
const app = read("src/app/App.tsx");
const onboarding = read("src/screens/onboarding/Onboarding.tsx");
const releaseFeatures = read("src/config/releaseFeatures.ts");
const LOCALE_INDEPENDENT_TEACHER_IDS = new Set([
  "shared.teacherReleaseGate.eyebrow",
  "shared.teacherHome.invite.phonePlaceholder",
]);

test("선생님 production gate와 역할 카드의 DEV 전용 경계를 유지한다", () => {
  assert.match(releaseFeatures, /TEACHER_MODE_ENABLED\s*=\s*import\.meta\.env\.DEV/);
  assert.match(app, /children:\s*TEACHER_MODE_ENABLED\s*\?\s*\[/);
  assert.match(app, /path:\s*"teacher\/\*"[^\n]*<TeacherReleaseGate\s*\/>/);
  assert.match(onboarding, /\{TEACHER_MODE_ENABLED\s*&&\s*\(/);
  assert.doesNotMatch(releaseFeatures, /VITE_|MODE\s*===|PROD/);
});

test("출시 gate는 기존 선생님 세션의 로그아웃·탈퇴·법적 문서 동선을 보존한다", () => {
  assert.match(gate, /useIntl\(\)/);
  assert.match(gate, /await logout\(\)/);
  assert.match(gate, /await deleteAccount\(\)/);
  assert.match(gate, /navigate\("\/onboarding", \{ replace: true \}\)/);
  assert.match(gate, /openLegal\(TERMS_OF_SERVICE_URL\)/);
  assert.match(gate, /openLegal\(PRIVACY_POLICY_URL\)/);
  assert.match(gate, /shared\.teacherReleaseGate\.title/);
  assert.match(gate, /shared\.teacherReleaseGate\.delete\.dialogTitle/);
});

test("선생님 홈은 서버 학급·학생·전화·이름 값을 번역하지 않고 그대로 사용한다", () => {
  assert.match(home, /const classId = firstClass\?\.classId \?\? null/);
  assert.match(home, /const className = firstClass\?\.className\s*\?\?/);
  assert.match(home, /\{className\}/);
  assert.match(home, /\{s\.name\}/);
  assert.match(home, /value=\{invitePhone\}/);
  assert.match(home, /value=\{inviteChild\}/);
  assert.match(home, /\{ classId, phone, childName: inviteChild\.trim\(\) \|\| null \}/);
  assert.match(home, /\{ className: name \}/);
  assert.doesNotMatch(home, /formatMessage\([^)]*,\s*\{[^}]*(?:className|s\.name|invitePhone|inviteChild)/s);
});

test("선생님 설정은 서버 계정·provider·학급 이름을 raw 변수로 표시한다", () => {
  assert.match(settings, /useIntl\(\)/);
  assert.match(settings, /const displayName = account\?\.myName\s*\|\|/);
  assert.match(settings, /const className = classesQ\.data\?\.\[0\]\?\.className\s*\?\?/);
  assert.match(settings, /\{providerLabel\}/);
  assert.match(settings, /\{className\}/);
  assert.match(settings, /\{displayName\}\s*·\s*\{intl\.formatMessage/);
  assert.match(settings, /shared\.teacherSettings\.profileName/);
  assert.doesNotMatch(settings, /formatMessage\([^)]*,\s*\{[^}]*(?:displayName|providerLabel|className)/s);
});

test("세 선생님 화면 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const targets = [
    { prefix: "shared.teacherReleaseGate.", minimum: 20 },
    { prefix: "shared.teacherHome.", minimum: 35 },
    { prefix: "shared.teacherSettings.", minimum: 25 },
  ];
  const english = catalog("en");

  for (const { prefix, minimum } of targets) {
    const ids = Object.keys(english).filter((id) => id.startsWith(prefix));
    assert.ok(ids.length >= minimum, `${prefix}: 충분한 문구 ID`);
    for (const locale of locales) {
      const messages = catalog(locale);
      for (const id of ids) {
        assert.equal(typeof messages[id], "string", `${locale}:${id}`);
        assert.ok(messages[id].trim(), `${locale}:${id}: 빈 번역`);
        if (!LOCALE_INDEPENDENT_TEACHER_IDS.has(id) && !["ko", "en"].includes(locale)) {
          assert.notEqual(messages[id], english[id], `${locale}:${id}: 영어 폴백`);
        }
        const englishVariables = [...english[id].matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
        const localeVariables = [...messages[id].matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
        assert.deepEqual(localeVariables, englishVariables, `${locale}:${id}: ICU 변수 불일치`);
      }
    }
  }
});
