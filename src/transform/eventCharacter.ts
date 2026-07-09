/**
 * 일정 제목 → 3D 캐릭터 에셋(cat/*.webp) 매핑.
 * 아이 홈의 일정 아이콘을 유니코드 이모지 대신 앱 고유 3D 캐릭터로 통일한다
 * (resolvePlaceVisual 과 같은 정적 매핑 원칙 — 서버/AI 생성 없음).
 */
const EVENT_CHARACTER_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/태권도|합기도|검도|주짓수|유도/u, "cat/taekwondo.webp"],
  [/피아노|바이올린|첼로|플루트|기타/u, "cat/piano.webp"],
  [/음악|합창|노래|성가/u, "cat/music.webp"],
  [/수영|물놀이|아쿠아/u, "cat/swim.webp"],
  [/축구|풋살/u, "cat/soccer.webp"],
  [/농구|야구|배드민턴|체육|운동|줄넘기|스포츠|테니스/u, "cat/sports.webp"],
  [/학교|등교|하교|입학|개학/u, "cat/school.webp"],
  [/학원|공부|수학|영어|국어|과학|숙제|독서|논술|시험/u, "cat/study.webp"],
  [/미술|그림|만들기|공예|점토/u, "cat/art.webp"],
  [/친구|놀이|생일|파티/u, "cat/friend.webp"],
  [/가족|여행|외식|나들이|캠핑/u, "cat/family.webp"],
  [/댄스|무용|발레|취미/u, "cat/hobby.webp"],
];

export const DEFAULT_EVENT_CHARACTER = "cat/other.webp";

export function resolveEventCharacter(title: string | null | undefined): string {
  const t = String(title ?? "").trim();
  if (!t) return DEFAULT_EVENT_CHARACTER;
  for (const [pattern, assetPath] of EVENT_CHARACTER_RULES) {
    if (pattern.test(t)) return assetPath;
  }
  return DEFAULT_EVENT_CHARACTER;
}
