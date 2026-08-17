import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const read = (path) => readFileSync(resolve(root, path), "utf8");
const catalog = (locale) => JSON.parse(read(`locales/${locale}/shared.json`));

const notice = read("src/screens/teacher/TeacherNotice.tsx");
const students = read("src/screens/teacher/TeacherStudents.tsx");
const timetable = read("src/screens/teacher/TeacherTimetable.tsx");

test("선생님 공지 본문·제목·준비물·첨부 이름은 raw 값으로 저장한다", () => {
  assert.match(notice, /value=\{title\}/);
  assert.match(notice, /value=\{body\}/);
  assert.match(notice, /supplies\.join\(", "\)/);
  assert.match(notice, /name: a\.name/);
  assert.match(notice, /title: trimmedTitle/);
  assert.match(notice, /body: composedBody/);
  assert.match(notice, /attachments: uploadedAttachments/);
  assert.doesNotMatch(notice, /formatMessage\([^)]*,\s*\{[^}]*(?:title|body|item|a\.name|className)/s);
});

test("학생 명단·학급·전화·아이 이름은 raw 값으로 표시하고 mutation에 전달한다", () => {
  assert.match(students, /\{className\}/);
  assert.match(students, /\{s\.name\}/);
  assert.match(students, /value=\{invitePhone\}/);
  assert.match(students, /value=\{inviteChild\}/);
  assert.match(students, /\{ childMemberId: s\.childMemberId, dateKey: todayIso, status, scheduleId: null \}/);
  assert.match(students, /\{ classId, phone, childName: inviteChild\.trim\(\) \|\| null \}/);
  assert.doesNotMatch(students, /formatMessage\([^)]*,\s*\{[^}]*(?:className|s\.name|invitePhone|inviteChild)/s);
});

test("시간표 과목·교실·시간·학생·학급 이름은 raw 값으로 유지한다", () => {
  for (const raw of ["className", "row.endTime", "row.title", "row.childName", "row.location"]) {
    assert.match(timetable, new RegExp(`\\{${raw.replace(".", "\\.")}\\}`));
  }
  assert.match(timetable, /\{row\.time\s*\?\?/);
  assert.match(timetable, /hhmmToMinutes\(row\.time\)/);
  assert.match(timetable, /a\.row\.childName\.localeCompare\(b\.row\.childName, "ko"\)/);
  assert.doesNotMatch(timetable, /formatMessage\([^)]*,\s*\{[^}]*(?:className|row\.(?:time|endTime|title|childName|location))/s);
});

test("세 화면의 query·mutation·teacher route 계약을 유지한다", () => {
  assert.match(notice, /teacherNoticeQueryState === "loading"/);
  assert.match(notice, /teacherNoticeQueryState === "error" \|\| teacherNoticeDataMissing/);
  assert.match(notice, /teacherNoticeDataEmpty/);
  assert.match(notice, /publish\.mutate/);
  assert.match(students, /studentsLoading/);
  assert.match(students, /studentsError/);
  assert.match(students, /visibleStudents\.map/);
  assert.match(students, /setAttendance\.mutate/);
  assert.match(timetable, /scheduleQ\.isLoading/);
  assert.match(timetable, /scheduleQ\.isError/);
  assert.match(timetable, /rows\.length === 0/);
  assert.match(timetable, /copyWeek\.mutate/);

  const app = read("src/app/App.tsx");
  const release = read("src/config/releaseFeatures.ts");
  assert.match(release, /TEACHER_MODE_ENABLED\s*=\s*import\.meta\.env\.DEV/);
  for (const path of ["teacher/students", "teacher/timetable", "teacher/notice"]) {
    assert.match(app, new RegExp(`path: "${path}"`));
  }
});

test("공지·학생·시간표 chrome은 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const targets = [
    { prefix: "shared.teacherNotice.", minimum: 40 },
    { prefix: "shared.teacherStudents.", minimum: 30 },
    { prefix: "shared.teacherTimetable.", minimum: 25 },
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
        const placeholderOnly = /^[\d\s+()\-]+$/.test(english[id]);
        if (!placeholderOnly && !["ko", "en"].includes(locale)) {
          assert.notEqual(messages[id], english[id], `${locale}:${id}: 영어 폴백`);
        }
        const variables = (message) => [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)]
          .map((match) => match[1]).sort();
        assert.deepEqual(variables(messages[id]), variables(english[id]), `${locale}:${id}: ICU 변수 불일치`);
      }
    }
  }
});
