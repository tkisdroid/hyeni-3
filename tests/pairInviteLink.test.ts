import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  buildPairLink,
  buildPairRoleChoiceLink,
  parsePairInviteFromLocation,
  removePairInviteParams,
} = await import("../src/transform/pairLink.ts");

test("아이와 공동 보호자 초대 링크는 역할 의도를 URL에 명시한다", () => {
  assert.match(buildPairLink("kid-ab12cd34", "child"), /pair=KID-AB12CD34&as=child$/);
  assert.match(buildPairLink("kid-ab12cd34", "parent"), /pair=KID-AB12CD34&as=parent$/);
});

test("아이관리 공용 QR은 자녀 역할을 추정하지 않고 역할 선택 링크를 만든다", () => {
  const link = buildPairRoleChoiceLink("kid-ab12cd34");

  assert.match(link, /pair=KID-AB12CD34$/);
  assert.doesNotMatch(link, /[?&]as=(?:child|parent)(?:&|$)/);
});

test("HashRouter 초대는 코드·역할·legacy 여부를 함께 복원한다", () => {
  assert.deepEqual(parsePairInviteFromLocation({
    search: "",
    hash: "#/onboarding?pair=KID-AB12CD34&as=parent&ref=HYENI-23456789ABCDEFGH",
  }), { code: "KID-AB12CD34", role: "parent", roleExplicit: true });
  assert.deepEqual(parsePairInviteFromLocation({
    search: "?pair=KID-CD34EF56",
    hash: "#/onboarding",
  }), { code: "KID-CD34EF56", role: "child", roleExplicit: false });
  assert.deepEqual(parsePairInviteFromLocation({
    search: "?pair=KID-OUTER123&as=parent",
    hash: "#/onboarding?pair=KID-HASH456&as=child",
  }), { code: "KID-HASH456", role: "child", roleExplicit: true });
});

test("초대 처리 뒤에는 pair와 as만 제거하고 추천인·다른 쿼리는 보존한다", () => {
  assert.deepEqual(removePairInviteParams({
    pathname: "/",
    search: "?utm_source=invite",
    hash: "#/onboarding?pair=KID-AB12CD34&as=parent&ref=HYENI-23456789ABCDEFGH",
  }), {
    search: "?utm_source=invite",
    hash: "#/onboarding?ref=HYENI-23456789ABCDEFGH",
  });
});

test("초대 파라미터 제거는 기존 history state를 지우지 않는다", () => {
  const source = readFileSync(new URL("../src/transform/pairLink.ts", import.meta.url), "utf8");
  assert.match(source, /window\.history\.replaceState\(\s*window\.history\.state,/);
});
