/**
 * 부모 캘린더 목업 데이터 (백엔드 연동 전 임시).
 * 오늘(TODAY)은 부모 홈 목업(11월 19일 수요일)과 일치하도록 2025-11-19 고정.
 */

export type CalEvent = {
  id: string;
  color: string; // 타임라인 노드 · 그리드 점 색
  soft: string; // 아이콘 타일 배경 · 노드 글로우
  icon: string; // asset path (cat/*.webp)
  time: string;
  title: string;
  place: string;
  tag: string;
  tagText: string;
  tagBg: string;
};

/** 오늘 (부모 홈 목업과 동일: 2025-11-19, 수요일) */
export const TODAY = { year: 2025, month: 11, day: 19 } as const;

/** 요일 헤더 (getDay 기준: 0=일) */
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const TAG_DONE = { tag: "다녀옴", tagText: "#8B7E84", tagBg: "#F2EEF0" };
const TAG_NOW = { tag: "진행 중", tagText: "#087653", tagBg: "#E7F8F0" };
const TAG_PLAN = { tag: "예정", tagText: "var(--hy-accent-text)", tagBg: "var(--hy-accent-soft)" };

/** 11월 일자별 일정 (일-of-month 키). 그 외 날은 일정 없음 상태. */
export const CAL_EVENTS: Record<number, CalEvent[]> = {
  19: [
    { id: "e19a", color: "#8B6BEC", soft: "#F1ECFF", icon: "cat/piano.webp", time: "오후 2:00", title: "피아노 학원", place: "예음피아노", ...TAG_DONE },
    { id: "e19b", color: "#2E86C1", soft: "#E6F2FB", icon: "cat/school.webp", time: "오후 4:00", title: "영어학원", place: "해든영어", ...TAG_NOW },
    { id: "e19c", color: "#F26B3F", soft: "#FFEEE3", icon: "cat/taekwondo.webp", time: "오후 6:00", title: "태권도", place: "한빛태권도", ...TAG_PLAN },
  ],
  21: [
    { id: "e21a", color: "#E08A1E", soft: "#FFF3D6", icon: "cat/art.webp", time: "오후 3:00", title: "미술학원", place: "예린미술", ...TAG_PLAN },
  ],
  24: [
    { id: "e24a", color: "#2E86C1", soft: "#E6F2FB", icon: "cat/swim.webp", time: "오후 5:00", title: "수영 강습", place: "블루수영장", ...TAG_PLAN },
  ],
  25: [
    { id: "e25a", color: "#31C48D", soft: "#E7F8F0", icon: "cat/soccer.webp", time: "오전 10:00", title: "축구 교실", place: "시민운동장", ...TAG_PLAN },
    { id: "e25b", color: "var(--hy-accent)", soft: "var(--hy-accent-soft)", icon: "cat/family.webp", time: "오후 7:00", title: "가족 저녁", place: "할머니 댁", ...TAG_PLAN },
  ],
  28: [
    { id: "e28a", color: "var(--hy-accent)", soft: "var(--hy-accent-soft)", icon: "cat/friend.webp", time: "오후 1:00", title: "친구 생일파티", place: "키즈카페", ...TAG_PLAN },
  ],
};
