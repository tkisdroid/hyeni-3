/**
 * 부모 홈 목업 데이터 (백엔드 연동 전 임시).
 * 실제 데이터 모델은 design-system/spec/INFORMATION-ARCHITECTURE.md 참고.
 */

export type ScheduleTag = { label: string; bg: string; text: string };
export type ScheduleItem = {
  id: string;
  title: string;
  sub: string;
  icon: string; // asset path (cat/*.webp)
  soft: string; // 아이콘 타일 배경
  tag: ScheduleTag;
};

export type RecentApp = { id: string; name: string; emoji: string; soft: string; time: string };

export type PrepItem = {
  id: string;
  label: string;
  done: boolean;
  kind: "prep" | "hw";
};

export type Shortcut = {
  id: string;
  label: string;
  icon: string; // asset path (ui/*.webp)
  soft: string;
  shadow: string;
  badge?: number;
};

export const TAG_PLAN: ScheduleTag = { label: "예정", bg: "var(--hy-accent-soft)", text: "var(--hy-accent-text)" };
export const TAG_DONE: ScheduleTag = { label: "다녀옴", bg: "#F2EEF0", text: "#8B7E84" };
export const TAG_NOW: ScheduleTag = { label: "진행 중", bg: "#E7F8F0", text: "#087653" };

export const today = {
  weekday: "수요일 · 11월 19일",
  childName: "지우",
  count: 3,
};

export const todaySchedule: ScheduleItem[] = [
  { id: "s1", title: "피아노 학원", sub: "오후 2:00 · 예음피아노", icon: "cat/piano.webp", soft: "#F1ECFF", tag: TAG_NOW },
  { id: "s2", title: "영어학원", sub: "오후 4:00 · 해든영어", icon: "cat/school.webp", soft: "#E6F2FB", tag: TAG_PLAN },
  { id: "s3", title: "태권도", sub: "오후 6:00 · 한빛태권도", icon: "cat/taekwondo.webp", soft: "#FFEEE3", tag: TAG_PLAN },
];

export const child = {
  name: "지우",
  grade: "3학년",
  avatar: "mascot/wave.webp",
  soft: "#FDE7F1",
  loc: "예음피아노 근처 · 방금",
  next: "영어학원 4:00",
  attend: "등교",
};

export const safety = {
  battery: 82,
  screenTime: "1시간 20분",
  unlockCount: "6회",
  network: "Wi-Fi",
  updatedLabel: "방금 업데이트됨",
};

export const recentApps: RecentApp[] = [
  { id: "a1", name: "유튜브 키즈", emoji: "📺", soft: "#FFECEE", time: "42분" },
  { id: "a2", name: "카카오톡", emoji: "💬", soft: "#FFF6DC", time: "18분" },
  { id: "a3", name: "웹툰", emoji: "📚", soft: "#E7F8F0", time: "12분" },
];

export const prepItems: PrepItem[] = [
  { id: "p1", label: "체육복", done: true, kind: "prep" },
  { id: "p2", label: "리코더", done: false, kind: "prep" },
  { id: "p3", label: "수학 문제집 p.24", done: false, kind: "hw" },
  { id: "p4", label: "받아쓰기 연습", done: true, kind: "hw" },
  { id: "p5", label: "실내화", done: false, kind: "prep" },
];

export const memoPreview = {
  from: "지우",
  text: "엄마, 오늘 학원 끝나고 놀아도 돼요?",
  time: "방금 전",
  unread: 2,
};

export const shortcuts: Shortcut[] = [
  { id: "sc1", label: "AI 일정", icon: "ui/menu-ai-schedule.webp", soft: "var(--lav-soft)", shadow: "color-mix(in srgb, var(--lav-600) 16%, transparent)" },
  { id: "sc2", label: "위치추적", icon: "ui/menu-child-tracker.webp", soft: "var(--blue-soft)", shadow: "color-mix(in srgb, var(--blue-500) 16%, transparent)" },
  { id: "sc3", label: "친구놀이", icon: "ui/menu-friend-playdate.webp", soft: "var(--cream-soft)", shadow: "color-mix(in srgb, var(--gold-600) 16%, transparent)" },
  { id: "sc4", label: "장소관리", icon: "ui/menu-place-manager.webp", soft: "var(--mint-soft)", shadow: "color-mix(in srgb, var(--mint-600) 16%, transparent)" },
  { id: "sc5", label: "주변소리", icon: "ui/menu-remote-audio.webp", soft: "var(--rose-soft)", shadow: "color-mix(in srgb, var(--rose-600) 16%, transparent)" },
  { id: "sc6", label: "안심리포트", icon: "ui/shield-heart.webp", soft: "var(--mint-soft)", shadow: "color-mix(in srgb, var(--mint-600) 16%, transparent)" },
  { id: "sc7", label: "아이 기기 찾기", icon: "ui/phone-lavender.webp", soft: "var(--lav-soft)", shadow: "color-mix(in srgb, var(--lav-600) 16%, transparent)" },
  { id: "sc8", label: "알림", icon: "ui/bell.webp", soft: "var(--blue-soft)", shadow: "color-mix(in srgb, var(--blue-500) 16%, transparent)" },
];
