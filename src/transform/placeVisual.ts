export interface PlaceVisualInput {
  name: string;
  is_home?: boolean;
  location?: {
    address?: string;
    category?: string;
  } | null;
}

export type PlaceVisualTone =
  | "home"
  | "taekwondo"
  | "piano"
  | "swim"
  | "soccer"
  | "art"
  | "music"
  | "school"
  | "study"
  | "sports"
  | "family"
  | "friend"
  | "hobby"
  | "church"
  | "apartment"
  | "park"
  | "mart"
  | "hospital"
  | "library"
  | "frequent";

export interface PlaceVisual {
  assetPath: string;
  label: string;
  tone: PlaceVisualTone;
}

const KEYWORD_VISUALS: ReadonlyArray<{
  tone: PlaceVisualTone;
  label: string;
  assetPath: string;
  keywords: readonly string[];
}> = [
  {
    tone: "taekwondo",
    label: "태권도",
    assetPath: "cat/taekwondo.webp",
    keywords: ["태권도", "도복", "합기도", "검도", "유도"],
  },
  {
    tone: "piano",
    label: "피아노",
    assetPath: "cat/piano.webp",
    keywords: ["피아노", "건반"],
  },
  {
    tone: "swim",
    label: "수영",
    assetPath: "cat/swim.webp",
    keywords: ["수영", "수영장", "생존수영"],
  },
  {
    tone: "soccer",
    label: "축구",
    assetPath: "cat/soccer.webp",
    keywords: ["축구", "풋살"],
  },
  {
    tone: "art",
    label: "미술",
    assetPath: "cat/art.webp",
    keywords: ["미술", "그림", "화실", "아트", "드로잉"],
  },
  {
    tone: "music",
    label: "음악",
    assetPath: "cat/music.webp",
    keywords: ["음악", "바이올린", "첼로", "드럼", "기타", "플루트"],
  },
  {
    tone: "school",
    label: "학교",
    assetPath: "cat/school.webp",
    keywords: ["학교", "초등", "중학교", "고등", "유치원", "어린이집"],
  },
  {
    tone: "study",
    label: "공부",
    assetPath: "cat/study.webp",
    keywords: ["학원", "교습소", "영어", "수학", "국어", "논술", "과학", "코딩", "독서실"],
  },
  {
    tone: "sports",
    label: "운동",
    assetPath: "cat/sports.webp",
    keywords: ["체육", "체육관", "운동", "농구", "야구", "발레", "댄스", "줄넘기"],
  },
  {
    tone: "friend",
    label: "놀이",
    assetPath: "cat/friend.webp",
    keywords: ["놀이터", "친구", "놀이", "키즈카페"],
  },
  {
    tone: "family",
    label: "가족",
    assetPath: "cat/family.webp",
    keywords: ["할머니", "할아버지", "외가", "친가", "가족"],
  },
  {
    tone: "hobby",
    label: "취미",
    assetPath: "cat/hobby.webp",
    keywords: ["취미", "방과후", "센터", "문화"],
  },
  // 생활 장소(2026-07-10 신규 클레이 에셋 — scripts/generate-place-assets.mjs 로 생성).
  {
    tone: "church",
    label: "성당·교회",
    assetPath: "place/church.webp",
    keywords: ["성당", "교회", "예배", "절", "사찰", "법당"],
  },
  {
    tone: "apartment",
    label: "아파트",
    assetPath: "place/apartment.webp",
    keywords: ["아파트", "빌라", "오피스텔", "주공", "단지"],
  },
  {
    tone: "park",
    label: "공원",
    assetPath: "place/park.webp",
    keywords: ["공원", "산책", "수목원", "캠핑", "숲"],
  },
  {
    tone: "mart",
    label: "마트",
    assetPath: "place/mart.webp",
    keywords: ["마트", "이마트", "홈플러스", "롯데마트", "코스트코", "시장", "슈퍼", "편의점", "장보기"],
  },
  {
    tone: "hospital",
    label: "병원",
    assetPath: "place/hospital.webp",
    keywords: ["병원", "의원", "소아과", "치과", "한의원", "약국"],
  },
  {
    tone: "library",
    label: "도서관",
    assetPath: "place/library.webp",
    keywords: ["도서관", "책방", "서점"],
  },
];

// 일정 카테고리 → 폴백 에셋(제목 키워드 미매칭 시). EventForm 칩·일정 카드가 공유한다.
export const EVENT_CATEGORY_ASSETS: Readonly<Record<string, string>> = {
  school: "cat/school.webp",
  sports: "cat/sports.webp",
  hobby: "cat/hobby.webp",
  family: "cat/family.webp",
  friend: "cat/friend.webp",
  other: "cat/other.webp",
};

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function resolvePlaceVisual(place: PlaceVisualInput): PlaceVisual {
  const haystack = normalize(
    [place.name, place.location?.address, place.location?.category].filter(Boolean).join(" "),
  );
  // is_home 플래그가 없어도 이름이 '집'이면 집 아이콘을 쓴다(사용자가 그렇게 저장한다).
  const namedHome = ["집", "우리집", "home", "하우스"].some((k) => normalize(place.name ?? "") === normalize(k));
  if (place.is_home || namedHome) {
    return { assetPath: "ui/place-home.webp", label: "집", tone: "home" };
  }

  const match = KEYWORD_VISUALS.find((visual) =>
    visual.keywords.some((keyword) => haystack.includes(normalize(keyword))),
  );
  if (match) {
    return { assetPath: match.assetPath, label: match.label, tone: match.tone };
  }

  // 미매칭 장소는 '장소관리 메뉴' 아이콘(지도+톱니 = 설정처럼 읽힘)이 아니라 중립 핀을 쓴다.
  return { assetPath: "ui/pin.webp", label: "자주 가는 곳", tone: "frequent" };
}

/**
 * 일정 아이콘 — 장소관리와 같은 키워드 테이블(단일 출처)로 해석한다.
 * "태권도 시범단" 일정과 "태권도 학원" 장소가 같은 도복 캐릭터를 쓰게 하는 규칙.
 * 제목 키워드 미매칭 시 카테고리 폴백 → 그래도 없으면 cat/other.
 */
export function resolveEventVisualAsset(title: string | null | undefined, category?: string | null): string {
  const visual = resolvePlaceVisual({ name: String(title ?? "") });
  if (visual.tone !== "frequent") return visual.assetPath;
  return EVENT_CATEGORY_ASSETS[String(category ?? "")] ?? "cat/other.webp";
}
