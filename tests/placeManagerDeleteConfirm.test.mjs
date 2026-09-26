import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// 2026-09-26 에뮬레이터 실측: 휴지통 한 번 탭으로 장소·위험구역이 즉시 삭제됐다(확인·되돌리기 없음).
// 도착·위험 알림을 함께 끄는 동작이라 설정 로그아웃과 같은 "5초 안에 한 번 더" 확인을 거친다.
test("장소·위험구역 삭제는 첫 탭에 확인 대기, 두 번째 탭에서만 삭제한다", () => {
  const screen = read("src/screens/feature/PlaceManager.tsx");
  assert.match(screen, /const \[armedDeleteKey, setArmedDeleteKey\] = useState<string \| null>\(null\);/);
  assert.match(screen, /window\.setTimeout\(\(\) => setArmedDeleteKey\(null\), 5_000\)/);
  assert.match(screen, /if \(armedDeleteKey !== key\) \{\s*setArmedDeleteKey\(key\);\s*return;\s*\}/);
  assert.match(screen, /confirmThenDelete\(`place:\$\{p\.id\}`, \(\) => handleDeletePlace\(p\.id, p\.name\)\)/);
  assert.match(screen, /confirmThenDelete\(`zone:\$\{z\.id\}`, \(\) => handleDeleteZone\(z\.id, z\.name\)\)/);
  assert.doesNotMatch(screen, /onClick=\{\(\) => handleDelete(Place|Zone)\(/);
  assert.equal((screen.match(/notifications\.placeManager\.deleteConfirmAria/g) ?? []).length, 2);
});

test("삭제 확인 문구는 10개 언어에 모두 있다", () => {
  const locales = readdirSync(new URL("../locales", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(locales.length, 10);
  for (const locale of locales) {
    const catalog = JSON.parse(read(`locales/${locale}/notifications.json`));
    assert.ok(catalog["notifications.placeManager.deleteConfirm"], `${locale} deleteConfirm`);
    assert.match(catalog["notifications.placeManager.deleteConfirmAria"] ?? "", /\{name\}/, `${locale} deleteConfirmAria`);
  }
});
