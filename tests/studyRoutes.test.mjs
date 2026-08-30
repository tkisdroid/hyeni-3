import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("부모·아이 Study route는 각 역할 가드 아래 내부 경로로만 존재한다", async () => {
  const source = await readFile(new URL("../src/app/App.tsx", import.meta.url), "utf8");
  assert.match(source, /lazyScreen\(\(\) => import\("@\/screens\/study\/ParentStudy"\), "ParentStudy"\)/);
  assert.match(source, /lazyScreen\(\(\) => import\("@\/screens\/study\/ChildStudy"\), "ChildStudy"\)/);
  assert.match(source, /path: "study", element: routeElement\(<ParentStudy/);
  assert.match(source, /path: "study\/learn", element: routeElement\(<ChildStudy/);
  assert.match(source, /PWA_DRAFT_PROTECTED_ROUTES[\s\S]*"\/study\/learn"/);
});

test("Study 화면에는 iframe·외부 브라우저·별도 앱 이동이 없다", async () => {
  const files = ["ParentStudy.tsx", "ChildStudy.tsx"];
  for (const file of files) {
    const source = await readFile(new URL(`../src/screens/study/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<iframe|window\.open|Browser\.open|hyenistudy\.com/);
  }
});

test("비활성·국외·권한 없는 직접 접근은 역할 홈으로 되돌린다", async () => {
  const gate = await readFile(new URL("../src/features/study/StudyAccessGate.tsx", import.meta.url), "utf8");
  const parent = await readFile(new URL("../src/screens/study/ParentStudy.tsx", import.meta.url), "utf8");
  const child = await readFile(new URL("../src/screens/study/ChildStudy.tsx", import.meta.url), "utf8");
  assert.match(gate, /view\.kind === "hidden"\) return <Navigate to=\{deniedPath\} replace/);
  assert.match(parent, /deniedPath="\/parent\/home"/);
  assert.match(child, /deniedPath="\/child\/home"/);
});
