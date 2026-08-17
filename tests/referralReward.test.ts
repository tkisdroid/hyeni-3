import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReferralLink,
  extractReferralCodeFromInput,
  normalizeReferralCode,
  parseReferralCodeFromHref,
  parseReferralCodeFromLocation,
} from "../src/transform/referralLink.ts";

test("친구 초대 코드는 KID 페어링 코드와 겹치지 않는 16자리 HYENI 형식만 받는다", () => {
  assert.equal(normalizeReferralCode(" hyeni-23456789abcdefgh "), "HYENI-23456789ABCDEFGH");
  assert.equal(normalizeReferralCode("KID-12345678"), null);
  assert.equal(normalizeReferralCode("HYENI-OOOOOOOOOOOOOOOO"), null);
  assert.equal(normalizeReferralCode("HYENI-1234"), null);
});

test("HashRouter ref 파라미터는 pair와 독립적으로 읽는다", () => {
  assert.equal(parseReferralCodeFromLocation({
    search: "",
    hash: "#/onboarding?pair=KID-12345678&ref=HYENI-23456789ABCDEFGH",
  }), "HYENI-23456789ABCDEFGH");
  assert.equal(parseReferralCodeFromLocation({
    search: "?ref=HYENI-3456789ABCDEFGHJ",
    hash: "#/onboarding?pair=KID-12345678",
  }), "HYENI-3456789ABCDEFGHJ");
  assert.equal(parseReferralCodeFromLocation({
    search: "",
    hash: "#/onboarding?pair=KID-12345678",
  }), null);
});

test("공유 링크는 메신저가 해시를 잘라도 남도록 /?ref= 만 쓴다", () => {
  assert.equal(
    buildReferralLink("https://hyeni-calendar.pages.dev/", "HYENI-23456789ABCDEFGH"),
    "https://hyeni-calendar.pages.dev/?ref=HYENI-23456789ABCDEFGH",
  );
});

test("붙여 넣은 초대 링크와 본문에서도 같은 HYENI 코드를 꺼낸다", () => {
  assert.equal(
    extractReferralCodeFromInput("hyeni-23456789abcdefgh"),
    "HYENI-23456789ABCDEFGH",
  );
  assert.equal(
    extractReferralCodeFromInput("https://hyeni-calendar.pages.dev/invite?ref=HYENI-23456789ABCDEFGH"),
    "HYENI-23456789ABCDEFGH",
  );
  assert.equal(
    extractReferralCodeFromInput("https://hyeni-calendar.pages.dev/#/onboarding?ref=HYENI-23456789ABCDEFGH"),
    "HYENI-23456789ABCDEFGH",
  );
  assert.equal(
    extractReferralCodeFromInput("혜니캘린더 초대\nhttps://hyeni-calendar.pages.dev/invite?ref=HYENI-23456789ABCDEFGH"),
    "HYENI-23456789ABCDEFGH",
  );
  assert.equal(extractReferralCodeFromInput("KID-12345678"), null);
});

test("초대 경로와 옛 해시 링크를 모두 읽는다", () => {
  assert.equal(
    parseReferralCodeFromHref("https://hyeni-calendar.pages.dev/invite?ref=HYENI-23456789ABCDEFGH"),
    "HYENI-23456789ABCDEFGH",
  );
  assert.equal(
    parseReferralCodeFromLocation({
      pathname: "/invite/HYENI-23456789ABCDEFGH",
      search: "",
      hash: "",
    }),
    "HYENI-23456789ABCDEFGH",
  );
});

