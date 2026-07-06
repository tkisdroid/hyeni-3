export const meta = {
  name: "wire-hyeni-nav",
  description: "허브 화면의 플레이스홀더 토스트를 실제 화면 이동(navigate)으로 배선",
  phases: [{ title: "Wire", detail: "화면당 에이전트 1개 — 네비게이션 핸들러 배선" }],
};

const ROOT = "C:/Users/TK/Desktop/hyeni-3";

const ROUTE_MAP = [
  "전체 라우트 (react-router-dom useNavigate 로 이동):",
  "  부모 탭: /parent/home  /parent/calendar  /parent/location  /parent/memo  /parent/settings",
  "  아이 탭: /child/home  /child/sticker  /child/memo",
  "  선생님:  /teacher/home  /teacher/students",
  "  푸시:    /onboarding  /subscription  /notifications  /remote-audio  /place-manager  /friend-play",
  "          /ai-schedule  /ai-credit  /feedback  /phone-setup  /playdate-accept  /sticker-send",
  "          /profile-edit  /place-form  /child-invite  /route  /parent/family  /child/sos  /child/ai-friend",
].join("\n");

const CONTRACT = [
  '너는 "혜니캘린더" 앱의 기존 화면 파일 하나에서 "네비게이션 배선"만 담당하는 엔지니어다.',
  "지금 대부분의 화면 이동 버튼이 임시로 useToast().show('… 곧 제공돼요') 또는 no-op 으로 되어 있다. 이제 대상 화면들이 모두 존재하므로, 이동성 액션을 실제 navigate('/경로') 로 교체하라.",
  "",
  ROUTE_MAP,
  "",
  "■ 작업 규칙:",
  "  1) 배정된 파일을 Read 로 정독한다.",
  "  2) '다른 화면으로 이동'이 자연스러운 액션(바로가기, 리스트 행, CTA, 아이콘 버튼 등)의 핸들러를 useNavigate() 의 navigate('/경로') 로 교체한다.",
  "  3) react-router-dom 의 useNavigate 를 import 하고 컴포넌트 상단에서 const navigate = useNavigate(); 로 준비(이미 있으면 재사용).",
  "  4) 아래 '이 화면 배선 지침'의 매핑을 우선 따른다. 지침에 없지만 명백히 특정 화면으로 가는 액션도 라우트 맵에서 골라 배선한다.",
  "  5) 이동이 아닌 액션은 그대로 둔다: 전화걸기·결제·로그아웃·삭제·토글·폼 제출·좋아요·하트(꾹) 등은 기존 토스트/로컬 동작 유지(백엔드/네이티브 이후 단계).",
  "  6) UI 마크업·스타일·레이아웃·목업 데이터·기타 로직은 절대 바꾸지 마라. 오직 핸들러의 동작만 교체.",
  "",
  "■ strict TS 준수(위반 시 빌드 실패):",
  "  - 핸들러 교체로 useToast 가 더는 안 쓰이면 그 import/구조분해를 제거(미사용 금지). 여전히 쓰이면 유지.",
  "  - 미사용 변수/파라미터/import 금지. import type 규칙 유지. 모든 button type=\"button\" 유지.",
  "  - 배정된 그 파일만 수정. 다른 파일 생성/수정 금지.",
  "",
  "완료 후 Edit/Write 로 저장하고 스키마대로 결과 반환(오케스트레이터가 읽는 데이터).",
].join("\n");

const HUBS = [
  {
    id: "ParentHome",
    file: ROOT + "/src/screens/parent/ParentHome.tsx",
    hint: [
      "바로가기 그리드 라벨→라우트: 'AI 일정'→/ai-schedule, '위치추적'→/parent/location, '친구놀이'→/friend-play, '장소관리'→/place-manager, '주변소리'→/remote-audio, '스티커'→/sticker-send, '구독'→/subscription, '알림'→/notifications.",
      "'AI로 일정 추가'의 음성/텍스트/알림장 버튼 3개 → /ai-schedule.",
      "상단 알림(bell) 버튼 → /notifications.",
      "하트(꾹) 버튼은 토스트 유지. (memo/calendar/location/settings 는 이미 navigate 되어 있으면 그대로.)",
    ].join("\n"),
  },
  {
    id: "ChildHome",
    file: ROOT + "/src/screens/child/ChildHome.tsx",
    hint: [
      "'혜니랑 이야기하기' / AI친구 히어로 → /child/ai-friend.",
      "'바로 할 수 있어' 액션: 대화 → /child/memo, 친구놀기 → /friend-play, 스티커 → /child/sticker.",
      "다음 일정의 길찾기/길안내 → /route. 크라운(크레딧) 배지 → /ai-credit.",
      "꾹 SOS → /child/sos. 부모님 전화는 토스트 유지(네이티브 전화).",
    ].join("\n"),
  },
  {
    id: "ParentSettings",
    file: ROOT + "/src/screens/parent/ParentSettings.tsx",
    hint: [
      "프로필/내 정보 행 → /profile-edit. 구독/프리미엄 → /subscription. 가족 → /parent/family.",
      "장소 관리 → /place-manager. 피드백/문의 → /feedback. 아이 초대/기기연결 → /child-invite. 알림 센터 → /notifications.",
      "알림 on/off 토글은 토글 유지. 로그아웃/탈퇴는 토스트 유지.",
    ].join("\n"),
  },
  {
    id: "ParentFamily",
    file: ROOT + "/src/screens/parent/ParentFamily.tsx",
    hint: "아이 추가 / 초대 → /child-invite. 아이 카드/프로필 편집 → /profile-edit. 보호자 초대 → /child-invite.",
  },
  {
    id: "ParentLocation",
    file: ROOT + "/src/screens/parent/ParentLocation.tsx",
    hint: "'메모 남기기' → /parent/memo. '주변듣기/듣기' → /remote-audio. 길안내 있으면 → /route. 통화는 토스트 유지.",
  },
  {
    id: "TeacherHome",
    file: ROOT + "/src/screens/teacher/TeacherHome.tsx",
    hint: "학생/반 학생 보기 → /teacher/students. 알림장 작성·발송 등은 토스트 유지.",
  },
  {
    id: "Onboarding",
    file: ROOT + "/src/screens/onboarding/Onboarding.tsx",
    hint: [
      "온보딩 마지막 완료/시작 버튼은 역할에 따라 이동: 학부모 완료 → /parent/home, 아이 완료 → /child/home, 선생님 완료 → /teacher/home.",
      "권한 스텝의 '시작하기'/'완료'가 최종 진입. 내부 step 전환은 그대로 두고, 최종 진입만 navigate 로.",
    ].join("\n"),
  },
  {
    id: "PlaceManager",
    file: ROOT + "/src/screens/feature/PlaceManager.tsx",
    hint: "장소 추가(+) 및 장소 편집 행 → /place-form.",
  },
  {
    id: "Notifications",
    file: ROOT + "/src/screens/feature/Notifications.tsx",
    hint: "알림 항목 탭 시 타입별 이동: 도착/위험/SOS/이동 → /parent/location, 메시지/대화 → /parent/memo, 스티커 → /parent/memo. 애매하면 토스트 유지. '모두 읽음' 토글은 유지.",
  },
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    comp: { type: "string" },
    wired: { type: "array", items: { type: "string" }, description: "배선한 링크 목록 예: '바로가기 AI일정 → /ai-schedule'" },
    keptToast: { type: "array", items: { type: "string" }, description: "의도적으로 토스트/로컬 유지한 액션" },
    notes: { type: "string" },
  },
  required: ["comp", "wired", "notes"],
};

function promptFor(h) {
  return [
    CONTRACT,
    "",
    "■ 이 화면 배선 지침 (" + h.id + ")",
    "- 파일: " + h.file,
    h.hint,
    "",
    "그 파일을 Read → 이동성 핸들러를 navigate 로 교체 → 저장 → 스키마로 결과 반환.",
  ].join("\n");
}

phase("Wire");
log("허브 화면 " + HUBS.length + "개 네비게이션 배선 시작");

const results = await parallel(
  HUBS.map((h) => () =>
    agent(promptFor(h), { label: h.id, phase: "Wire", schema: SCHEMA }).then(
      (r) => (r ? { id: h.id, ...r } : { id: h.id, failed: true }),
    ),
  ),
);

const ok = results.filter((r) => r && !r.failed);
const failed = results.filter((r) => !r || r.failed).map((r) => (r ? r.id : "unknown"));
log("배선 완료 " + ok.length + "/" + HUBS.length + (failed.length ? " · 실패: " + failed.join(", ") : ""));

return { total: HUBS.length, done: ok.length, failed, screens: ok };
