export const supportedLocales = ["ko", "ja", "zh-TW", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export interface MessageBundle {
  dailyReportTitle: string;
  dailyReportSubtitle: string;
  weeklyReportTitle: string;
  weeklyReportSubtitle: string;
}

export const messages: Record<SupportedLocale, MessageBundle> = {
  ko: {
    dailyReportTitle: "오늘의 안심 리포트",
    dailyReportSubtitle: "아이의 하루를 한눈에 확인해요",
    weeklyReportTitle: "주간 가족 리포트",
    weeklyReportSubtitle: "이번 주 흐름을 정리해 드려요",
  },
  ja: {
    dailyReportTitle: "今日の安心レポート",
    dailyReportSubtitle: "お子さまの一日をひと目で確認できます",
    weeklyReportTitle: "週間ファミリーレポート",
    weeklyReportSubtitle: "今週の流れをまとめます",
  },
  "zh-TW": {
    dailyReportTitle: "今日安心報告",
    dailyReportSubtitle: "一眼確認孩子今天的狀態",
    weeklyReportTitle: "每週家庭報告",
    weeklyReportSubtitle: "整理本週的日常動態",
  },
  en: {
    dailyReportTitle: "Today’s Safety Report",
    dailyReportSubtitle: "See your child’s day at a glance",
    weeklyReportTitle: "Weekly Family Report",
    weeklyReportSubtitle: "Review your family’s week in one place",
  },
};

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (supportedLocales as readonly string[]).includes(locale);
}

export function getMessages(locale: string | null | undefined = "ko"): MessageBundle {
  return locale && isSupportedLocale(locale) ? messages[locale] : messages.ko;
}
