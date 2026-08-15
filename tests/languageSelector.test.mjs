import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  const path = resolve(rootDir, relativePath);
  assert.equal(existsSync(path), true, `${relativePath} 파일이 필요합니다`);
  return readFileSync(path, "utf8");
}

test("언어 선택기는 지원 언어 10개의 정확한 자칭 명칭을 모두 보여준다", () => {
  const manifest = JSON.parse(read("locales/manifest.json"));

  assert.deepEqual(
    manifest.locales.map(({ code, nativeName }) => [code, nativeName]),
    [
      ["ko", "한국어"],
      ["en", "English"],
      ["ja", "日本語"],
      ["zh-CN", "简体中文"],
      ["zh-TW", "繁體中文"],
      ["vi", "Tiếng Việt"],
      ["th", "ไทย"],
      ["id", "Bahasa Indonesia"],
      ["ms", "Bahasa Melayu"],
      ["fil", "Filipino"],
    ],
  );

  const selector = read("src/components/LanguageSelector.tsx");
  for (const nativeName of manifest.locales.map((entry) => entry.nativeName)) {
    assert.equal(selector.includes(nativeName), true, `${nativeName} 자칭 명칭이 빠졌습니다`);
  }
});

test("언어 선택기는 catalog 접근성 이름과 현재 선택 radio 상태를 제공한다", () => {
  const selector = read("src/components/LanguageSelector.tsx");

  assert.match(selector, /role="radiogroup"/);
  assert.match(selector, /aria-labelledby=\{labelId\}/);
  assert.match(selector, /aria-describedby=\{descriptionId\}/);
  assert.match(selector, /role="radio"/);
  assert.match(selector, /aria-checked=\{locale === entry\.code\}/);
  assert.match(selector, /core\.language\.formal\.label/);
  assert.match(selector, /core\.language\.child\.label/);
  assert.match(selector, /core\.language\.formal\.description/);
  assert.match(selector, /core\.language\.child\.description/);
});

test("언어 선택기는 키보드 포커스와 44px 터치 영역, 확대 글자 줄바꿈을 보장한다", () => {
  const css = read("src/components/LanguageSelector.css");

  assert.match(css, /\.hy-language__option\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(css, /\.hy-language__option\s*\{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.hy-language__option\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.hy-language__option:focus-visible\s*\{/);
});

test("onboarding과 부모·아이 설정은 같은 공용 선택기를 역할에 맞는 어조로 사용한다", () => {
  const screens = [
    ["src/screens/onboarding/Onboarding.tsx", "formal"],
    ["src/screens/parent/ParentSettings.tsx", "formal"],
    ["src/screens/child/ChildSettings.tsx", "child"],
  ];

  for (const [path, tone] of screens) {
    const source = read(path);
    assert.match(source, /import \{ LanguageSelector \} from "@\/components\/LanguageSelector";/);
    assert.match(source, new RegExp(`<LanguageSelector\\s+tone="${tone}"\\s*\\/>`));
  }

  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  const roleStep = onboarding.slice(onboarding.indexOf("function RoleStep"));
  assert.ok(
    roleStep.indexOf('<LanguageSelector tone="formal" />') < roleStep.indexOf("ob-role-card--parent"),
    "온보딩 첫 화면에서 역할 선택 전에 언어를 바꿀 수 있어야 합니다",
  );
});
