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
];

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function resolvePlaceVisual(place: PlaceVisualInput): PlaceVisual {
  if (place.is_home) {
    return { assetPath: "ui/place-home.webp", label: "집", tone: "home" };
  }

  const haystack = normalize(
    [place.name, place.location?.address, place.location?.category].filter(Boolean).join(" "),
  );
  const match = KEYWORD_VISUALS.find((visual) =>
    visual.keywords.some((keyword) => haystack.includes(normalize(keyword))),
  );
  if (match) {
    return { assetPath: match.assetPath, label: match.label, tone: match.tone };
  }

  return { assetPath: "ui/place-frequent.webp", label: "자주 가는 곳", tone: "frequent" };
}
