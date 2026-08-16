import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import legacyKoreanMessages from "../src/i18n/generated/legacyKoreanMessages.ts";
import { legacyKoreanMessageIds } from "../scripts/i18n/legacy-korean-message-ids.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("동기 한국어 fallback 생성물은 명시한 actual-use ID와 정확히 일치한다", () => {
  assert.deepEqual(Object.keys(legacyKoreanMessages).sort(), legacyKoreanMessageIds);
  assert.equal(legacyKoreanMessageIds.length, 248);
});

test("defaultIntl 호출자의 정적 message ID는 모두 최소 fallback에 포함된다", () => {
  const consumerPaths = [
    "adventureMap.ts",
    "aiScheduleDraft.ts",
    "deviceAppUsageView.ts",
    "deviceNotificationHealth.ts",
    "deviceUnlock.ts",
    "eventScope.ts",
    "familyView.ts",
    "locationTrustCopy.ts",
    "locationView.ts",
    "memoChatCopy.ts",
    "memoQuickReplies.ts",
    "notificationsView.ts",
    "placeVisual.ts",
    "playdateNotice.ts",
    "premiumUpsell.ts",
    "scheduleView.ts",
    "tierAlertActivation.ts",
    "tierPolicy.ts",
    "weeklyReportView.ts",
  ];
  const missing = [];
  for (const filename of consumerPaths) {
    const source = readFileSync(join(rootDir, "src", "transform", filename), "utf8");
    const staticIds = [...source.matchAll(
      /["'`](child|notifications|parent|reports|shared)\.[a-zA-Z][a-zA-Z0-9_.-]+["'`]/g,
    )].map((match) => match[0].slice(1, -1));
    for (const id of staticIds) {
      if (!id.includes("${") && !Object.hasOwn(legacyKoreanMessages, id)) missing.push(`${filename}:${id}`);
    }
  }
  assert.deepEqual(missing, []);
});
