import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const coreSurfaces = [
  "src/app/AppShell.tsx",
  "src/app/ErrorBoundary.tsx",
  "src/app/GlobalErrorListeners.tsx",
  "src/components/ui/Loading.tsx",
  "src/components/ui/OfflineBanner.tsx",
  "src/components/ui/QrCode.tsx",
  "src/components/ui/RouteLoading.tsx",
  "src/components/ui/ScreenQueryState.tsx",
  "src/components/ui/StickerCelebration.tsx",
  "src/components/ui/TopBar.tsx",
  "src/screens/Splash.tsx",
  "src/screens/onboarding/Onboarding.tsx",
];

const passThroughSurfaces = [
  "src/components/ui/BusyLabel.tsx",
  "src/components/ui/SectionHeader.tsx",
  "src/auth/RequireGuest.tsx",
  "src/auth/RequireRole.tsx",
];

test("공용 shell·UI·Splash·Onboarding은 React Intl 메시지를 사용한다", () => {
  for (const path of coreSurfaces) {
    const source = read(path);
    assert.match(source, /(?:useIntl|FormattedMessage)/, `${path}: React Intl 배선이 없습니다`);
  }
});

test("문구 없는 공용 pass-through·auth guard는 사용자 literal과 오류 원문을 만들지 않는다", () => {
  for (const path of passThroughSurfaces) {
    const source = read(path);
    assert.doesNotMatch(source, />\s*[가-힣A-Za-z][^<{]*</, `${path}: JSX 사용자 문구가 생겼습니다`);
    assert.doesNotMatch(source, /(?:aria-label|title|placeholder)="[^"]+"/, `${path}: 카탈로그 밖 접근성 문구가 생겼습니다`);
    assert.doesNotMatch(source, /(?:error|err|e)\.message|String\(\s*(?:error|err|e)\s*\)/, `${path}: 오류 원문 표면이 생겼습니다`);
  }
});

test("Task 6 사용자 표면에는 카탈로그 밖 한글·영문 문구가 남지 않는다", () => {
  const violations = [];
  for (const path of coreSurfaces) {
    const source = read(path);
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("{")) return;
      if (/\b(?:className|data-|to=|path:|src=|color=|style=|id=|key=|type=|role=|rel=|target=)/.test(trimmed)) return;
      if (/[가-힣]/.test(trimmed) && !/(?:formatMessage|FormattedMessage|description:)/.test(trimmed)) {
        violations.push(`${path}:${index + 1}: ${trimmed}`);
      }
    });
  }
  assert.deepEqual(violations, []);
});

test("10개 locale의 core·onboarding·shared가 같은 실제 메시지 ID를 가진다", () => {
  const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
  for (const namespace of ["core", "onboarding", "shared"]) {
    const source = JSON.parse(read(`locales/ko/${namespace}.json`));
    assert.ok(Object.keys(source).length > 0, `${namespace}: 한국어 카탈로그가 비었습니다`);
    for (const locale of locales) {
      const catalog = JSON.parse(read(`locales/${locale}/${namespace}.json`));
      assert.deepEqual(Object.keys(catalog).sort(), Object.keys(source).sort(), `${locale}/${namespace}`);
      for (const [id, value] of Object.entries(catalog)) {
        assert.equal(typeof value, "string", `${locale}:${id}`);
        assert.ok(value.trim().length > 0, `${locale}:${id}: 빈 번역`);
      }
    }
  }
});

test("아이 재페어링과 선생님 production gate의 의미·조건을 유지한다", () => {
  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  const ko = JSON.parse(read("locales/ko/onboarding.json"));
  assert.match(onboarding, /previous_user_id|childJoinHint/);
  assert.match(onboarding, /\{TEACHER_MODE_ENABLED\s*&&\s*\(/);
  assert.match(ko["onboarding.pairing.recovery"], /같은 아이|기록.*유지|이어/);
});
