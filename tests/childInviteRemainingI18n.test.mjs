import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

test("아이 초대의 남은 시간 방향은 core ICU 메시지로 표시한다", () => {
  const source = read("src/screens/feature/ChildInvite.tsx");

  assert.match(source, /useIntl\(\)/);
  assert.match(
    source,
    /formatMessage\(\s*\{\s*id:\s*"core\.time\.remaining"\s*\},\s*\{\s*duration:\s*countdown\.text\s*\},?\s*\)/s,
  );
  assert.doesNotMatch(source, /`\$\{countdown\.text\}\s*남음`/);
});

test("10개 locale의 남은 시간 메시지는 같은 duration 변수와 자연스러운 방향을 사용한다", () => {
  const expected = {
    ko: "1 day 남음",
    en: "1 day remaining",
    ja: "残り1 day",
    "zh-CN": "剩余1 day",
    "zh-TW": "剩餘1 day",
    vi: "Còn 1 day",
    th: "เหลืออีก 1 day",
    id: "Tersisa 1 day",
    ms: "Baki 1 day",
    fil: "1 day ang natitira",
  };

  for (const locale of locales) {
    const catalog = JSON.parse(read(`locales/${locale}/core.json`));
    const message = catalog["core.time.remaining"];
    assert.equal(typeof message, "string", `${locale} core.time.remaining 누락`);
    assert.deepEqual(
      [...message.matchAll(/\{\s*([A-Za-z][\w]*)/g)].map((match) => match[1]),
      ["duration"],
      `${locale} ICU 변수 계약`,
    );
    assert.equal(
      new IntlMessageFormat(message, locale).format({ duration: "1 day" }),
      expected[locale],
    );
  }
});
