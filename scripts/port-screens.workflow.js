export const meta = {
  name: "port-hyeni-screens",
  description: "혜니캘린더 리디자인 시안의 나머지 화면 27개를 React+TS로 병렬 이식",
  phases: [{ title: "Port", detail: "화면당 에이전트 1개 — 시안 섹션을 읽어 화면 이식" }],
};

const ROOT = "C:/Users/TK/Desktop/hyeni-3";
const DC = ROOT + "/혜니캘린더 리디자인.dc.html";

const CONTRACT = [
  '너는 "혜니캘린더"(가족 일정+부모·자녀 위치/안전) 앱의 화면 하나를 디자인 시안(dc.html)을 기준으로 React 19 + TypeScript로 이식하는 프론트엔드 엔지니어다.',
  "이미 완성된 기반(Vite+React+TS, 디자인시스템, 앱 셸, 기준 화면 ParentHome)이 있다. 너는 배정된 화면 파일만 새로 만든다. 다른 파일은 절대 수정하지 마라.",
  "",
  "■ 반드시 먼저 Read 로 읽어라 (컨벤션의 정답 = 그대로 따라라):",
  "  1) 네 화면의 디자인 원본: 파일 '" + DC + "' 를 Read (offset/limit 은 아래 배정에 명시). 인라인 style 값이 디자인 기준이다.",
  "  2) 기준 화면(패턴 정답): " + ROOT + "/src/screens/parent/ParentHome.tsx , ParentHome.css",
  "  3) 공통 클래스: " + ROOT + "/src/styles/components.css (.hy-* 전부), " + ROOT + "/src/styles/tokens.css (CSS 토큰 변수)",
  "  4) 공통 컴포넌트: " + ROOT + "/src/components/ui/SectionHeader.tsx , TopBar.tsx , " + ROOT + "/src/lib/assets.ts",
  "",
  "■ 시안 DSL → React 번역:",
  "  - <sc-if value=\"{{ x }}\">…</sc-if>  →  {x && (…)}",
  "  - <sc-for list=\"{{ xs }}\" as=\"e\">…</sc-for>  →  xs.map((e) => (…))  (key 부여)",
  "  - {{ 값 }}  →  props / 로컬 목업 데이터 / useState 로 치환",
  "  - onClick=\"{{ handler }}\"  →  실제 핸들러: 뒤로가기 navigate(-1), 화면이동 navigate('/경로'), 그 외 useToast().show('문구','이모지') 또는 로컬 state 토글",
  "  - style=\"…\" (인라인)  →  반복 요소는 화면전용 CSS 클래스로, 1회성은 인라인 style 로 디자인 값 1:1 보존",
  "  - style-active=\"transform: scale(.9)\"  →  버튼 className 에 'hy-press' 추가(:active 스케일 자동). 다른 스케일은 화면 CSS 에서 .클래스 { --press: 0.9 }",
  "  - CSS 변수 --hy-accent / --hy-accent-light / --hy-accent-deep / --hy-accent-soft / --hy-accent-text = 아이 테마 강조색. 그대로 사용.",
  "  - 신호색 고정: 민트=안전/양호, 앰버(gold)=주의, 레드(danger)=SOS/긴급/위험구역, 파랑=정보/토요일. 테마와 무관하게 유지.",
  "",
  "■ 산출물 (배정 파일만 Write 로 생성):",
  "  - {대상 .tsx}: export function {Comp}() { … }  (default export 금지, named export)",
  "  - 같은 폴더에 {Comp}.css: 화면 전용 클래스(고유 접두사). ParentHome.css 스타일(토큰 변수 활용)로 작성하고 .tsx 에서 import './{Comp}.css'",
  "  - 목업 데이터는 .tsx 상단 상수 또는 같은 폴더 {Comp}.data.ts 로 자체 정의. '@/data/mock' 은 import 하지 마라(결합 회피).",
  "  - 이미지: import { asset } from '@/lib/assets'; 시안의 assets/ui/x.webp → asset('ui/x.webp'). 에셋 경로 그대로(public/assets 하위: ui, mascot, cat, status, sticker, family, animal, logo.webp).",
  "  - 에셋이 없거나 불확실하면 lucide-react 아이콘으로 대체(이미 설치됨). 시안의 stroke SVG 는 lucide 로 대체 가능.",
  "",
  "■ 절대 준수 (strict TS — 위반 시 빌드 실패):",
  "  - 타입 전용 import 는 반드시 'import type { … }' (verbatimModuleSyntax)",
  "  - 미사용 변수/파라미터/import 금지 (noUnusedLocals, noUnusedParameters)",
  "  - 인라인 style 객체에 '--커스텀' 프로퍼티 넣지 마라(타입에러). press 는 className 'hy-press' 로만.",
  "  - 모든 <button> 에 type=\"button\"",
  "  - react-router v8 의 useNavigate 사용. '@/…' 경로 별칭 사용 가능(= src/).",
  "  - 새 공통 컴포넌트 파일을 만들지 마라. 화면 내부에서 해결하고 기존 공통(TopBar, SectionHeader, .hy-* 클래스)만 재사용.",
  "",
  "■ 공통 클래스 요약(상세는 components.css): .hy-app .hy-screen | .hy-topbar(.__brand .__logo .__title .__actions) .hy-iconbtn(.__dot) | .hy-content | .hy-section-head .hy-section-icon .hy-section-title .hy-section-action | .hy-card | .hy-chip(.--mint .__pulse) | .hy-press(+ --press) | .hy-toast | .hy-placeholder",
  "■ 상세/푸시 화면은 시안대로 상단 헤더에 뒤로가기 버튼(navigate(-1)) 포함. 스크롤 컬럼은 .hy-content 패턴(하단 여백 포함) 사용. 헤더 sticky.",
  "■ 목표: 시안과 최대한 1:1. 색·간격·라운드·그림자·폰트 두께·애니메이션을 시안 값 그대로. 로직은 목업으로 실제 동작(탭 전환·토글·카운트다운 등)까지 구현.",
].join("\n");

const SCREENS = [
  { id: "ChildHome", title: "아이 홈", offset: 305, limit: 187, dir: "src/screens/child", comp: "ChildHome", route: "/child/home", purpose: "AI친구 히어로(말풍선+대화버튼), 다음 일정+길찾기, 바로 할 수 있어(대화·친구놀기·스티커), 부모님 전화, 오늘 시간표, 준비물·숙제, 꾹 SOS. 말투는 반말." },
  { id: "Onboarding", title: "온보딩", offset: 490, limit: 181, dir: "src/screens/onboarding", comp: "Onboarding", route: "/onboarding", purpose: "역할선택(부모/아이/선생님)→로그인→가입→가족(반)연결→페어링→권한 스텝. 내부 step state 로 단계 전환 구현." },
  { id: "ParentCalendar", title: "부모 캘린더", offset: 669, limit: 80, dir: "src/screens/parent", comp: "ParentCalendar", route: "/parent/calendar", purpose: "월간 달력 그리드, 날짜 셀 이벤트 칩, 선택일 상세. 오늘/선택일 표시." },
  { id: "ParentLocation", title: "부모 위치", offset: 747, limit: 72, dir: "src/screens/parent", comp: "ParentLocation", route: "/parent/location", purpose: "스타일라이즈 지도(SVG/CSS), 안전구역 라벨, 아이 마커(안전 링), 부모 점, 위험구역, 상단 오버레이, 아이 칩, 하단 상세카드(통화·듣기·메모). 실제 지도 SDK 아님 — 시안의 그린 지도 그대로 재현." },
  { id: "MemoChat", title: "대화(부모↔아이)", offset: 817, limit: 49, dir: "src/screens/shared", comp: "MemoChat", route: "/parent/memo", purpose: "말풍선 리스트, 스티커 메시지, 빠른답장 칩, 하단 입력창(composer). 부모·아이 공용." },
  { id: "ParentFamily", title: "가족", offset: 864, limit: 53, dir: "src/screens/parent", comp: "ParentFamily", route: "/parent/family", purpose: "보호자 리스트, 아이 프로필 카드(배터리·위치), 아이 추가 버튼." },
  { id: "ChildSos", title: "꾹 SOS", offset: 915, limit: 54, dir: "src/screens/child", comp: "ChildSos", route: "/child/sos", purpose: "대기(3초 홀드 버튼)→카운트다운 오버레이→전송완료 오버레이. 홀드/카운트다운 로직 구현. 반말." },
  { id: "StickerBook", title: "스티커북", offset: 967, limit: 30, dir: "src/screens/child", comp: "StickerBook", route: "/child/sticker", purpose: "받은 칭찬 스티커 그리드. assets/sticker/*.webp 사용. 반말." },
  { id: "AiFriendChat", title: "혜니 AI 친구", offset: 995, limit: 35, dir: "src/screens/child", comp: "AiFriendChat", route: "/child/ai-friend", purpose: "AI 친구와 대화 화면(말풍선, 입력). 라벤더 톤. 반말." },
  { id: "Subscription", title: "구독", offset: 1028, limit: 53, dir: "src/screens/feature", comp: "Subscription", route: "/subscription", purpose: "구독/페이월: 프리미엄 혜택, 플랜, 결제 CTA. 존댓말." },
  { id: "ParentSettings", title: "설정", offset: 1079, limit: 58, dir: "src/screens/parent", comp: "ParentSettings", route: "/parent/settings", purpose: "설정 항목 리스트(계정·알림·아이·기기·구독·피드백 등). 각 행 navigate 또는 토스트." },
  { id: "Notifications", title: "알림 센터", offset: 1135, limit: 29, dir: "src/screens/feature", comp: "Notifications", route: "/notifications", purpose: "알림 리스트(도착·위험·SOS·스티커·메시지 등) 타입별 아이콘/색." },
  { id: "RemoteAudio", title: "주변소리", offset: 1162, limit: 50, dir: "src/screens/feature", comp: "RemoteAudio", route: "/remote-audio", purpose: "대기 화면 → '듣는 중' 오버레이(웨이브 애니메이션 hy-wave). 토글 로직." },
  { id: "PlaceManager", title: "장소 관리", offset: 1210, limit: 44, dir: "src/screens/feature", comp: "PlaceManager", route: "/place-manager", purpose: "집·학원·자주가는곳·위험구역 리스트. assets/ui/place-*.webp 사용." },
  { id: "FriendPlay", title: "친구 놀이요청", offset: 1252, limit: 36, dir: "src/screens/feature", comp: "FriendPlay", route: "/friend-play", purpose: "근처 친구 선택, '같이 놀자고 보내기'. 아이 발신." },
  { id: "AiSchedule", title: "AI 일정추가", offset: 1286, limit: 68, dir: "src/screens/feature", comp: "AiSchedule", route: "/ai-schedule", purpose: "음성·텍스트·알림장 탭 전환, 입력, AI 인식 결과 카드→추가. 탭 state 구현." },
  { id: "AiCredit", title: "AI 크레딧", offset: 1412, limit: 51, dir: "src/screens/feature", comp: "AiCredit", route: "/ai-credit", purpose: "잔액 히어로, 충전팩(30/100/300회), 자동충전 토글." },
  { id: "Feedback", title: "피드백", offset: 1461, limit: 58, dir: "src/screens/feature", comp: "Feedback", route: "/feedback", purpose: "별점(선택 state), 카테고리, 자유입력, 기능 투표, 전송." },
  { id: "PhoneSetup", title: "전화번호 설정", offset: 1517, limit: 29, dir: "src/screens/feature", comp: "PhoneSetup", route: "/phone-setup", purpose: "전화번호 입력/인증 화면." },
  { id: "PlaydateAccept", title: "놀이요청 수락", offset: 1544, limit: 37, dir: "src/screens/feature", comp: "PlaydateAccept", route: "/playdate-accept", purpose: "부모: 아이 놀이요청 확인·수락/거절." },
  { id: "StickerSend", title: "스티커 보내기", offset: 1579, limit: 28, dir: "src/screens/feature", comp: "StickerSend", route: "/sticker-send", purpose: "부모: 상황별 칭찬 스티커 선택·전송. assets/sticker/*.webp." },
  { id: "TeacherHome", title: "선생님 반 홈", offset: 1605, limit: 41, dir: "src/screens/teacher", comp: "TeacherHome", route: "/teacher/home", purpose: "담당 반 개요, 오늘 알림장, 참석 현황. 강조색 민트." },
  { id: "TeacherStudents", title: "선생님 학생 목록", offset: 1644, limit: 25, dir: "src/screens/teacher", comp: "TeacherStudents", route: "/teacher/students", purpose: "매칭 학생·보호자 리스트. 강조색 민트." },
  { id: "ProfileEdit", title: "프로필 편집", offset: 1667, limit: 35, dir: "src/screens/feature", comp: "ProfileEdit", route: "/profile-edit", purpose: "이름·학년·동물 아바타·사진 편집. assets/animal/*.webp." },
  { id: "PlaceForm", title: "장소 등록/편집", offset: 1700, limit: 39, dir: "src/screens/feature", comp: "PlaceForm", route: "/place-form", purpose: "이름·주소·유형(집/학원/자주/위험)·반경 폼." },
  { id: "ChildInvite", title: "아이 초대/연결", offset: 1737, limit: 29, dir: "src/screens/feature", comp: "ChildInvite", route: "/child-invite", purpose: "아이 기기 연결: 페어링 코드 표시/입력." },
  { id: "RouteView", title: "길안내", offset: 1764, limit: 34, dir: "src/screens/feature", comp: "RouteView", route: "/route", purpose: "길안내 경로선, 내 위치 버튼, 소요시간. 스타일라이즈 지도. 브랜드색 경로." },
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    comp: { type: "string", description: "생성한 컴포넌트 이름(export function 이름)" },
    files: { type: "array", items: { type: "string" }, description: "생성한 파일 절대경로 목록" },
    assetsMissing: { type: "array", items: { type: "string" }, description: "시안이 참조했으나 없어서 lucide 등으로 대체한 에셋 경로" },
    notes: { type: "string", description: "구현 요약/특이사항(한 줄)" },
  },
  required: ["comp", "files", "notes"],
};

function promptFor(s) {
  return [
    CONTRACT,
    "",
    "■ 이번 배정 화면",
    "- 이름: " + s.title,
    "- 용도: " + s.purpose,
    "- 시안 위치: Read 파일 '" + DC + "' 를 offset=" + s.offset + ", limit=" + s.limit + " 로 읽어라.",
    "- 생성 파일: " + ROOT + "/" + s.dir + "/" + s.comp + ".tsx  (그리고 같은 폴더 " + s.comp + ".css)",
    "- 컴포넌트: export function " + s.comp + "()",
    "- 참고 라우트 경로: " + s.route,
    "",
    "완성 후 파일을 Write 로 저장하고 스키마대로 결과를 반환하라. 결과 텍스트는 사람이 아니라 오케스트레이터가 읽는 데이터다.",
  ].join("\n");
}

phase("Port");
log("화면 " + SCREENS.length + "개 병렬 이식 시작");

const results = await parallel(
  SCREENS.map((s) => () =>
    agent(promptFor(s), { label: s.comp, phase: "Port", schema: SCHEMA }).then(
      (r) => (r ? { id: s.id, route: s.route, ...r } : { id: s.id, route: s.route, failed: true }),
    ),
  ),
);

const ok = results.filter((r) => r && !r.failed);
const failed = results.filter((r) => !r || r.failed).map((r) => (r ? r.id : "unknown"));
log("이식 완료 " + ok.length + "/" + SCREENS.length + (failed.length ? " · 실패: " + failed.join(", ") : ""));

return { total: SCREENS.length, done: ok.length, failed, screens: ok };
