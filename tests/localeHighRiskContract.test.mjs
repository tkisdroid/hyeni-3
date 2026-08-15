import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readCatalog = (locale, namespace) => JSON.parse(readFileSync(
  new URL(`../locales/${locale}/${namespace}.json`, import.meta.url),
  "utf8",
));
const foreignLocales = ["en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

test("브랜드·pair placeholder·login ID·보호자 코드의 핵심 의미를 훼손하지 않는다", () => {
  for (const locale of foreignLocales) {
    const onboarding = readCatalog(locale, "onboarding");
    const core = readCatalog(locale, "core");
    const combined = JSON.stringify({ core, onboarding });
    assert.match(combined, /Hyeni/, `${locale}: Hyeni 브랜드 누락`);
    assert.equal(core["core.brand.name"], "Hyeni Calendar", `${locale}: 브랜드 이름`);
    assert.equal(core["core.brand.nameRich"], "Hyeni <strong>Calendar</strong>", `${locale}: rich 브랜드 이름`);
    assert.match(onboarding["onboarding.locationDisclosure.collection"], /Hyeni Calendar/, `${locale}: 위치 고지 브랜드`);
    assert.doesNotMatch(combined, /鬣狗|父代码|父代碼|身份证件|身分證件|mã gốc|Nama belakang/, `${locale}: 금지 오역`);
    assert.match(onboarding["onboarding.pairing.invalidCode"], /KID-XXXXXXXX/, `${locale}: 연결 코드 예시`);
    assert.equal((onboarding["onboarding.pairing.invalidCode"].match(/X/g) ?? []).length, 8, `${locale}: X 8개`);
  }
});

test("아이용 위치·오류 문구는 locale별 formal 호칭을 섞지 않는다", () => {
  const forbidden = {
    ja: /ください|です|ます/,
    "zh-CN": /您/,
    "zh-TW": /您/,
    vi: /Vui lòng/i,
    th: /กรุณา|โปรด/,
    id: /Silakan|Anda/,
    ms: /\bSila\b|\banda\b/i,
    fil: /Mangyaring|Pakisuri/i,
  };
  const childContext = (id) => id.endsWith(".child")
    || id.includes(".child.")
    || /backgroundPermission|locationDisclosure|permissionDenied/.test(id);
  for (const [locale, pattern] of Object.entries(forbidden)) {
    const catalog = {
      ...readCatalog(locale, "core"),
      ...readCatalog(locale, "onboarding"),
      ...readCatalog(locale, "shared"),
    };
    for (const [id, value] of Object.entries(catalog)) {
      if (childContext(id)) assert.doesNotMatch(value, pattern, `${locale}:${id}`);
    }
  }
});

test("중국 본토와 대만 catalog는 지역별 연결·위치 용어를 분리한다", () => {
  const cn = readCatalog("zh-CN", "onboarding");
  const tw = readCatalog("zh-TW", "onboarding");
  assert.match(cn["onboarding.pairing.codeLabel"], /连接码/);
  assert.match(tw["onboarding.pairing.codeLabel"], /連結碼/);
  assert.match(cn["onboarding.permissions.location.title"], /位置信息/);
  assert.match(tw["onboarding.permissions.location.title"], /位置資訊/);
  assert.doesNotMatch(JSON.stringify(tw), /连接|验证码|设置信息|尝试/);
});

test("비한국어 core·onboarding·shared는 native 검수 완료로 올리지 않고 draft를 유지한다", () => {
  const status = JSON.parse(readFileSync(new URL("../locales/review-status.json", import.meta.url), "utf8"));
  for (const locale of foreignLocales) {
    for (const namespace of ["core", "onboarding", "shared"]) {
      assert.equal(status.statuses[locale][namespace], "draft", `${locale}:${namespace}`);
    }
  }
});

test("중국어 아이 권한 문구는 존칭을 쓰지 않고 Indonesian 보호자는 사람 역할로 표현한다", () => {
  for (const locale of ["zh-CN", "zh-TW"]) {
    const onboarding = readCatalog(locale, "onboarding");
    for (const [id, value] of Object.entries(onboarding)) {
      if (/backgroundPermission|locationDisclosure|permissionDenied|permissions\.(?:background|location|notifications)\.child|permissions\.(?:subtitle|title)\.child/.test(id)) {
        assert.doesNotMatch(value, /您/, `${locale}:${id}`);
      }
    }
  }
  const id = readCatalog("id", "onboarding");
  assert.doesNotMatch(id["onboarding.pairing.title"], /\binduk\b/i);
  assert.doesNotMatch(id["onboarding.pairing.description"], /\binduk\b/i);
});

test("Malay 아이 core 문구는 formal Sila를 사용하지 않는다", () => {
  const core = readCatalog("ms", "core");
  for (const [id, value] of Object.entries(core)) {
    if (id.endsWith(".child") || id.includes(".child.")) {
      assert.doesNotMatch(value, /\bSila\b/i, id);
    }
  }
});
