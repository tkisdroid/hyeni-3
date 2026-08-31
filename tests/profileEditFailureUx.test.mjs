import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function exportedFunctionBlock(source, name) {
  const start = source.indexOf(`export function ${name}()`);
  assert.ok(start >= 0, `${name} 이 없다`);
  const end = source.indexOf("export function", start + 10);
  return source.slice(start, end > start ? end : undefined);
}

test("아이 정보 저장 화면이 직접 오류를 안내하므로 프로필·사진 mutation은 전역 팝업을 띄우지 않는다", () => {
  const source = read("src/queries/useFamily.ts");
  for (const hook of ["useSetChildProfile", "useUploadChildPhoto"]) {
    assert.match(
      exportedFunctionBlock(source, hook),
      /meta:\s*\{\s*silentError:\s*true\s*\}/,
      `${hook} 실패가 전역 오류 팝업까지 중복 호출한다`,
    );
  }
});

test("아이 전화번호 입력 아래의 불필요한 안내 문구를 렌더하지 않는다", () => {
  const screen = read("src/screens/feature/ProfileEdit.tsx");
  assert.doesNotMatch(screen, /parent\.profileEdit\.phone\.hint/);
});
