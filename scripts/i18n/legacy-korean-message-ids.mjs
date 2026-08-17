import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDefaultIntlUsage } from "./default-intl-usage.mjs";

const MEMO_COPY_FIELDS = [
  "noConversation",
  "loading",
  "loadError",
  "empty",
  "inputPlaceholder",
  "emptyDraft",
  "sendFailed",
  "imageFailed",
  "imageLoadFailed",
  "locationFailed",
  "locationUnavailable",
];
const MEMO_COPY_IDS = MEMO_COPY_FIELDS.flatMap((field) =>
  ["child", "formal"].map((tone) => `shared.memo.copy.${field}.${tone}`));

const MEMO_QUICK_PARENT_IDS = [1, 2, 3, 4, 5]
  .map((index) => `shared.memo.quick.parent.${index}`);
const MEMO_QUICK_CHILD_IDS = [1, 2, 3, 4, 5]
  .map((index) => `shared.memo.quick.child.${index}`);

const PLACE_LABEL_IDS = [
  "taekwondo",
  "piano",
  "swim",
  "soccer",
  "art",
  "music",
  "school",
  "study",
  "sports",
  "play",
  "family",
  "hobby",
  "church",
  "apartment",
  "park",
  "mart",
  "hospital",
  "library",
].map((place) => `parent.place.${place}`);

const PREMIUM_UPSELL_SOURCES = [
  "second_child",
  "saved_place",
  "danger_zone",
  "location_request",
  "location_history",
  "location_live_interval",
  "remote_ring",
  "remote_audio",
  "ai_friend_limit",
  "ai_schedule_limit",
  "ai_daily_summary",
  "weekly_report",
  "academy_schedule",
  "first_location",
  "first_arrival",
];
const PREMIUM_UPSELL_USAGE_SOURCES = [
  "second_child",
  "saved_place",
  "danger_zone",
  "location_request",
  "remote_ring",
  "ai_friend_limit",
  "ai_schedule_limit",
];

export const defaultIntlDynamicUsages = Object.freeze([
  {
    importer: "src/transform/deviceNotificationHealth.ts",
    pattern: "`parent.device.safety.${state}`",
    ids: ["ready", "attention", "unknown"].map((state) => `parent.device.safety.${state}`),
    reason: "기기 안전 상태 union의 세 값만 message ID에 사용할 수 있습니다.",
  },
  {
    importer: "src/transform/memoChatCopy.ts",
    pattern: "`shared.memo.copy.${field}.${tone}`",
    ids: MEMO_COPY_IDS,
    reason: "메모 copy field와 child/formal tone의 닫힌 곱집합입니다.",
  },
  {
    importer: "src/transform/memoQuickReplies.ts",
    pattern: "`shared.memo.quick.parent.${index}`",
    ids: MEMO_QUICK_PARENT_IDS,
    reason: "부모 빠른 답장 인덱스는 1~5로 고정됩니다.",
  },
  {
    importer: "src/transform/memoQuickReplies.ts",
    pattern: "`shared.memo.quick.child.${index}`",
    ids: MEMO_QUICK_CHILD_IDS,
    reason: "아이 빠른 답장 인덱스는 1~5로 고정됩니다.",
  },
  {
    importer: "src/transform/memoQuickReplies.ts",
    pattern: "`shared.memo.quick.${sender}.${index}`",
    ids: [...MEMO_QUICK_PARENT_IDS, ...MEMO_QUICK_CHILD_IDS],
    reason: "sender는 parent/child이고 인덱스는 1~5인 닫힌 조합입니다.",
  },
  {
    importer: "src/transform/placeVisual.ts",
    pattern: "match.labelId",
    ids: PLACE_LABEL_IDS,
    reason: "장소 시각 매핑 표의 labelId 후보를 exact 목록으로 제한합니다.",
  },
  ...["title", "description", "premiumValue", "ctaLabel"].map((field) => ({
    importer: "src/transform/premiumUpsell.ts",
    pattern: `\`parent.upsell.\${source}.${field}\``,
    ids: PREMIUM_UPSELL_SOURCES.map((source) => `parent.upsell.${source}.${field}`),
    reason: `Premium upsell source union의 ${field} message ID 목록입니다.`,
  })),
  {
    importer: "src/transform/premiumUpsell.ts",
    pattern: "`parent.upsell.${source}.usageLabel`",
    ids: PREMIUM_UPSELL_USAGE_SOURCES.map((source) => `parent.upsell.${source}.usageLabel`),
    reason: "사용량 표시가 있는 Premium upsell source만 포함합니다.",
  },
  {
    importer: "src/transform/scheduleView.ts",
    pattern: '`parent.schedule.tag.${tag.tag === "진행 중" ? "ongoing" : tag.tag === "다녀옴" ? "visited" : tag.tag === "확인 필요" ? "verify" : "upcoming"}`',
    ids: ["ongoing", "visited", "verify", "upcoming"].map((tag) => `parent.schedule.tag.${tag}`),
    reason: "일정 상태 태그의 네 분기만 message ID로 선택합니다.",
  },
]);

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const discoveredUsage = auditDefaultIntlUsage({ rootDir, dynamicUsages: defaultIntlDynamicUsages });
if (discoveredUsage.violations.length > 0) {
  throw new Error(discoveredUsage.violations.join("\n"));
}

export const legacyKoreanMessageIds = discoveredUsage.messageIds;
