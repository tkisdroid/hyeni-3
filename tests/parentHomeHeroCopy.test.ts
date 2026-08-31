import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

import koParentMessages from "../src/i18n/generated/catalogs/ko/parent.ts";

test("두 번째 히어로는 미니앱 출시와 학습 가능 소식을 함께 보여준다", () => {
  assert.equal(
    koParentMessages["parent.home.heroSlide.study.title"],
    "혜니캘린더 미니앱이\n출시되었어요",
  );
  assert.equal(
    koParentMessages["parent.home.heroSlide.study.body"],
    "학습도 할 수 있어요",
  );
});
