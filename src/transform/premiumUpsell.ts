import { MAX_SUPPLY_ITEMS_PER_KIND } from "./eventSupplies.ts";

export type PremiumUpsellSource =
  | "second_child"
  | "saved_place"
  | "danger_zone"
  | "location_request"
  | "location_history"
  | "location_live_interval"
  | "remote_ring"
  | "remote_audio"
  | "ai_friend_limit"
  | "ai_schedule_limit"
  | "ai_daily_summary"
  | "weekly_report"
  | "academy_schedule"
  | "first_location"
  | "first_arrival";

export interface PremiumUpsellContent {
  source: PremiumUpsellSource;
  feature: string;
  title: string;
  description: string;
  premiumValue: string;
  usageLabel: string | null;
  ctaLabel: string;
  continueLabel: "무료로 계속 쓰기";
}

export interface PremiumUpsellUsage {
  used: number;
  limit: number;
}

const CONTINUE_LABEL = "무료로 계속 쓰기" as const;

const CONTENT: Record<PremiumUpsellSource, Omit<PremiumUpsellContent, "source" | "continueLabel">> = {
  second_child: {
    feature: "multi_child",
    title: "무료 플랜의 새 아이 연결은 1명까지예요",
    description: "첫째 아이의 연결과 데이터는 그대로 유지돼요. 이미 연결된 아이는 구독이 끝나도 자동으로 해제하거나 숨기지 않아요.",
    premiumValue: "프리미엄으로 둘째 아이 연결을 계속할 수 있어요.",
    usageLabel: "1/1 사용",
    ctaLabel: "둘째 아이 연결 계속하기",
  },
  saved_place: {
    feature: "saved_places",
    title: "무료 알림 대상 2개를 모두 사용했어요",
    description: "등록한 장소는 삭제되지 않아요. 무료 플랜 알림 대상은 생성 순 2개까지이며, 나머지는 프리미엄에서 다시 알림 대상이 돼요.",
    premiumValue: "프리미엄에서는 장소와 도착·출발 알림을 제한 없이 추가할 수 있어요.",
    usageLabel: "알림 2/2 사용",
    ctaLabel: "장소 계속 추가하기",
  },
  danger_zone: {
    feature: "multi_geofence",
    title: "위험구역 1개를 사용 중이에요",
    description: "등록한 위험구역은 삭제되지 않아요. 무료 플랜 알림 대상은 생성 순 1개까지이며, 나머지는 프리미엄에서 다시 알림 대상이 돼요.",
    premiumValue: "프리미엄에서는 필요한 위험구역을 제한 없이 추가할 수 있어요.",
    usageLabel: "1/1 사용",
    ctaLabel: "위험구역 계속 추가하기",
  },
  location_request: {
    feature: "realtime_location",
    title: "최근 24시간 위치 요청 5회를 모두 사용했어요",
    description: "약 10분 간격 자동 확인과 SOS·긴급 알림은 계속 작동해요.",
    premiumValue: "프리미엄에서는 최근 24시간 횟수 제한 없이 지금 위치를 확인할 수 있어요.",
    usageLabel: "5/5 사용",
    ctaLabel: "프리미엄으로 바로 확인하기",
  },
  location_history: {
    feature: "extended_history",
    title: "지난 이동 기록은 프리미엄에서 확인할 수 있어요",
    description: "무료에서는 오늘 경로를 확인할 수 있어요.",
    premiumValue: "프리미엄에서는 최근 30일까지 이동 기록을 확인할 수 있어요.",
    usageLabel: null,
    ctaLabel: "30일 이동 기록 보기",
  },
  location_live_interval: {
    feature: "realtime_location",
    title: "실시간 위치 전송은 프리미엄 기능이에요",
    description: "무료에서는 균형·절약 모드와 약 10분 간격 위치 확인을 이용할 수 있어요.",
    premiumValue: "프리미엄에서는 아이 기기의 실시간 모드를 선택해 위치 변화를 더 빠르게 확인할 수 있어요.",
    usageLabel: null,
    ctaLabel: "실시간 위치 사용하기",
  },
  remote_ring: {
    feature: "remote_ring_quota",
    title: "최근 24시간 소리 울리기 1회를 사용했어요",
    description: "SOS와 긴급 안전 알림은 횟수와 관계없이 계속 작동해요.",
    premiumValue: "프리미엄에서는 최근 24시간 10회까지 아이 기기의 소리를 울릴 수 있어요.",
    usageLabel: "1/1 사용",
    ctaLabel: "최근 24시간 10회로 늘리기",
  },
  remote_audio: {
    feature: "remote_audio",
    title: "주변 소리 듣기는 프리미엄 기능이에요",
    description: "아이가 누르지 않아도 연결되고, 듣는 동안 아이 화면과 알림에 계속 표시돼요. 최대 1분 뒤 자동 종료되고 청취 기록이 남아요. 위급할 때만 사용해 주세요.",
    premiumValue: "프리미엄에서 위급할 때 아이 주변 소리를 최대 1분 확인할 수 있어요.",
    usageLabel: null,
    ctaLabel: "프리미엄으로 주변 소리 듣기",
  },
  ai_friend_limit: {
    feature: "ai_friend_daily_limit",
    title: "무료 AI 친구 5회를 모두 사용했어요",
    description: "일정·메모·SOS와 기본 안전 기능은 무료로 계속 이용할 수 있어요.",
    premiumValue: "프리미엄에서는 아이별 AI 친구 대화를 하루 20회 기본 제공해요.",
    usageLabel: "5/5 사용",
    ctaLabel: "AI 친구 하루 20회로 늘리기",
  },
  ai_schedule_limit: {
    feature: "ai_schedule_daily_limit",
    title: "오늘 무료 AI 일정 정리 5회를 모두 사용했어요",
    description: "직접 일정 추가와 기존 일정 관리는 무료에서도 제한 없이 계속할 수 있어요. 이미 저장한 일정도 그대로 유지돼요.",
    premiumValue: "프리미엄에서는 음성·텍스트·사진의 AI 일정 정리를 하루 횟수 제한 없이 이용할 수 있어요.",
    usageLabel: "5/5 사용",
    ctaLabel: "AI 일정 정리 제한 없애기",
  },
  ai_daily_summary: {
    feature: "ai_analysis",
    title: "AI 하루 요약은 프리미엄 기능이에요",
    description: "오늘의 일정과 기본 안심 리포트는 무료에서도 확인할 수 있어요.",
    premiumValue: "AI가 오늘의 일정·위치·안전 기록을 한눈에 정리해 드려요.",
    usageLabel: null,
    ctaLabel: "AI 하루 요약 보기",
  },
  weekly_report: {
    feature: "weekly_report",
    title: "이번 주 한 줄 요약을 확인했어요",
    description: "실제 가족 기록으로 만든 한 줄 요약은 무료로 제공돼요.",
    premiumValue: "프리미엄에서는 주간 리포트 전체와 상세 흐름을 확인할 수 있어요.",
    usageLabel: null,
    ctaLabel: "주간 리포트 전체 보기",
  },
  academy_schedule: {
    feature: "academy_schedule",
    title: "학원 시간표 관리는 프리미엄 기능이에요",
    description: `직접 일정 추가와 기존 일정 관리·메모·스티커는 무료에서도 제한 없이 이용할 수 있어요. 준비물과 숙제는 모든 플랜에서 아이별 하루 각각 ${MAX_SUPPLY_ITEMS_PER_KIND}개까지 저장할 수 있어요.`,
    premiumValue: "프리미엄에서는 학원 시간표와 위치 흐름을 함께 관리할 수 있어요.",
    usageLabel: null,
    ctaLabel: "학원 시간표 사용하기",
  },
  first_location: {
    feature: "first_location_value",
    title: "아이의 첫 위치가 정상적으로 도착했어요",
    description: "최신 실측 위치와 오늘 이동 기록은 무료로 계속 확인할 수 있어요.",
    premiumValue: "프리미엄에서는 실시간 위치와 30일 이동 기록, 상세 안심 인사이트를 함께 확인할 수 있어요.",
    usageLabel: null,
    ctaLabel: "상세 안심 기능 보기",
  },
  first_arrival: {
    feature: "first_arrival_value",
    title: "아이의 도착을 잘 확인했어요",
    description: "무료 한도 안의 저장 장소 도착·출발 알림은 무료로 계속 받을 수 있어요.",
    premiumValue: "프리미엄에서는 실시간 위치와 30일 이동 기록, 상세 안심 인사이트를 함께 확인할 수 있어요.",
    usageLabel: null,
    ctaLabel: "상세 안심 기능 보기",
  },
};

export function resolvePremiumUpsell(
  source: PremiumUpsellSource,
  usage?: PremiumUpsellUsage,
): PremiumUpsellContent {
  const savedPlaceUsage = source === "saved_place"
    && usage
    && Number.isInteger(usage.used)
    && usage.used >= 0
    && Number.isInteger(usage.limit)
    && usage.limit > 0
    ? usage
    : null;
  return {
    source,
    ...CONTENT[source],
    ...(savedPlaceUsage
      ? {
          title: `무료 알림 대상 ${savedPlaceUsage.limit}개를 모두 사용했어요`,
          description: `등록한 장소는 삭제되지 않아요. 현재 플랜 알림 대상은 생성 순 ${savedPlaceUsage.limit}개까지이며, 나머지는 프리미엄에서 다시 알림 대상이 돼요.`,
          usageLabel: savedPlaceUsage.used > savedPlaceUsage.limit
            ? `알림 ${savedPlaceUsage.limit}/${savedPlaceUsage.limit} · 저장 ${savedPlaceUsage.used}개`
            : `알림 ${savedPlaceUsage.used}/${savedPlaceUsage.limit} 사용`,
        }
      : {}),
    continueLabel: CONTINUE_LABEL,
  };
}
