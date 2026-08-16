import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIntl, createIntlCache } from "react-intl";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("가족 setup은 optional referralCode를 서버에 전달하고 온보딩 성공 뒤에만 URL에서 지운다", () => {
  const familyEndpoint = read("src/lib/api/endpoints/family.ts");
  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  assert.match(familyEndpoint, /referralCode\?: string/);
  assert.match(familyEndpoint, /referralCode:\s*input\.referralCode/);
  assert.match(onboarding, /readReferralParam\(\)/);
  assert.match(onboarding, /setupFamily\(\{[\s\S]{0,180}referralCode:/);
  const setupAt = onboarding.indexOf("await setupFamily");
  const clearAt = onboarding.indexOf("clearReferralParam()", setupAt);
  assert.ok(setupAt >= 0 && clearAt > setupAt, "가족 생성 성공 전에 추천 코드를 지우면 안 됩니다");
});

test("온보딩은 추천 귀속과 보상 조건을 숨기지 않고 KID 페어링 흐름과 분리한다", () => {
  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  const koCatalog = JSON.parse(read("locales/ko/onboarding.json"));
  assert.match(onboarding, /id: "onboarding\.connect\.referralTitle"/);
  assert.match(onboarding, /id: "onboarding\.connect\.referralDescription"/);
  assert.equal(koCatalog["onboarding.connect.referralTitle"], "친구 초대 코드가 적용돼요");
  assert.match(koCatalog["onboarding.connect.referralDescription"], /새 가족을 만든 뒤 3일이 지나고/);
  assert.match(koCatalog["onboarding.connect.referralDescription"], /처음 위치 연결 뒤 48시간 동안 최신 상태가 유지되면/);
  assert.match(koCatalog["onboarding.connect.referralDescription"], /두 가족 모두 AI 대화 10회/);
  assert.match(onboarding, /initialCode=\{pairPrefill\}/);
  assert.match(onboarding, /referralCode=\{referralPrefill\}/);
});

test("부모 설정은 기존 스토어 혜택을 보존하면서 주 보호자에게 친구 초대 진입점을 제공한다", () => {
  const settings = read("src/screens/parent/ParentSettings.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.match(settings, /parent\.parentSettings\.copy001/);
  assert.match(settings, /parent\.parentSettings\.copy018/);
  assert.equal(koParent["parent.parentSettings.copy001"], "기존에 받은 스토어 방문 혜택은 그대로 유지돼요");
  assert.equal(koParent["parent.parentSettings.copy018"], "친구 초대 · 서로 AI 대화 10회");
  assert.match(settings, /account\?\.isPrimaryParent/);
  assert.match(settings, /<ReferralRewardPanel/);
});

test("추천 화면은 양측 10회·평생 3가족·72시간·48시간 유지 조건과 정확한 진행 상태를 보여준다", () => {
  const panel = read("src/components/ReferralRewardPanel.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  for (const [id, expected] of Object.entries({
    "parent.referralRewardPanel.copy009": /두 가족 모두 추가 AI 대화 10회/,
    "parent.referralRewardPanel.copy010": /평생 최대 3가족/,
    "parent.referralRewardPanel.copy013": /72시간/,
    "parent.referralRewardPanel.copy012": /48시간 뒤에도 최신 위치/,
  })) {
    assert.match(panel, new RegExp(id.replaceAll(".", "\\.")));
    assert.match(koParent[id], expected);
  }
  assert.match(panel, /status\.successfulCount\}\/\{status\.successCap/);
  assert.match(panel, /pendingCount/);
  assert.match(panel, /navigator\.share/);
  assert.match(panel, /navigator\.clipboard/);
});

test("추천 공유 payload는 실제 locale 메시지를 {link}와 함께 문장 전체로 포맷한다", () => {
  const panel = read("src/components/ReferralRewardPanel.tsx");
  const link = "https://hyeni-calendar.pages.dev/#/onboarding?ref=FAMILY10";
  const expectedLead = {
    ko: /^혜니캘린더에서/,
    en: /^Start protecting your family together with Hyeni Calendar\./,
    ja: /^Hyeniカレンダーで/,
    "zh-CN": /^通过Hyeni日历/,
    "zh-TW": /^透過Hyeni日曆/,
    vi: /^Cùng bắt đầu bảo vệ gia đình với Hyeni Calendar\./,
    th: /^เริ่มดูแลความปลอดภัยของครอบครัวไปด้วยกันกับ Hyeni Calendar/,
    id: /^Mulai jaga keamanan keluarga bersama Hyeni Calendar\./,
    ms: /^Mulakan penjagaan keselamatan keluarga bersama Hyeni Calendar\./,
    fil: /^Simulan ang pagprotekta sa pamilya kasama ang Hyeni Calendar\./,
  };

  assert.match(panel, /id: "parent\.referralRewardPanel\.shareBody"/);
  assert.match(panel, /\{\s*link\s*:/);
  assert.doesNotMatch(panel, /`혜니캘린더에서/);

  for (const [locale, lead] of Object.entries(expectedLead)) {
    const messages = JSON.parse(read(`locales/${locale}/parent.json`));
    assert.equal(typeof messages["parent.referralRewardPanel.shareBody"], "string", `${locale}: 공유 본문 키 누락`);
    const intl = createIntl({ locale, messages }, createIntlCache());
    const payload = intl.formatMessage(
      { id: "parent.referralRewardPanel.shareBody" },
      { link },
    );
    assert.match(payload, lead, `${locale}: 공유 본문 시작 의미`);
    assert.equal(payload.split(link).length - 1, 1, `${locale}: 링크는 정확히 한 번`);
    assert.match(payload, /3/);
    assert.match(payload, /48/);
    assert.match(payload, /10/);
    assert.equal(payload.split("\n").length, 3, `${locale}: 공유 시트 3줄 본문`);
    if (locale !== "ko") assert.doesNotMatch(payload, /[가-힣]/, `${locale}: 한국어 혼입`);
  }
});

test("추천 복사 실패·미지원 toast와 초대 코드 접근성 이름도 locale 메시지를 사용한다", () => {
  const panel = read("src/components/ReferralRewardPanel.tsx");
  for (const id of [
    "parent.referralRewardPanel.clipboardUnsupported",
    "parent.referralRewardPanel.clipboardFailed",
    "parent.referralRewardPanel.inviteCodeAria",
  ]) {
    assert.match(panel, new RegExp(id.replaceAll(".", "\\.")), id);
  }
  assert.doesNotMatch(panel, /복사를 지원하지 않아요|복사하지 못했어요|친구 초대 코드 \$\{/);
});

test("클라이언트 추천 API에는 지급·qualify·claim endpoint가 없고 조회·코드 발급만 있다", () => {
  const endpoint = read("src/lib/api/endpoints/referrals.ts");
  assert.match(endpoint, /apiGet<ReferralStatus>\("\/api\/referrals\/me"\)/);
  assert.match(endpoint, /apiPost<ReferralStatus>\("\/api\/referrals\/code"/);
  assert.doesNotMatch(endpoint, /\/reward|\/qualify|\/claim|grant/i);
});
