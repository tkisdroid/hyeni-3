import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** 주석에 적힌 "하지 않기로 한 것"이 금지 검사에 걸리지 않게, 코드만 남긴다. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ 	]*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const home = read("src/screens/child/ChildHome.tsx");
const dock = read("src/app/ChildDock.tsx");
const shell = read("src/app/AppShell.tsx");
const stickerBook = read("src/screens/child/StickerBook.tsx");
const routeSheet = read("src/screens/child/overlays/RouteSheet.tsx");
const routeView = read("src/screens/feature/RouteView.tsx");
const playdateSheet = read("src/screens/child/overlays/PlaydateSheet.tsx");
const callSheet = read("src/screens/child/overlays/CallSheet.tsx");
const daySheet = read("src/screens/child/overlays/DaySheet.tsx");
const stickerDetail = read("src/screens/child/overlays/StickerDetail.tsx");
const celebrate = read("src/screens/child/overlays/Celebrate.tsx");
const memoChat = read("src/screens/shared/MemoChat.tsx");
const aiChat = read("src/screens/child/AiFriendChat.tsx");

// ── 시안 2a 의 모든 클릭 지점이 실제 동작에 연결돼 있는가 ─────────────────

test("지도 노드는 다음 일정이면 길찾기, 아니면 시간표를 연다", () => {
  assert.match(home, /node\.state === "next" \? openRoute\(\) : setDayOpen\(true\)/);
  assert.match(home, /adventure\.nodes\.map\(\(node\)/);
});

test("길찾기 진입점은 설명 시트를 거치지 않고 전체 지도로 바로 이동한다", () => {
  assert.match(home, /const eventId = adventure\.next\?\.id/);
  assert.match(home, /navigate\(eventId \? `\/route\?event=\$\{encodeURIComponent\(eventId\)\}` : "\/route"\)/);
  assert.ok(!code(home).includes("<RouteSheet"), "길찾기 전에 설명 시트를 한 번 더 열면 안 된다");
});

test("혜니 말풍선·길찾기 버튼·왕관·시간표 칩이 각각의 화면을 연다", () => {
  assert.match(home, /adventure\.next \? openRoute\(\) : setDayOpen\(true\)/); // 말풍선
  assert.match(home, /className="kd-next__cta[^"]*"\s*onClick=\{openRoute\}/s);
  assert.match(home, /aria-label="내 스티커북"[\s\S]{0,140}navigate\("\/child\/sticker"\)/);
  assert.match(home, /aria-label="오늘 시간표"[\s\S]{0,140}setDayOpen\(true\)/);
});

test("바로가기 4카드는 대화·AI친구·친구놀이·전화로 이어진다", () => {
  assert.match(home, /navigate\("\/child\/memo"\)/);
  assert.match(home, /onClick=\{openAiFriend\}/);
  assert.match(home, /setPlaydateOpen\(true\)/);
  assert.match(home, /setCallOpen\(true\)/);
});

test("가방 챙기기 — 체크·편집·추가·삭제가 전부 서버에 쓴다", () => {
  assert.match(home, /const toggleSupply[\s\S]{0,400}upsert\.mutate/);
  assert.match(home, /const commitDraft = async[\s\S]{0,500}upsert\.mutateAsync/);
  assert.match(home, /const addSupply[\s\S]{0,500}upsert\.mutate/);
  assert.match(home, /const deleteSupply = \(item: DailySupply\)[\s\S]{0,500}remove\.mutate\(item/);
  assert.match(home, /onClick=\{\(\) => deleteSupply\(s\)\}/);
  // 완료하면 폭죽. 편집 중에는 띄우지 않는다(정리하다 계속 터지면 방해).
  assert.match(home, /if \(nowDone && !editMode\)[\s\S]{0,120}setCelebrate/);
});

test("준비물은 언제나 본인 member 로 귀속된다(첫아이 폴백 금지)", () => {
  assert.match(home, /child_user_id: myMember\.id/);
  assert.match(home, /all\.filter\(\(s\) => s\.child_user_id === myMember\.id\)/);
  assert.ok(!code(home).includes("children[0]"), "첫아이 폴백 금지");
});

test("내 색깔 6개는 전역 accent 를 바꾸고 기기에 저장된다", () => {
  assert.match(home, /CHILD_ACCENTS\.map\(\(c\)/);
  assert.match(home, /setAccent\(c\.key\)/);
  const accent = read("src/app/accent.tsx");
  assert.match(accent, /writeChildAccent\(window\.localStorage, familyId, userId, next\)/);
  // 어른 화면은 아이가 고른 색을 읽지 않고 ADULT_ACCENT 로 수렴한다(2026-08-19 부모 모드 라벤더).
  assert.match(accent, /role !== "child"[\s\S]{0,180}setAccentState\(ADULT_ACCENT\)/, "부모 세션은 어른 고정색");
  // 어른 분기는 아이 저장값을 읽기 전에 return 한다 — 이게 "부모가 아이 색을 안 읽는다"의 실제 불변식이다.
  assert.match(
    accent,
    /role !== "child"\s*\)\s*\{[\s\S]{0,160}setAccentState\(ADULT_ACCENT\);[\s\S]{0,40}return;/,
    "어른 분기가 readChildAccent 전에 return 해야 한다",
  );
});

test("하단 독은 3탭 + SOS 버튼이고, SOS 는 화면 이동만 한다(오발사 방지)", () => {
  assert.match(dock, /\/child\/home[\s\S]{0,200}\/child\/sticker[\s\S]{0,200}\/child\/memo/);
  assert.match(dock, /navigate\("\/child\/sos"\)/);
  assert.ok(!code(dock).includes("useSendSos"), "독에서 SOS 를 직접 발사하면 안 된다");
  assert.match(shell, /<ChildDock \/>/);
});

test("대화 탭 배지는 실제 안읽은 부모 메시지 수다", () => {
  assert.match(dock, /unreadParentMemoCount\(memoThread\.data, userId\)/);
  assert.match(home, /unreadParentMemoCount\(memoThread\.data, userId\)/);
});

// ── 시안의 목업이 앱으로 새어 들어오지 않았는가 ────────────────────────

test("부모 대화는 실서버 스레드다 — 시안의 1초 자동응답 목업 금지", () => {
  assert.match(memoChat, /useMemoThread/);
  assert.match(memoChat, /useSendMemo/);
  // 시안은 1초 뒤 정해진 문장으로 "부모"가 답하는 척한다. 그런 응답 배열이 있으면 안 된다.
  assert.ok(!/우리 .* 최고|알겠어! 조심히 다녀와|이따 저녁에 봐/.test(code(memoChat)), "가짜 부모 자동응답 금지");
});

test("AI 친구는 실 LLM 이다 — 정해진 응답 순환 금지", () => {
  assert.ok(!code(aiChat).includes("AI_REPLIES"), "시안의 고정 응답 배열 반입 금지");
  assert.match(aiChat, /useSendChildChat/);
  // 남은 횟수는 포함분·구매분·부모 상한을 합친 parent-or-self 공개 상태를 사용한다.
  assert.match(aiChat, /useAiCreditPublicStatus\(userId\)/);
  assert.match(aiChat, /aiCreditStatus\.data\?\.availableRemaining/);
  assert.ok(!code(aiChat).includes("useAiUsageToday"), "부모 한도만으로 잔여 횟수를 재계산하면 안 된다");
  assert.ok(!code(aiChat).includes("useAiCredits"), "아이 세션은 크레딧 잔액 API(부모 전용 403)를 부르지 않는다");
});

test("친구놀이는 실제 후보를 쓰고 거리·이름을 지어내지 않는다", () => {
  assert.match(playdateSheet, /usePlaydateCandidates\(open\)/);
  assert.match(playdateSheet, /useCreatePlaydateInvite/);
  assert.match(playdateSheet, /playdateCandidateNotice/);
  assert.ok(!code(playdateSheet).includes("도윤"), "시안의 하드코딩 친구 금지");
  assert.match(playdateSheet, /근처에 있어/); // 거리 대신 사실만
  assert.ok(!/걸어서 \d+분/.test(code(playdateSheet)), "가짜 거리 금지");
});

test("길찾기는 실제 도보 경로를 쓰고, 없으면 정직하게 강등한다", () => {
  assert.match(routeView, /useWalkingRoute\(\s*origin,\s*destination\?\.point \?\? null,/s);
  assert.match(routeView, /kind: "child_location"/);
  assert.match(routeView, /routeState === "no-dest"/);
  assert.match(routeView, /routeState === "no-origin"/);
  assert.match(routeView, /routeState === "error"/);
  assert.ok(!/횡단보도에서.{0,20}초록불/.test(code(routeView)), "시안의 하드코딩 안내문 금지");
});

test("전화는 인앱 통화중 오버레이를 만들지 않고 실제로 건다", () => {
  assert.match(home, /placePhoneCall\(target\.phone\)/);
  assert.ok(!code(callSheet).includes("전화 거는 중"), "다이얼러가 화면을 덮으므로 인앱 통화 화면은 만들지 않는다");
  assert.match(callSheet, /disabled=\{!t\.phone\}/, "번호 없으면 비활성");
});

test("시간표 시트의 알림장 배너는 실제 부모 메시지일 때만 뜬다", () => {
  assert.match(daySheet, /parentNote && \(/);
  assert.ok(!code(daySheet).includes("줄넘기 검사"), "시안의 가짜 알림장 문구 금지");
});

test("스티커북은 12칸 도감 + NEW 배지이고, 상세는 서버가 아는 사실만 말한다", () => {
  assert.match(stickerBook, /buildStickerBook\(received\.data \?\? \[\], nowMs, seen\)/);
  assert.match(stickerBook, /slot\.isNew && <span className="sb-slot__new">NEW<\/span>/);
  assert.match(stickerBook, /부모님 칭찬을 받으면 열려/); // 잠금 탭 → 토스트
  assert.match(stickerBook, /writeSeenSticker/); // 열어보면 NEW 해제
  assert.match(stickerDetail, /stickerOriginText\(slot\.latestType, intl\)/);
  assert.ok(!code(stickerDetail).includes("엄마가"), "보낸 사람 이름은 서버에 없다 — 지어내지 않는다");
});

test("폭죽은 2.2초 뒤 자동으로 닫힌다", () => {
  assert.match(celebrate, /const AUTO_CLOSE_MS = 2200/);
  assert.match(celebrate, /setTimeout\(onClose, AUTO_CLOSE_MS\)/);
});

// ── 기존 기능이 리디자인에서 사라지지 않았는가 ─────────────────────────

test("원탭 상태 공유 6버튼이 남아 있다", () => {
  assert.match(home, /QUICK_STATUS_ACTIONS\.map/);
  assert.match(home, /buildQuickStatusMemo\(actionId, myMember\.id, memoDateKey\)/);
});

test("아이가 닿아야 하는 화면(내 위치·내 설정)에 진입점이 생겼다", () => {
  assert.match(home, /navigate\("\/child\/location-status"\)/);
  assert.match(home, /navigate\("\/child\/settings"\)/);
});

test("AI 친구 캐릭터·이름 설정 진입점이 유지된다", () => {
  assert.match(home, /navigate\("\/child\/ai-friend-setup"\)/); // 이름 미설정 시
  assert.match(aiChat, /navigate\("\/child\/ai-friend-setup"\)/); // 헤더 설정 버튼
  assert.match(home, /const aiEnabled = aiFriend\.data\?\.ai_enabled !== false/);
  assert.match(home, /if \(!aiEnabled\)[\s\S]{0,160}부모님이 켜 줘야 해/);
});

test("MemoChat 의 사진·위치 공유 컴포저가 살아 있다", () => {
  // 마커 조립은 transform/memoView 가 담당하고, 화면은 그 함수를 부른다.
  const memoView = read("src/transform/memoView.ts");
  assert.match(memoView, /\[\[img:/);
  assert.match(memoView, /\[\[loc:/);
  assert.match(memoChat, /uploadChildPhoto|childPhoto/i, "사진 업로드 경로");
  assert.match(memoChat, /geolocation/, "위치 공유 경로");
});

test("아이 모드는 전부 반말이다", () => {
  const childSources = [home, stickerBook, routeSheet, playdateSheet, callSheet, daySheet, stickerDetail, celebrate];
  for (const src of childSources) {
    assert.ok(!/합니다\.|하세요|해주세요|드립니다/.test(code(src)), "아이 모드에 존댓말이 섞였다");
  }
});

test("준비물이 0개여도 추가할 수 있다(편집 버튼을 잠그면 첫 항목을 못 넣는다)", () => {
  // 실기기에서 잡힌 회귀: disabled={supplies.length === 0 && !editMode} 였다.
  assert.ok(!/kd-prep__edit[\s\S]{0,200}disabled=/.test(home), "편집/추가 버튼은 항상 눌려야 한다");
  assert.match(home, /supplies\.length === 0 \? "추가" : "편집"/);
  assert.match(home, /\{editMode && \(\s*<div className="kd-prep__addrow">/);
});

test("이름 변경은 '완료'를 눌러도 저장된다(입력창 언마운트로 blur 가 안 오는 경우)", () => {
  // 실기기에서 잡힌 회귀: onBlur 만 있으면 편집 종료 시 바뀐 이름이 사라졌다.
  assert.match(home, /const finishEdit = async \(\)[\s\S]{0,200}for \(const item of supplies\) await commitDraft\(item\)/);
  assert.match(home, /editMode \? void finishEdit\(\) : setEditMode\(true\)/);
  assert.match(home, /onBlur=\{\(\) => void commitDraft\(s\)\}/);
});

test("여러 항목 이름을 한꺼번에 저장할 때 서로 덮어쓰지 않는다(순차 await)", () => {
  // daily_supplies 는 항목 단위 API 가 없어 '그 날 행 전체 재작성'이라 병렬 저장은 유실을 만든다.
  assert.match(home, /await upsert\.mutateAsync\(/);
  assert.ok(!/Promise\.all\([\s\S]{0,120}commitDraft/.test(home), "병렬 저장 금지");
});

test("준비물 아이콘은 장소관리·일정등록과 같은 출처를 쓴다(태권도복 → 도복 캐릭터)", () => {
  assert.match(home, /resolveEventVisualAsset\(s\.label, s\.kind === "hw" \? "school" : "other"\)/);
});

// ── 2026-07-16: 아이 앱 참여 개선 — 안 읽은 부모 메시지 전면 배너 ─────────────

test("안 읽은 부모 메시지가 있으면 홈 본문 맨 위에 배너를 세운다", () => {
  // 실제 unread 수(read_by 기반)로만 표시하고, 탭하면 대화로 간다.
  assert.match(home, /unreadCount > 0 && \(/);
  assert.match(home, /className="kd-memo-banner hy-press"[\s\S]{0,120}navigate\("\/child\/memo"\)/);
  assert.match(home, /부모님 메시지 \{unreadCount\}개가 기다리고 있어!/);
  // 미리보기는 실제 최근 부모 메시지(latestParentMemoText) — 가짜 문구 목업 금지.
  assert.match(home, /\{parentNote \?\? "지금 열어봐 💌"\}/);
});

test("메시지 배너 스타일은 토큰 색상만 쓰고 reduced-motion 전역 가드 아래에 있다", () => {
  const css = read("src/screens/child/ChildHome.css");
  const banner = css.slice(css.indexOf(".kd-memo-banner"), css.indexOf(".kd-sticker-banner"));
  assert.ok(banner.length > 0, "kd-memo-banner 블록 존재");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(banner), "hex 직접 사용 금지 — tokens.css 변수만");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
