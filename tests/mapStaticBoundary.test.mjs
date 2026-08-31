import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const LEGACY_ALLOWED_DIRECT_IMPORTS = new Set([]);
const LEGACY_ALLOWED_KAKAO_API_CALLERS = new Set([]);

async function sourceFiles(directory) {
  const entries = await readdir(new URL(`${directory}/`, ROOT), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

async function matchingFiles(directory, pattern) {
  const matches = [];
  for (const path of await sourceFiles(directory)) {
    const source = await readFile(new URL(path, ROOT), "utf8");
    if (pattern.test(source)) matches.push(relative(".", path).replaceAll("\\", "/"));
  }
  return matches.sort();
}

test("화면의 지도 공급자 직접 결합은 기존 exact baseline보다 늘어나지 않는다", async () => {
  const matches = [
    ...await matchingFiles("src/screens", /(?:KakaoMap|loadKakaoMaps|google\.maps)/),
    ...await matchingFiles("src/components", /(?:KakaoMap|loadKakaoMaps|google\.maps)/),
  ].sort();
  assert.deepEqual(matches, [...LEGACY_ALLOWED_DIRECT_IMPORTS].sort());
});

test("클라이언트의 Kakao 전용 API 호출은 기존 exact baseline보다 늘어나지 않는다", async () => {
  const matches = await matchingFiles("src", /\/api\/kakao\//);
  assert.deepEqual(matches, [...LEGACY_ALLOWED_KAKAO_API_CALLERS].sort());
});

test("Worker route는 요청 body의 countryCode로 공급자를 고르지 않는다", async () => {
  const source = await readFile(new URL("worker/routes/maps.ts", ROOT), "utf8");
  assert.doesNotMatch(source, /body\s*\.\s*(?:countryCode|country_code)/);
});

test("실행 코드와 패키지에 Mapbox를 새로 도입하지 않는다", async () => {
  const sourceOffenders = [
    ...await matchingFiles("src", /mapbox/i),
    ...await matchingFiles("worker", /mapbox/i),
  ];
  const packageJson = await readFile(new URL("package.json", ROOT), "utf8");

  assert.deepEqual(sourceOffenders, []);
  assert.equal(/mapbox/i.test(packageJson), false);
});
