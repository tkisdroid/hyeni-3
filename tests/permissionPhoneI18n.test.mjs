import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

function read(path) {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function catalog(locale, namespace) {
  return JSON.parse(read(`locales/${locale}/${namespace}.json`));
}

const permission = read("src/screens/feature/PermDenied.tsx");
const phone = read("src/screens/feature/PhoneSetup.tsx");

test("권한 화면은 실제 OS 상태 재확인·설정 열기 동작을 그대로 유지한다", () => {
  assert.match(permission, /readPermissionState\(kind\)/);
  assert.match(permission, /requestOrOpenPermission\(kind\)/);
  assert.match(permission, /if \(result\.granted\) navigate\(-1\)/);
  assert.match(permission, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(permission, /App\.addListener\("appStateChange"/);
  assert.match(permission, /isNativePlatform\(\)/);
  assert.match(permission, /shared\.permDenied\.steps\.batteryNative/);
  assert.match(permission, /shared\.permDenied\.steps\.permissionNative/);
  assert.match(permission, /shared\.permDenied\.steps\.web/);
});

test("권한 안내는 부모 PWA가 아이 Android 권한을 원격 부여할 수 없음을 숨기지 않는다", () => {
  const ko = catalog("ko", "shared");
  assert.equal(
    ko["shared.permDenied.limit.web.formal"],
    "아이 Android 권한은 원격으로 켤 수 없어요. 아이 기기에서 한 번 허용해 주세요.",
  );
  assert.equal(
    ko["shared.permDenied.limit.native.child"],
    "Android 권한과 배터리 예외는 이 기기에서 한 번 직접 허용해야 해.",
  );
  assert.match(permission, /shared\.permDenied\.limit\.web\.formal/);
  assert.match(permission, /shared\.permDenied\.limit\.native\.child/);
  assert.match(permission, /role === "child"/);
});

test("전화번호 화면은 역할 라벨만 번역하고 세션·전화번호 값은 원문으로 저장·표시한다", () => {
  assert.match(phone, /function roleLabel\([\s\S]*gender === "mom"[\s\S]*gender === "dad"/);
  assert.match(phone, /parent\.phoneSetup\.role\.mom/);
  assert.match(phone, /parent\.phoneSetup\.role\.dad/);
  assert.match(phone, /value=\{myPhone\}/);
  assert.match(phone, /phone = normalizePhoneForStorage\(myPhone\)/);
  assert.match(phone, /update\.mutate\(\s*\{ phone \}/);
  assert.match(phone, /g\.phone\s*\?\s*formatPhoneDisplay\(g\.phone\)/);
  assert.match(phone, /g\.user_id === userId/);
  assert.doesNotMatch(phone, /formatMessage\([^)]*,\s*\{[^}]*(?:myPhone|g\.phone|userId|familyId)/s);
});

test("전화번호 hydration과 본인 행만 수정하는 fail-closed 계약을 유지한다", () => {
  assert.match(phone, /family\?\.familyId === familyId/);
  assert.match(phone, /me\?\.user_id === userId/);
  assert.match(phone, /hydratedPhoneSourceKey === phoneSourceKey/);
  assert.match(phone, /if \(!phoneFormReady \|\| !me\)/);
  assert.match(phone, /disabled=\{!phoneFormReady \|\| update\.isPending\}/);
  assert.match(phone, /disabled=\{!phoneFormReady \|\| update\.isPending \|\| !me\}/);
});

test("권한·전화번호 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const targets = [
    { namespace: "shared", prefix: "shared.permDenied.", minimum: 35 },
    { namespace: "parent", prefix: "parent.phoneSetup.", minimum: 24 },
  ];

  for (const { namespace, prefix, minimum } of targets) {
    const english = catalog("en", namespace);
    const ids = Object.keys(english).filter((id) => id.startsWith(prefix));
    assert.ok(ids.length >= minimum, `${prefix}: 충분한 문구 ID`);
    for (const locale of locales) {
      const messages = catalog(locale, namespace);
      for (const id of ids) {
        assert.equal(typeof messages[id], "string", `${locale}:${id}`);
        assert.ok(messages[id].trim(), `${locale}:${id}: 빈 번역`);
        if (!["ko", "en"].includes(locale)) {
          assert.notEqual(messages[id], english[id], `${locale}:${id}: 영어 폴백`);
        }
      }
    }
  }

  for (const locale of locales) {
    assert.match(catalog(locale, "parent")["parent.phoneSetup.phoneAria"], /\{role\}/);
  }
});
