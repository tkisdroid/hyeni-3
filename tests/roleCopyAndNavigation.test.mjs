import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

const safeBackScreens = [
  "src/screens/feature/Notifications.tsx",
  "src/screens/feature/DangerAlert.tsx",
  "src/screens/feature/SosReceive.tsx",
  "src/screens/parent/ParentFamily.tsx",
  "src/screens/feature/PlaydateAccept.tsx",
  "src/screens/feature/FriendPlay.tsx",
];

test("푸시·상세 화면은 공통 safe back을 쓰고 무조건 navigate(-1) 하지 않는다", () => {
  for (const file of safeBackScreens) {
    const source = read(file);
    assert.match(source, /useSafeBack/, file);
    assert.match(source, /onClick=\{goBack\}/, file);
    assert.doesNotMatch(source, /navigate\(-1\)/, file);
  }

  const hook = read("src/app/useSafeBack.ts");
  assert.match(hook, /window\.history\.state\?\.idx/);
  assert.match(hook, /homePathForRole\(role\)/);
});

test("뒤로가기가 없던 가족 화면도 부모 홈 fallback이 있는 버튼을 제공한다", () => {
  const source = read("src/screens/parent/ParentFamily.tsx");
  assert.match(source, /useSafeBack\("\/parent\/home"\)/);
  assert.match(source, /aria-label="뒤로"/);
  assert.match(source, /onClick=\{goBack\}/);
});

test("아이 전용 놀이 요청 화면은 아이에게 반말로 안내한다", () => {
  const source = read("src/screens/feature/PlaydateAccept.tsx");
  assert.match(source, /놀이 약속이 연결됐어!/);
  assert.match(source, /요청을 거절했어\./);
  assert.match(source, /받은 놀이 요청이 없어/);
  assert.match(source, /같이 놀고 싶어!/);
  assert.doesNotMatch(source, /할 수 있어요|만료됐어요|처리된 요청이에요|놀이 중이에요|표시돼요/);
});

test("부모가 친구놀이를 종료할 때 toast는 존댓말을 사용한다", () => {
  const source = read("src/screens/feature/FriendPlay.tsx");
  assert.match(source, /isParent \? "친구놀이를 종료했어요" : "친구랑 그만 놀았어\. 재밌었지\?"/);
  assert.match(source, /isParent\s*\? "친구놀이를 종료하지 못했어요\. 다시 시도해 주세요"/);
});
