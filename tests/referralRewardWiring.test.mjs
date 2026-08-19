import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIntl, createIntlCache } from "react-intl";
import { localizedBrandName } from "../src/i18n/locale.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("가족 setup은 optional referralCode를 서버에 전달하고 온보딩 성공 뒤에만 URL에서 지운다", () => {
  const familyEndpoint = read("src/lib/api/endpoints/family.ts");
  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  assert.match(familyEndpoint, /referralCode\?: string/);
  assert.match(familyEndpoint, /referralCode:\s*input\.referralCode/);
  assert.match(onboarding, /readReferralParam\(\)/);
  assert.match(onboarding, /ReferralCodeField/);
  assert.match(onboarding, /onboarding\.field\.referralCode/);
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
  // 2026-08-17: 조건은 한 줄로 줄이고 보상 횟수는 정책 상수로 넣는다(문구에 숫자를 박지 않는다).
  assert.match(koCatalog["onboarding.connect.referralDescription"], /3일 동안 아이 위치가 확인되면/);
  assert.match(koCatalog["onboarding.connect.referralDescription"], /AI 대화 \{count\}회/);
  assert.match(onboarding, /REFERRAL_REWARD_CREDITS_DISPLAY/);
  assert.ok(
    koCatalog["onboarding.connect.referralDescription"].length <= 60,
    "온보딩 추천 안내는 한 줄로 짧게 유지한다",
  );
  assert.match(onboarding, /initialCode=\{pairPrefill\}/);
  assert.match(onboarding, /referralCode=\{referralPrefill\}/);
});

test("부모 설정은 기존 스토어 혜택을 보존하면서 주 보호자에게 친구 초대 진입점을 제공한다", () => {
  const settings = read("src/screens/parent/ParentSettings.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.match(settings, /parent\.parentSettings\.copy001/);
  assert.match(settings, /parent\.parentSettings\.copy018/);
  assert.equal(koParent["parent.parentSettings.copy001"], "기존에 받은 스토어 방문 혜택은 그대로 유지돼요");
  assert.equal(koParent["parent.parentSettings.copy018"], "친구 초대 · AI 대화 {count}회");
  assert.match(settings, /REFERRAL_REWARD_CREDITS_DISPLAY/);
  assert.match(settings, /account\?\.myRole === "parent"/);
  assert.match(settings, /<ReferralRewardPanel/);
});

test("추천 화면은 보상과 조건을 한 줄씩만 보여주고 초대 가족 수 상한을 두지 않는다", () => {
  const panel = read("src/components/ReferralRewardPanel.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));

  // 보상 횟수는 서버 값(status.rewardCredits)을 그대로 쓴다.
  assert.match(panel, /referralRewardCredits\(status\?\.rewardCredits\)/);
  assert.match(koParent["parent.referralRewardPanel.copy009"], /AI 대화 \{count\}회/);
  assert.match(koParent["parent.referralRewardPanel.copy010"], /3일 동안 아이 위치가 확인되면 지급/);

  // 단계 설명·법률 문단·상한 안내는 재도입하지 않는다.
  for (const id of [
    "parent.referralRewardPanel.copy011",
    "parent.referralRewardPanel.copy012",
    "parent.referralRewardPanel.copy013",
    "parent.referralRewardPanel.copy014",
    "parent.referralRewardPanel.copy027",
  ]) {
    assert.equal(koParent[id], undefined, `${id} 는 삭제된 문구입니다`);
    assert.doesNotMatch(panel, new RegExp(id.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(panel, /successCap|canInvite/);
  assert.ok(
    koParent["parent.referralRewardPanel.copy010"].length <= 45,
    "지급 조건 안내는 한 줄로 짧게 유지한다",
  );

  assert.match(panel, /parent\.referralRewardPanel\.copy019/);
  assert.match(panel, /parent\.referralRewardPanel\.pending/);
  assert.match(panel, /sharePlainContent/);
  assert.match(panel, /navigator\.clipboard/);
  const share = read("src/lib/native/share.ts");
  assert.match(share, /navigator\.share/);
  assert.match(share, /ShareSheet/);
  assert.match(read("src/lib/native/referralDeepLink.ts"), /initReferralDeepLink/);
  assert.match(read("android/app/src/main/AndroidManifest.xml"), /android:pathPrefix="\/invite"/);
});

test("부모 홈은 친구 초대를 한 줄 카드로 눈에 띄게 보여준다", () => {
  const home = read("src/screens/parent/ParentHome.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.match(home, /className="hy-card ph-glass ph-referral hy-press"/);
  assert.match(home, /ph-frost ph-frost--stack/);
  assert.match(home, /ph-frost__wash/);
  assert.match(home, /parent\.referral\.home\.headline/);
  assert.match(home, /parent\.referral\.home\.action/);
  assert.match(home, /<ReferralRewardPanel/);
  // 가족의 보호자면 보이고, 만들기 권한은 패널이 canManage 로 구분한다(공동 보호자는 공유만).
  assert.match(home, /family\?\.myRole === "parent" && \(/);
  assert.match(read("src/components/ReferralRewardPanel.tsx"), /status\.canManage/);
  assert.equal(koParent["parent.referral.home.headline"], "친구 초대하면 AI 대화 {count}회");
  assert.equal(koParent["parent.referral.home.action"], "초대하기");
});

test("보상 크레딧 표시 기본값은 서버 정책 상수와 같다", () => {
  const clientPolicy = read("src/transform/referralReward.ts");
  const serverPolicy = read("worker/lib/referralRewardsV2.ts");
  const client = Number(/REFERRAL_REWARD_CREDITS_DISPLAY = (\d+)/.exec(clientPolicy)?.[1]);
  const server = Number(/export const REFERRAL_REWARD_CREDITS = (\d+)/.exec(serverPolicy)?.[1]);
  assert.ok(Number.isSafeInteger(client) && client > 0, "클라이언트 표시 상수를 찾지 못했습니다");
  assert.equal(client, server, "표시 기본값과 서버 지급액이 어긋났습니다");
  // 상한은 서버에서 완전히 사라졌다.
  assert.doesNotMatch(serverPolicy, /REFERRAL_SUCCESS_CAP/);
  // 지급은 귀속 시점에 약속한 금액을 그대로 쓴다.
  assert.match(serverPolicy, /const rewardCredits = Number\(row\.reward_credits\)/);
});

test("추천 공유 payload는 실제 locale 메시지를 {link}와 함께 문장 전체로 포맷한다", () => {
  const panel = read("src/components/ReferralRewardPanel.tsx");
  const link = "https://hyeni-calendar.pages.dev/?ref=FAMILY10";
  const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

  assert.match(panel, /id: "parent\.referralRewardPanel\.shareBody"/);
  assert.match(panel, /\{\s*link\s*:/);
  assert.doesNotMatch(panel, /`혜니캘린더에서/);

  for (const locale of locales) {
    const messages = JSON.parse(read(`locales/${locale}/parent.json`));
    assert.equal(typeof messages["parent.referralRewardPanel.shareBody"], "string", `${locale}: 공유 본문 키 누락`);
    const intl = createIntl({ locale, messages }, createIntlCache());
    const payload = intl.formatMessage(
      { id: "parent.referralRewardPanel.shareBody" },
      { link, count: 50 },
    );
    const brand = localizedBrandName(locale);
    assert.equal(payload.split(brand).length - 1, 1, `${locale}: 공통 브랜드 정본은 정확히 한 번`);
    assert.equal(payload.split(link).length - 1, 1, `${locale}: 링크는 정확히 한 번`);
    assert.match(payload, /3/);
    assert.match(payload, /50/);
    // 링크 길이는 정책이 아니므로 문구 길이만 본다.
    const copyLength = payload.replace(link, "").trim().length;
    assert.ok(copyLength <= 140, `${locale}: 공유 문구가 너무 깁니다(${copyLength}자)`);
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
