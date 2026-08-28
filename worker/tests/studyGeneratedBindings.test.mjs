import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const generated = readFileSync(new URL("../worker-configuration.d.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("Calendar Wrangler 생성 타입은 named Study service만 generic Service로 기록한다", () => {
  assert.match(wrangler, /\[\[services\]\][\s\S]*binding = "STUDY_SERVICE"[\s\S]*service = "hyeni-study"[\s\S]*entrypoint = "CalendarStudyService"/);
  assert.match(generated, /^\s*STUDY_SERVICE: Service \/\* entrypoint CalendarStudyService from hyeni-study \*\/;$/m);
  assert.doesNotMatch(generated, /\bCalendarStudyServiceBinding\b/);
  assert.doesNotMatch(generated, /\bSTUDY_[A-Z0-9_]*SECRET\b/);
});
