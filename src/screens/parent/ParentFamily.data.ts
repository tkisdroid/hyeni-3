/**
 * 가족 화면 목업 데이터 (백엔드 연동 전 임시).
 * 배터리 신호색: 민트=양호(안전), 앰버=주의. 위치 칩은 항상 민트(양호).
 */

export type Parent = {
  id: string;
  name: string;
  role: string;
  avatar: string; // asset path (family/*.webp)
  badge?: string;
};

export type Child = {
  id: string;
  name: string;
  info: string;
  avatar: string; // asset path
  soft: string; // 아바타 타일 배경
  battery: number;
  batBg: string; // 배터리 칩 배경(신호색)
  batColor: string; // 배터리 칩 글자(신호색)
  place: string;
};

export const parents: Parent[] = [
  { id: "pa1", name: "김서연", role: "엄마 · 관리자", avatar: "family/mom.webp", badge: "나" },
  { id: "pa2", name: "이준호", role: "아빠 · 보호자", avatar: "family/dad.webp" },
];

export const children: Child[] = [
  {
    id: "ch1",
    name: "지우",
    info: "3학년 · 햇살초등학교",
    avatar: "mascot/wave.webp",
    soft: "#FDE7F1",
    battery: 82,
    batBg: "#E7F8F0",
    batColor: "#087653",
    place: "집 근처",
  },
  {
    id: "ch2",
    name: "하준",
    info: "1학년 · 햇살초등학교",
    avatar: "animal/bear.webp",
    soft: "#E6F2FB",
    battery: 24,
    batBg: "#FDF0DA",
    batColor: "#E08A1E",
    place: "학교",
  },
];
