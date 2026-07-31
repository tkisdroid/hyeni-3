import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcher = await readFile(
  new URL("../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml", import.meta.url),
  "utf8",
);
const roundLauncher = await readFile(
  new URL("../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml", import.meta.url),
  "utf8",
);
const monochrome = await readFile(
  new URL("../android/app/src/main/res/drawable/ic_launcher_monochrome.xml", import.meta.url),
  "utf8",
);

test("Android 테마 아이콘은 풀컬러 전경과 분리된 단색 마스크를 사용한다", () => {
  for (const adaptiveIcon of [launcher, roundLauncher]) {
    assert.match(adaptiveIcon, /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"\/>/);
    assert.doesNotMatch(
      adaptiveIcon,
      /<monochrome android:drawable="@mipmap\/ic_launcher_foreground"\/>/,
    );
  }
});

test("단색 마스크는 캘린더 윤곽과 내부 심볼을 함께 제공한다", () => {
  assert.match(monochrome, /android:viewportWidth="108"/);
  assert.match(monochrome, /android:strokeColor="#FF000000"/);
  assert.match(monochrome, /android:fillColor="#FF000000"/);
});
