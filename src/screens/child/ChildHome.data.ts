import type { AccentKey } from "@/theme/theme";

/** 아이 홈 목업 데이터 (시안 dc.html 305–491행 기준). 결합 회피용 자체 정의. */

export const childName = "지우";

export const childNext = {
  title: "태권도",
  sub: "튼튼 태권도장 · 오후 4:00",
} as const;

/** 내 색깔 고르기 — data-accent 스위치와 1:1. */
export const accentSwatches: { key: AccentKey; color: string; label: string }[] = [
  { key: "rose", color: "#F76BA6", label: "딸기" },
  { key: "peach", color: "#FF9E7A", label: "복숭아" },
  { key: "lavender", color: "#A78BFA", label: "라벤더" },
  { key: "mint", color: "#31C48D", label: "민트" },
  { key: "sky", color: "#4FB2E8", label: "하늘" },
  { key: "lemon", color: "#F5C542", label: "레몬" },
];

export type TimetableItem = {
  id: string;
  time: string;
  timeColor: string;
  dotColor: string;
  soft: string;
  icon: string;
  title: string;
  place: string;
  now: boolean;
};

export const childTimetable: TimetableItem[] = [
  {
    id: "t1",
    time: "08:20",
    timeColor: "#A99FA4",
    dotColor: "#4FB2E8",
    soft: "#E6F2FB",
    icon: "cat/school.webp",
    title: "학교 가기",
    place: "햇살초등학교",
    now: false,
  },
  {
    id: "t2",
    time: "15:10",
    timeColor: "var(--hy-accent-text)",
    dotColor: "var(--hy-accent)",
    soft: "var(--hy-accent-soft)",
    icon: "status/happy.webp",
    title: "쉬는 시간",
    place: "집에서 잠깐 쉬기",
    now: true,
  },
  {
    id: "t3",
    time: "16:00",
    timeColor: "#201A1D",
    dotColor: "#31C48D",
    soft: "#E7F8F0",
    icon: "cat/taekwondo.webp",
    title: "태권도",
    place: "튼튼 태권도장",
    now: false,
  },
];

export type PrepKind = "prep" | "hw";
export type PrepItem = { id: string; label: string; kind: PrepKind; done: boolean };

export const childPrepSeed: PrepItem[] = [
  { id: "p1", label: "실내화 가방", kind: "prep", done: true },
  { id: "p2", label: "물감 세트", kind: "prep", done: true },
  { id: "p3", label: "받아쓰기 연습", kind: "hw", done: false },
  { id: "p4", label: "그림일기 쓰기", kind: "hw", done: false },
  { id: "p5", label: "줄넘기", kind: "prep", done: false },
];
