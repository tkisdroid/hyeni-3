import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const read = (path) => readFileSync(resolve(root, path), "utf8");
const catalog = (locale) => JSON.parse(read(`locales/${locale}/shared.json`));

const qr = read("src/components/QrScanner.tsx");
const admin = read("src/screens/admin/AdminAiPrompt.tsx");

test("QR payload와 카메라 감지 결과는 raw 값으로 콜백에 전달한다", () => {
  assert.match(qr, /const rawValue = codes\.find/);
  assert.match(qr, /await onDetected\(rawValue\)/);
  assert.match(qr, /onDetected: \(rawValue: string\)/);
  assert.doesNotMatch(qr, /formatMessage\([^)]*,\s*\{[^}]*(?:rawValue|codes|onDetected)/s);
  assert.doesNotMatch(qr, /console\.(?:log|info|warn|error)\([^)]*(?:rawValue|codes)/s);
});

test("관리자 prompt 본문과 서버 저장값은 raw 편집·저장 계약을 유지한다", () => {
  assert.match(admin, /setDraft\(serverPrompt\)/);
  assert.match(admin, /savePrompt\.mutateAsync\(draft\)/);
  assert.match(admin, /setDraft\(saved\.prompt\)/);
  assert.match(admin, /value=\{draft\}/);
  assert.doesNotMatch(admin, /formatMessage\([^)]*,\s*\{[^}]*(?:draft|serverPrompt|saved\.prompt|promptQuery\.data)/s);
});

test("QR와 관리자 화면의 권한·query·mutation·role 계약을 유지한다", () => {
  assert.match(qr, /ensureQrCameraPermission\(\)/);
  assert.match(qr, /openCameraPermissionSettings\(\)/);
  assert.match(qr, /setRetryKey\(\(v\) => v \+ 1\)/);
  assert.match(admin, /adminStatus\.data\?\.isAdmin === true/);
  assert.match(admin, /useAdminAiPrompt\(isAdmin\)/);
  assert.match(admin, /useAdminCommerceControls\(isAdmin\)/);
  assert.match(admin, /commerceQuery\.refetch\(\)/);
  assert.match(admin, /promptQuery\.refetch\(\)/);
  assert.match(admin, /saveCommerceControls\.mutateAsync/);
});

test("QR와 관리자 UI chrome은 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const targets = [
    { prefix: "shared.qrScanner.", minimum: 14 },
    { prefix: "shared.adminAiPrompt.", minimum: 40 },
  ];
  const english = catalog("en");

  for (const { prefix, minimum } of targets) {
    const ids = Object.keys(english).filter((id) => id.startsWith(prefix));
    assert.ok(ids.length >= minimum, `${prefix}: 충분한 문구 ID`);
    for (const locale of locales) {
      const messages = catalog(locale);
      for (const id of ids) {
        assert.equal(typeof messages[id], "string", `${locale}:${id}`);
        assert.ok(messages[id].trim(), `${locale}:${id}: 빈 번역`);
        const placeholderOnly = /^[\d\s+()\-/:.]+$/.test(english[id]);
        if (!placeholderOnly && !["ko", "en"].includes(locale)) {
          assert.notEqual(messages[id], english[id], `${locale}:${id}: 영어 폴백`);
        }
        const variables = (message) => [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)]
          .map((match) => match[1]).sort();
        assert.deepEqual(variables(messages[id]), variables(english[id]), `${locale}:${id}: ICU 변수 불일치`);
      }
    }
  }
});
