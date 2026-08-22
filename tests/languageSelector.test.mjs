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
  assert.match(selector, /collapseOthers/);
  // 2026-08-22 병합: 첫 화면 피커와 설정 행 토글이 같은 open 상태를 공유한다.
  assert.match(selector, /aria-expanded=\{open\}/);
  assert.match(selector, /hy-language--picker/);
  assert.match(selector, /hy-language__trigger/);
  assert.match(selector, /localeEntries\.filter\(\(entry\) => entry\.code !== locale\)/);
});

test("언어 선택기는 키보드 포커스와 44px 터치 영역, 확대 글자 줄바꿈을 보장한다", () => {
  const css = read("src/components/LanguageSelector.css");

  assert.match(css, /\.hy-language__option\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(css, /\.hy-language__option\s*\{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.hy-language__option\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.hy-language__option:focus-visible\s*\{/);
  assert.match(css, /\.hy-language__current\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(css, /\.hy-language__toggle\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
});

test("onboarding과 부모 설정은 같은 공용 선택기를 역할에 맞는 어조로 사용한다", () => {
  const onboardingSource = read("src/screens/onboarding/Onboarding.tsx");
  assert.match(onboardingSource, /import \{ LanguageSelector \} from "@\/components\/LanguageSelector";/);
  assert.match(onboardingSource, /<LanguageSelector\s+tone="formal"\s+collapseOthers\s*\/>/);

  // 2026-08-17 TK 지시: 부모 설정에서는 계정 프로필 바로 아래 한 줄로 두고 그 줄을 펼쳐서 고른다.
  const settings = read("src/screens/parent/ParentSettings.tsx");
  assert.match(settings, /import \{ LanguageSelector, languageNativeName \} from "@\/components\/LanguageSelector";/);
  assert.match(settings, /<LanguageSelector\s+tone="formal"\s+compact\s*\/>/);
  assert.match(settings, /id: "core\.language\.rowLabel"/);
  assert.match(settings, /aria-expanded=\{languageOpen\}/);
  assert.match(settings, /languageNativeName\(locale\)/);
  // 프로필 카드 → 언어 행 → 설정 그룹 순서를 지킨다.
  assert.ok(
    settings.indexOf('className="ps-profile"') < settings.indexOf("ps-language")
      && settings.indexOf("ps-language") < settings.indexOf('className="ps-group"'),
    "언어 행은 계정 프로필 아래, 설정 그룹 위에 있어야 합니다",
  );
  const koCore = JSON.parse(read("locales/ko/core.json"));
  assert.equal(koCore["core.language.rowLabel"], "언어 선택 (Language)");
  assert.equal(JSON.parse(read("locales/en/core.json"))["core.language.rowLabel"], "Language");

  // compact 는 화면에서만 제목·설명을 감춘다(보조기술에는 남는다).
  const selectorCss = read("src/components/LanguageSelector.css");
  assert.match(selectorCss, /\.hy-language--compact\s*\{/);
  assert.match(selectorCss, /\.hy-language__text--quiet\s*\{[^}]*clip-path:\s*inset\(50%\)/s);

  // 2026-08-17 TK 지시: 언어는 가족 공용 설정이라 아이 화면에서는 바꾸지 못한다.
  const childSettings = read("src/screens/child/ChildSettings.tsx");
  assert.doesNotMatch(childSettings, /LanguageSelector/);

  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  const roleStep = onboarding.slice(onboarding.indexOf("function RoleStep"));
  assert.ok(
    roleStep.indexOf("ob-role-card--parent") < roleStep.indexOf('<LanguageSelector tone="formal" collapseOthers />')
      && roleStep.indexOf('<LanguageSelector tone="formal" collapseOthers />') < roleStep.indexOf("ob-role-terms"),
    "온보딩 언어 선택은 역할 카드 아래·약관 위의 페이지 하단에 있어야 합니다",
  );
});
