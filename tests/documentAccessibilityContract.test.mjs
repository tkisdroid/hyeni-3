import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("문서 viewport는 화면 확대를 막지 않고 검색 설명을 제공한다", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /maximum-scale|user-scalable\s*=\s*no/i);
  // 설명 meta 는 locale 전환 때 내용이 바뀌므로 고정 id 를 함께 요구한다
  // (id 가 없으면 applyDocumentLocale 이 대상을 못 찾아 한국어 설명이 남는다).
  const description = html.match(/<meta[^>]*name="description"[^>]*>/g) ?? [];
  assert.equal(description.length, 1, JSON.stringify(description));
  assert.match(description[0], /id="hyeni-description"/);
  assert.match(description[0], /content="[^"]+"/);
});

test("각 앱 셸은 하나의 main 랜드마크를 제공하고 화면 내부 main 중첩을 만들지 않는다", () => {
  const shell = read("src/app/AppShell.tsx");
  assert.equal((shell.match(/<main className="hy-screen/g) ?? []).length, 4);
  for (const path of [
    "src/components/ui/ScreenQueryState.tsx",
    "src/screens/teacher/TeacherReleaseGate.tsx",
    "src/screens/feature/AiSchedule.tsx",
    "src/screens/feature/Feedback.tsx",
  ]) {
    assert.doesNotMatch(read(path), /<main\b/, `${path}가 AppShell main 안에 중첩됩니다.`);
  }
});

test("정적 crawler 안내 파일은 SPA fallback이 아닌 실제 텍스트로 제공된다", () => {
  assert.match(read("public/robots.txt"), /^User-agent:\s*\*/m);
  assert.match(read("public/robots.txt"), /^Allow:\s*\/$/m);
  assert.match(read("public/llms.txt"), /^# 혜니캘린더$/m);
});
