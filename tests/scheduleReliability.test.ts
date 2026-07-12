import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const recurrenceSource = readFileSync(
  new URL("../src/transform/eventRecurrence.ts", import.meta.url),
  "utf8",
).replace(
  /import \{ addDaysToDateKey, dateToDateKey, parseAppDateKey \} from "\.\/dateKey";/,
  `
const parseAppDateKey = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
};
const dateToDateKey = (date) => \`${"${date.getFullYear()}-${date.getMonth()}-${date.getDate()}"}\`;
const addDaysToDateKey = (key, days) => {
  const date = parseAppDateKey(key);
  return date ? dateToDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)) : key;
};`,
);
const recurrenceJavaScript = ts.transpileModule(recurrenceSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const recurrenceModule = await import(
  `data:text/javascript;base64,${Buffer.from(recurrenceJavaScript).toString("base64")}`
) as typeof import("../src/transform/eventRecurrence.ts");
const { buildOccurrenceDateKeys } = recurrenceModule;

test("월말 반복 일정은 다음 달 말일로 보정하고 달을 건너뛰지 않는다", () => {
  assert.deepEqual(buildOccurrenceDateKeys("2026-0-31", "매월"), [
    "2026-0-31",
    "2026-1-28",
    "2026-2-31",
    "2026-3-30",
    "2026-4-31",
    "2026-5-30",
  ]);
});

test("일정 폼은 서버 기본 알림과 알림 없음의 의미를 혼동하지 않는다", () => {
  const src = readFileSync(new URL("../src/screens/parent/EventForm.tsx", import.meta.url), "utf8");
  assert.match(src, /label:\s*"기본 설정"/);
  assert.match(src, /알림 설정에서 고른 시간을 사용해요/);
  assert.doesNotMatch(src, /label:\s*"없음",\s*minutes:\s*null/);
});

test("반복 일정 저장은 여러 개의 독립 요청이 아니라 서버 원자 배치 API를 사용한다", () => {
  const querySrc = readFileSync(new URL("../src/queries/useSchedule.ts", import.meta.url), "utf8");
  const endpointSrc = readFileSync(new URL("../src/lib/api/endpoints/schedule.ts", import.meta.url), "utf8");
  assert.doesNotMatch(querySrc, /Promise\.allSettled\(inputs\.map/);
  assert.match(querySrc, /saveEventsWithChildrenBatch\(inputs\)/);
  assert.match(endpointSrc, /\/api\/events\/batch/);
});

test("아이 알림 토글은 화면 로컬 상태가 아니라 본인 서버 설정을 저장한다", () => {
  const src = readFileSync(new URL("../src/screens/child/ChildSettings.tsx", import.meta.url), "utf8");
  assert.match(src, /useNotifSettings/);
  assert.match(src, /useSaveNotifSettings/);
  assert.doesNotMatch(src, /useState\(true\)/);
  assert.doesNotMatch(src, /이 기기에서만 켜고 끌 수 있어/);
});

test("가족 로딩·오류 중에는 빈 배정을 가족 공유로 오인 저장하지 않는다", () => {
  const src = readFileSync(new URL("../src/screens/parent/EventForm.tsx", import.meta.url), "utf8");
  assert.match(src, /familyQuery\.isLoading/);
  assert.match(src, /familyQuery\.isError/);
  assert.match(src, /disabled=\{busy \|\| !familyReady\}/);
});

test("하루 종일 일정은 수정 폼에서 시간 강제 없이 왕복 저장한다", () => {
  const src = readFileSync(new URL("../src/screens/parent/EventForm.tsx", import.meta.url), "utf8");
  assert.match(src, /const \[allDay, setAllDay\]/);
  assert.match(src, /time: allDay \? null : timeValue/);
  assert.match(src, /end_time: allDay \? null : endTimeValue/);
});

test("자정을 넘는 일정은 종료 시각에 다음 날 1440분을 더해 상태를 판정한다", () => {
  const src = readFileSync(new URL("../src/transform/scheduleView.ts", import.meta.url), "utf8");
  assert.match(src, /endMinRaw <= startMin \? endMinRaw \+ 24 \* 60 : endMinRaw/);
});

test("반복 수정은 영속 series_id가 같은 일정만 대상으로 삼는다", () => {
  const src = readFileSync(new URL("../src/transform/eventSeries.ts", import.meta.url), "utf8");
  assert.match(src, /series_id/);
  assert.doesNotMatch(src, /seriesSignature\(event\) === signature/);
});

test("명시 childId 딥링크는 activeChild보다 우선해 member id로 사용한다", () => {
  const src = readFileSync(new URL("../src/screens/parent/EventForm.tsx", import.meta.url), "utf8");
  assert.match(src, /childId\?: string/);
  assert.match(src, /stringFrom\(suggestion\?\.childMemberId\) \?\? stringFrom\(nav\?\.childId\)/);
});

test("일정 조회는 전체 사용량을 받고 비패딩 date_key를 숫자 날짜로 정렬한다", () => {
  const src = readFileSync(new URL("../src/lib/api/endpoints/schedule.ts", import.meta.url), "utf8");
  assert.match(src, /fetchEvents\(familyId: string, limit = 1000\)/);
  assert.match(src, /eventDateSortValue/);
  assert.doesNotMatch(src, /localeCompare\(.*date_key/);
});

test("사용자가 사전 알림을 모두 해제한 빈 배열은 기본값으로 되살아나지 않는다", () => {
  const src = readFileSync(new URL("../src/lib/api/endpoints/notifications.ts", import.meta.url), "utf8");
  assert.match(src, /if \(!Array\.isArray\(raw\)\) return \[\.\.\.DEFAULT_NOTIF_SETTINGS\.minutesBefore\]/);
  assert.match(src, /out\.sort\([\s\S]*return out;/);
  assert.doesNotMatch(src, /return out\.length \? out : \[\.\.\.DEFAULT_NOTIF_SETTINGS\.minutesBefore\]/);
});
