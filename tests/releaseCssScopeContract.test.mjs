/**
 * 화면 접두사가 겹치는 출시 CSS의 스코프 계약.
 * PlaydateAccept/ParentAccount의 pa-*와 DataSync/DaySummary의 ds-*가 서로 덮지 않게 한다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const normalizeSelector = (selector) => selector.replace(/\s+/g, " ").trim();

function selectors(relativePath) {
  const source = readSource(relativePath).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) =>
    normalizeSelector(match[1]),
  );
}

function assertScoped(relativePath, root, localSelectors) {
  const actual = selectors(relativePath);
  for (const localSelector of localSelectors) {
    const scoped = `${root} ${localSelector}`;
    assert.ok(actual.includes(scoped), `${relativePath}에 ${scoped} 규칙이 필요합니다`);
    assert.ok(
      !actual.includes(localSelector),
      `${relativePath}의 ${localSelector}는 ${root} 밖으로 노출되면 안 됩니다`,
    );
  }
}

test("PlaydateAccept의 pa-* 공통 이름은 pa-screen 안에서만 동작한다", () => {
  assertScoped("src/screens/feature/PlaydateAccept.css", ".pa-screen", [
    ".pa-back",
    ".pa-content",
    ".pa-card",
    ".pa-note",
  ]);
  assert.match(
    readSource("src/screens/feature/PlaydateAccept.tsx"),
    /className="pa-screen"/,
  );
});

test("DataSync와 DaySummary의 ds-* 공통 이름은 각 화면 루트로 격리된다", () => {
  assertScoped("src/screens/feature/DataSync.css", ".ds-root", [".ds-back", ".ds-content"]);
  assertScoped("src/screens/feature/DaySummary.css", ".ds-screen", [".ds-back", ".ds-content"]);
  assert.match(readSource("src/screens/feature/DataSync.tsx"), /className="ds-root hy-rise-in"/);
  assert.match(readSource("src/screens/feature/DaySummary.tsx"), /className="ds-screen"/);
});

test("ParentAccount의 pa-back 정본은 별도 화면 규칙으로 유지된다", () => {
  const accountSelectors = selectors("src/screens/parent/ParentAccount.css");
  assert.ok(accountSelectors.includes(".pa-back"));
  assert.ok(!accountSelectors.includes(".pa-screen .pa-back"));
});
