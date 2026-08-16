import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createIntl, createIntlCache, type IntlShape } from "react-intl";

import { buildDeviceAppUsageView } from "../src/transform/deviceAppUsageView.ts";
import {
  deviceLocationHealthView,
  deviceNotificationHealthView,
} from "../src/transform/deviceNotificationHealth.ts";
import { unlockCountLabel } from "../src/transform/deviceUnlock.ts";
import * as eventScope from "../src/transform/eventScope.ts";
import { resolvePremiumUpsell, type PremiumUpsellContent } from "../src/transform/premiumUpsell.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const messages = JSON.parse(read("locales/en/parent.json"));
const intl = createIntl({ locale: "en", messages }, createIntlCache()) as IntlShape;
const NOW = new Date("2026-07-14T06:00:00.000Z");
const RECENT_REPORT = "2026-07-14T05:55:00.000Z";

const readyHealth = {
  updatedAt: RECENT_REPORT,
  batteryLevel: 80,
  deviceUnlockCount: 2,
  deviceScreenOnMs: 90 * 60_000,
  networkConnected: true,
  networkType: "wifi",
  postPermissionGranted: true,
  notificationsEnabled: true,
  requiredChannelsEnabled: true,
  fullScreenIntentAllowed: true,
  remoteListenChannelEnabled: true,
  postNotif: true,
  backgroundLocationGranted: true,
  backgroundRestricted: false,
  locationServiceRunning: true,
  usagePermission: "granted" as const,
  recentApp: "카카오톡",
  appUsage: [
    { name: "카카오톡", packageName: "com.kakao.talk", usageMs: 90 * 60_000 },
  ],
};

test("ParentHome 안전 formatter는 현재 IntlShape을 끝까지 사용하고 의미 상태를 별도 보존한다", () => {
  const notification = deviceNotificationHealthView(
    readyHealth,
    { now: NOW, childScheduleEnabled: true, childScheduleLoadState: "ready" },
    intl,
  );
  const location = deviceLocationHealthView(readyHealth, NOW, intl);
  const appUsage = buildDeviceAppUsageView(readyHealth, 3, intl);
  const familyView = read("src/transform/familyView.ts");
  const parentHome = read("src/screens/parent/ParentHome.tsx");

  assert.equal(notification.state, "ready");
  assert.equal(notification.label, "Notification display is ready");
  assert.equal(notification.shortLabel, "Notifications ready");
  assert.equal(location.state, "ready");
  assert.equal(location.label, "Location sharing is ready");
  assert.equal(unlockCountLabel(2, intl), "2 unlocks today");
  assert.equal(appUsage.mostUsedApp?.timeLabel, "1 hour 30 minutes");
  assert.equal(appUsage.mostUsedApp?.name, "카카오톡", "사용자 앱 이름은 번역하지 않습니다");
  assert.match(familyView, /deviceNotificationHealthView\(health, \{[\s\S]*?\}, intl\)/);
  assert.match(familyView, /deviceLocationHealthView\(health, now, intl\)/);
  assert.match(familyView, /unlockCountLabel\(health\.deviceUnlockCount, intl\)/);
  assert.match(familyView, /buildDeviceAppUsageView\(health, 3, intl\)/);
  assert.match(familyView, /safetyState:/);
  assert.match(parentHome, /data-state=\{deviceStatus\.safetyState\}/);
  assert.doesNotMatch(parentHome, /safetyLabel === "양호"|safetyLabel === "주의 필요"/);
});

test("잠금 해제와 앱 사용 시간은 각 count를 포함한 ICU 메시지로 포맷한다", () => {
  assert.equal(unlockCountLabel(0, intl), "No unlocks today");
  assert.equal(unlockCountLabel(1, intl), "1 unlock today");
  assert.equal(unlockCountLabel(2, intl), "2 unlocks today");

  const view = buildDeviceAppUsageView({
    recentApp: "YouTube",
    appUsage: [
      { name: "YouTube", packageName: "com.google.android.youtube", usageMs: 61 * 60_000 },
      { name: "KakaoTalk", packageName: "com.kakao.talk", usageMs: 1 * 60_000 },
    ],
  }, 3, intl);
  assert.equal(view.topApps[0]?.timeLabel, "1 hour 1 minute");
  assert.equal(view.topApps[1]?.timeLabel, "1 minute");
});

test("MemoChat은 가족 데이터가 같아도 intl만 바뀌면 이름·상대·사진 저장 문구를 다시 계산한다", () => {
  const memo = read("src/screens/shared/MemoChat.tsx");
  assert.match(memo, /const memberByUserId = useMemo\([\s\S]*?\}, \[family, intl\]\);/);
  assert.match(memo, /const peer = useMemo\([\s\S]*?\}, \[family, intl, role, scopeChild\]\);/);
  assert.match(memo, /const savePreviewPhoto = useCallback\([\s\S]*?\}, \[intl, isChildSession, previewImageUrl, savingPhoto, show\]\);/);
});

test("가족 공유와 자녀 연결 상태는 공용 helper에서 미배정 의미를 정확히 판정한다", () => {
  const event = (isFamily: boolean, childIds: string[]) => ({
    id: crypto.randomUUID(),
    family_id: "family-1",
    title: "일정",
    date_key: "2026-7-16",
    start_time: "09:00",
    end_time: "10:00",
    is_family_event: isFamily,
    events_children: childIds.map((child_id) => ({ child_id })),
  });
  const needsAssignment = (eventScope as typeof eventScope & {
    eventNeedsChildAssignment?: (value: ReturnType<typeof event>) => boolean;
  }).eventNeedsChildAssignment;

  assert.equal(typeof needsAssignment, "function", "공용 미배정 의미 helper가 필요합니다");
  assert.equal(needsAssignment?.(event(true, [])), false, "가족 공유 일정은 자녀 link가 없어도 정상입니다");
  assert.equal(needsAssignment?.(event(false, [])), true, "비공유 일정에 자녀 link가 없으면 미배정입니다");
  assert.equal(needsAssignment?.(event(false, ["child-member-1"])), false, "자녀 link가 있으면 배정 완료입니다");
});

test("ParentCalendar 목록·시트·CTA는 같은 미배정 의미 helper를 사용한다", () => {
  const calendar = read("src/screens/parent/ParentCalendar.tsx");
  assert.match(calendar, /eventToView\([\s\S]*?savedPlaces,\s*intl,\s*\)/);
  assert.match(calendar, /eventNeedsChildAssignment\(sheetEvent\)/);
  assert.match(calendar, /eventNeedsChildAssignment\(raw\)/);
  assert.doesNotMatch(calendar, /=== "배정 필요"/);
});

test("PremiumUpsell continueLabel은 모든 locale에서 글쓰기가 아닌 Free 플랜 계속 사용을 안내한다", () => {
  const expected = {
    ko: "무료 플랜으로 계속 사용하기",
    en: "Continue with Free",
    ja: "無料プランで続ける",
    "zh-CN": "继续使用免费版",
    "zh-TW": "繼續使用免費版",
    vi: "Tiếp tục sử dụng gói miễn phí",
    th: "ใช้งานแผนฟรีต่อ",
    id: "Lanjutkan dengan paket gratis",
    ms: "Teruskan dengan pelan percuma",
    fil: "Magpatuloy sa libreng plano",
  } as const;
  const values: string[] = [];
  for (const [locale, want] of Object.entries(expected)) {
    const localeMessages = JSON.parse(read(`locales/${locale}/parent.json`));
    const localeIntl = createIntl({ locale, messages: localeMessages }, createIntlCache()) as IntlShape;
    const actual = resolvePremiumUpsell("remote_audio", undefined, localeIntl).continueLabel;
    assert.equal(actual, want, locale);
    assert.doesNotMatch(actual, /writing|write|写作|寫作|書|เขียน|menulis|viết|sumulat/i, `${locale}: 글쓰기 오역`);
    values.push(actual);
  }

  const premiumUpsell = read("src/transform/premiumUpsell.ts");
  assert.match(premiumUpsell, /continueLabel:\s*string;/);
  assert.doesNotMatch(premiumUpsell, /as PremiumUpsellContent\["continueLabel"\]/);
  const assignable: PremiumUpsellContent["continueLabel"] = "Continue with Free";
  assert.equal(assignable, values[1]);
});

test("ParentAccount 전화 입력은 10개 locale에서 실제 KR formatter 계약과 한계 안내를 표시한다", () => {
  const expectedHelp = {
    ko: "현재는 한국 휴대폰 번호만 지원합니다.",
    en: "Currently, only Korean mobile phone numbers are supported.",
    ja: "現在は韓国の携帯電話番号のみ対応しています。",
    "zh-CN": "目前仅支持韩国手机号码。",
    "zh-TW": "目前僅支援韓國手機號碼。",
    vi: "Hiện tại chỉ hỗ trợ số điện thoại di động Hàn Quốc.",
    th: "ขณะนี้รองรับเฉพาะหมายเลขโทรศัพท์มือถือของเกาหลีใต้เท่านั้น",
    id: "Saat ini hanya nomor ponsel Korea Selatan yang didukung.",
    ms: "Buat masa ini, hanya nombor telefon bimbit Korea Selatan disokong.",
    fil: "Sa ngayon, mga numero ng mobile phone sa South Korea lamang ang sinusuportahan.",
  } as const;
  for (const [locale, help] of Object.entries(expectedHelp)) {
    const localeMessages = JSON.parse(read(`locales/${locale}/parent.json`));
    const localeIntl = createIntl({ locale, messages: localeMessages }, createIntlCache()) as IntlShape;
    assert.equal(localeIntl.formatMessage({ id: "parent.parentAccount.phonePlaceholder" }), "010-0000-0000", locale);
    assert.equal(localeIntl.formatMessage({ id: "parent.parentAccount.phoneKoreanOnlyHelp" }), help, locale);
  }

  const account = read("src/screens/parent/ParentAccount.tsx");
  assert.match(account, /formatPhoneDisplay\(e\.target\.value\)/);
  assert.match(account, /parent\.parentAccount\.phoneKoreanOnlyHelp/);
});
