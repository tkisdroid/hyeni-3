import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("아이 설정 도움말은 공용 ChildSheet의 ks-modal 전역 클래스와 완전히 분리된다", () => {
  const settings = readSource("src/screens/child/ChildSettings.tsx");
  const settingsCss = readSource("src/screens/child/ChildSettings.css");
  const childSheet = readSource("src/screens/child/overlays/ChildSheet.tsx");

  for (const suffix of ["", "__scrim", "__card", "__head", "__title", "__x"]) {
    assert.ok(settings.includes(`ks-help-modal${suffix}`), `ChildSettings에 ks-help-modal${suffix}가 없다`);
    assert.ok(settingsCss.includes(`.ks-help-modal${suffix}`), `ChildSettings.css에 .ks-help-modal${suffix}가 없다`);
  }

  assert.doesNotMatch(settings, /className="ks-modal(?:\s|"|__)/);
  assert.doesNotMatch(settingsCss, /(^|\n)\.ks-modal(?:\s|\{|__)/);
  assert.match(childSheet, /className="ks-modal"/);
});

test("아이 설정의 연결·위치 상태는 의미에 맞는 tone을 쓰고 긴 확인 불가 문구를 줄인다", () => {
  const settings = readSource("src/screens/child/ChildSettings.tsx");
  const css = readSource("src/screens/child/ChildSettings.css");

  assert.match(settings, /tone: "connected" \| "pending"/);
  assert.match(settings, /ks-hero__chip--\$\{conn\.tone\}/);
  assert.ok(settings.includes('sub: "위치 상태를 확인할 수 없어"'));
  assert.ok(!settings.includes('sub: "이 기기에서는 위치 상태를 확인할 수 없어"'));

  for (const tone of ["positive", "caution", "danger", "neutral"]) {
    assert.ok(settings.includes(`tone: "${tone}" as const`), `위치 ${tone} tone이 없다`);
  }
  for (const selector of [
    ".ks-hero__chip--pending",
    ".ks-row--location-caution",
    ".ks-row--location-danger",
    ".ks-row--location-neutral",
    ".ks-onchip--caution",
    ".ks-onchip--danger",
    ".ks-onchip--neutral",
  ]) {
    assert.ok(css.includes(selector), `${selector} 상태 스타일이 없다`);
  }
});

test("아이 가족 대화의 사진 저장·확대 안내와 대상 오류는 반말로 분기된다", () => {
  const memo = readSource("src/screens/shared/MemoChat.tsx");
  const koShared = JSON.parse(readSource("locales/ko/shared.json"));

  const childCopies = {
    "shared.memoChat.copy005": "사진첩에 저장했어.",
    "shared.memoChat.copy007": "사진을 내려받았어.",
    "shared.memoChat.copy009": "저장하려면 기기 설정에서 저장 권한을 허용해 줘.",
    "shared.memoChat.copy011": "이 기기에서는 저장할 수 없어.",
    "shared.memoChat.copy013": "사진을 저장하지 못했어. 잠시 후 다시 해 줘.",
    "shared.memo.photo.error.child": "사진을 불러오지 못했어. 눌러서 다시 시도해 줘.",
    "shared.memoChat.copy053": "사진을 불러오지 못했어.",
    "shared.memoChat.copy015": "내 대화 정보를 확인할 수 없어",
    "shared.memoChat.copy059": "끌어서 옮기고, 두 번 탭하면 원래 크기로 돌아가",
    "shared.memoChat.copy061": "두 손가락으로 벌리거나 두 번 탭하면 확대돼",
  };
  for (const [id, childCopy] of Object.entries(childCopies)) {
    assert.ok(memo.includes(id), `아이 문구 ID가 없다: ${id}`);
    assert.equal(koShared[id], childCopy, `아이 반말 문구가 달라졌다: ${id}`);
  }

  assert.match(memo, /\[intl, isChildSession, previewImageUrl, savingPhoto, show\]/);
  assert.equal(koShared["shared.memoChat.copy006"], "사진첩에 저장했어요.", "부모 존댓말 문구가 보존되지 않았다");
  assert.equal(koShared["shared.memo.photo.error.formal"], "사진을 불러오지 못했어요. 눌러서 다시 시도해 주세요.", "부모 사진 오류 존댓말 문구가 보존되지 않았다");
});

test("아이 주요 CTA는 원시 이모지 대신 같은 크기 체계의 Lucide 아이콘을 쓴다", () => {
  const home = readSource("src/screens/child/ChildHome.tsx");
  const accept = readSource("src/screens/feature/PlaydateAccept.tsx");
  const playdate = readSource("src/screens/child/overlays/PlaydateSheet.tsx");
  const route = readSource("src/screens/child/overlays/RouteSheet.tsx");
  const sos = readSource("src/screens/child/ChildSos.tsx");

  assert.doesNotMatch(home, /길찾기 출발!\s*🚀/u);
  assert.match(home, /<Navigation size=\{20\} strokeWidth=\{2\.2\}[^>]*\/>[\s\S]{0,80}길찾기 출발!/);

  assert.doesNotMatch(accept, /🎈\s*\{accepting/u);
  assert.match(accept, /<PartyPopper size=\{18\} strokeWidth=\{2\.2\}[^>]*\/>[\s\S]{0,80}수락하기/);

  assert.doesNotMatch(playdate, /같이 놀자고 보내기 💌/u);
  assert.match(playdate, /<Send size=\{19\} strokeWidth=\{2\.2\}[^>]*\/>[\s\S]{0,120}같이 놀자고 보내기/);

  for (const rawLabel of ["출발할게! 🏃", "도착했다고 알리기 🏠", "지도로 자세히 보기 🗺️"]) {
    assert.ok(!route.includes(rawLabel), `RouteSheet CTA에 원시 이모지가 남았다: ${rawLabel}`);
  }
  assert.match(route, /<Navigation size=\{20\}[\s\S]{0,100}출발할게!/);
  assert.match(route, /<Home size=\{19\}[\s\S]{0,100}도착했다고 알리기/);
  assert.match(route, /<Map size=\{19\}[\s\S]{0,100}지도로 자세히 보기/);
  assert.doesNotMatch(sos, /🙏/u);
});

test("아이 홈의 AI 친구 진입점은 채팅 화면과 같은 저장 이름을 표시한다", () => {
  const home = readSource("src/screens/child/ChildHome.tsx");

  assert.match(home, /import \{ resolveAiFriendDisplayName \} from "@\/transform\/aiFriendName"/);
  assert.match(home, /const aiFriendDisplayName = aiFriendSavedName[\s\S]{0,180}resolveAiFriendDisplayName/);
  assert.match(home, /aiFriendDisplayName \? `\$\{aiFriendDisplayName\} 만나러 가기` : "AI 친구 만나기"/);
  assert.ok(home.includes('asset("ui/ai-robot.webp")'));
  assert.doesNotMatch(home, /혜니랑 말하기/);
});

test("공유 mutation을 쓰는 형제 버튼은 요청을 시작한 컨트롤에만 busy를 표시한다", () => {
  const home = readSource("src/screens/child/ChildHome.tsx");
  const ai = readSource("src/screens/child/AiFriendChat.tsx");
  const settings = readSource("src/screens/child/ChildSettings.tsx");
  const route = readSource("src/screens/child/overlays/RouteSheet.tsx");
  const supplies = readSource("src/screens/feature/Supplies.tsx");
  const accept = readSource("src/screens/feature/PlaydateAccept.tsx");

  assert.ok(home.includes("pendingQuickStatus === action.id"));
  assert.ok(home.includes('pendingSupplyAdd === "prep"'));
  assert.ok(home.includes('pendingSupplyAdd === "hw"'));
  assert.ok(home.includes("pendingSupplyDeleteId === s.id"));
  assert.ok(!home.includes("aria-busy={sendMemo.isPending}"));
  assert.ok(!home.includes("aria-busy={upsert.isPending}"));
  assert.ok(!home.includes("aria-busy={remove.isPending}"));

  assert.ok(ai.includes('pendingSendSource === `suggestion:${q}`'));
  assert.ok(ai.includes('pendingSendSource === "composer"'));
  assert.ok(!ai.includes("aria-busy={sendChat.isPending}"));

  assert.ok(settings.includes("pendingRequestMenu === item.menu"));
  assert.ok(!settings.includes("aria-busy={request.isPending}"));

  assert.ok(route.includes('pendingAction === "depart"'));
  assert.ok(route.includes('pendingAction === "arrive"'));
  assert.match(route, /if \(!open \|\| !sending\) setPendingAction\(null\)/);
  assert.ok(!route.includes("aria-busy={sending}"));

  assert.ok(supplies.includes('pendingUpsertAction === `edit:${s.id ?? ""}`'));
  assert.ok(supplies.includes('pendingUpsertAction === `add:${sec.kind}`'));
  assert.ok(supplies.includes("pendingDeleteId === s.id"));
  assert.ok(!supplies.includes("aria-busy={upsert.isPending}"));
  assert.ok(!supplies.includes("aria-busy={remove.isPending}"));

  assert.ok(accept.includes("aria-busy={accepting}"));
  assert.ok(accept.includes("aria-busy={declining}"));
  assert.ok(!accept.includes("aria-busy={busy}"));
});

test("길게 저장한 AI 친구 이름도 홈 바로가기 높이를 두 줄 안에서 유지한다", () => {
  const css = readSource("src/screens/child/ChildHome.css");
  const titleRule = css.match(/\.kd-tile__title\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(titleRule, /-webkit-line-clamp:\s*2\s*;/);
  assert.match(titleRule, /line-clamp:\s*2\s*;/);
  assert.match(titleRule, /overflow:\s*hidden\s*;/);
  assert.match(titleRule, /word-break:\s*keep-all\s*;/);
  assert.match(titleRule, /overflow-wrap:\s*anywhere\s*;/);
});
