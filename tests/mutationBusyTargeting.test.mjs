import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const ts = tsModule.default ?? tsModule;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

function buttonOpenings(relativePath) {
  const source = read(relativePath);
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const openings = [];
  const visit = (node) => {
    if (ts.isJsxElement(node)) openings.push(node.openingElement.getText(sourceFile));
    if (ts.isJsxSelfClosingElement(node)) openings.push(node.getText(sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return openings.filter((opening) => /^<button\b/.test(opening));
}

function buttonsWith(relativePath, marker) {
  return buttonOpenings(relativePath).filter((opening) => opening.includes(marker));
}

function onlyButtonWith(relativePath, marker) {
  const matches = buttonsWith(relativePath, marker);
  assert.equal(matches.length, 1, `${relativePath}에서 ${marker} 버튼을 하나 찾아야 해요`);
  return matches[0];
}

test("확인 dialog의 취소·닫기 버튼은 잠기기만 하고 진행 spinner를 표시하지 않는다", () => {
  const controls = [
    ["src/screens/parent/ChildDetail.tsx", "cd-confirm__cancel", 1],
    ["src/screens/parent/ParentAccount.tsx", "pa-modal__btn--ghost", 2],
    ["src/screens/parent/ParentSettings.tsx", "ps-modal__btn--ghost", 1],
    ["src/screens/parent/ParentCalendar.tsx", "onClick={() => setConfirmDelete(false)}", 1],
    ["src/screens/feature/FamilyConnection.tsx", "fc-modal__btn--ghost", 1],
    ["src/screens/feature/RemoteRing.tsx", "rr-modal-cancel", 1],
    ["src/screens/teacher/TeacherHome.tsx", "th-sheet__x", 2],
    ["src/screens/teacher/TeacherStudents.tsx", "ts-sheet__x", 1],
    ["src/screens/teacher/TeacherSettings.tsx", "ps-modal__btn--ghost", 1],
  ];

  for (const [file, marker, expectedCount] of controls) {
    const matches = buttonsWith(file, marker);
    assert.equal(matches.length, expectedCount, `${file}의 ${marker} 개수가 달라졌어요`);
    for (const opening of matches) {
      assert.match(opening, /\bdisabled=\{[^}]*\.isPending\}/, `${file} ${marker}는 처리 중 닫히지 않아야 해요`);
      assert.doesNotMatch(opening, /\baria-busy=/, `${file} ${marker}에 처리 spinner가 중복되면 안 돼요`);
    }
  }
});

test("목록 mutation은 실제로 클릭한 행만 aria-busy가 된다", () => {
  const placeDelete = onlyButtonWith("src/screens/feature/PlaceManager.tsx", "pm-item__del");
  const zoneDelete = onlyButtonWith("src/screens/feature/PlaceManager.tsx", "pm-danger__del");
  const swipeDeletes = buttonsWith("src/screens/parent/ParentCalendar.tsx", "pc-swipe__action--delete");
  const pendingSwipeDelete = swipeDeletes.find((opening) => opening.includes("aria-busy=")) ?? "";

  assert.match(placeDelete, /deletePlace\.isPending\s*&&\s*deletePlace\.variables\s*===\s*p\.id/);
  assert.match(zoneDelete, /deleteZone\.isPending\s*&&\s*deleteZone\.variables\s*===\s*z\.id/);
  assert.match(pendingSwipeDelete, /aria-busy=\{swipeDeletePending\}/);
  assert.match(read("src/screens/parent/ParentCalendar.tsx"), /swipeDeletePending\s*=\s*deleteEvent\.isPending\s*&&\s*deleteEvent\.variables\s*===\s*e\.id/);
});

test("AI 설정의 공용 mutation은 클릭한 설정 동작에만 진행 상태를 표시한다", () => {
  const source = read("src/screens/feature/AiCredit.tsx");
  const aiToggle = onlyButtonWith("src/screens/feature/AiCredit.tsx", "billing.aiCredit.settings.aiToggleTitle");
  const decrease = onlyButtonWith("src/screens/feature/AiCredit.tsx", "billing.aiCredit.settings.decrease");
  const increase = onlyButtonWith("src/screens/feature/AiCredit.tsx", "billing.aiCredit.settings.increase");
  const advancedSave = onlyButtonWith("src/screens/feature/AiCredit.tsx", "ac-save-detail");

  assert.match(source, /type SettingsSaveAction = "ai-toggle" \| "limit-decrease" \| "limit-increase" \| "advanced" \| null/);
  assert.match(source, /onSettled:\s*\(\)\s*=>\s*setSettingsSaveAction\(null\)/);
  assert.match(aiToggle, /aria-busy=\{aiToggleSaving\}/);
  assert.match(decrease, /aria-busy=\{limitDecreaseSaving\}/);
  assert.match(increase, /aria-busy=\{limitIncreaseSaving\}/);
  assert.match(advancedSave, /aria-busy=\{advancedSettingsSaving\}/);

  for (const id of [
    "billing.aiCredit.detail.proactiveTitle",
    "billing.aiCredit.detail.scheduleTitle",
    "billing.aiCredit.detail.contactTitle",
  ]) {
    const localToggle = onlyButtonWith("src/screens/feature/AiCredit.tsx", id);
    assert.doesNotMatch(localToggle, /\baria-busy=/, `${id} 로컬 토글에 저장 spinner가 뜨면 안 돼요`);
  }
});

test("교사 알림장과 원격 울림은 실행한 CTA에만 진행 상태를 표시한다", () => {
  const attach = onlyButtonWith("src/screens/teacher/TeacherNotice.tsx", "tn-attach");
  const send = onlyButtonWith("src/screens/teacher/TeacherNotice.tsx", "tn-send");
  const ringMain = onlyButtonWith("src/screens/feature/RemoteRing.tsx", "rr-cta");
  const ringCancel = onlyButtonWith("src/screens/feature/RemoteRing.tsx", "rr-modal-cancel");
  const ringConfirm = onlyButtonWith("src/screens/feature/RemoteRing.tsx", "rr-modal-confirm");

  assert.match(attach, /aria-busy=\{uploading\}/);
  assert.match(send, /aria-busy=\{publish\.isPending\}/);
  assert.match(ringMain, /aria-busy=\{ringing \|\| trigger\.isPending\}/);
  assert.doesNotMatch(ringCancel, /\baria-busy=/);
  assert.match(ringConfirm, /aria-busy=\{trigger\.isPending\}/);
  assert.match(
    read("src/screens/feature/RemoteRing.tsx"),
    /const confirmRing = async \(\) => \{[\s\S]*?try \{[\s\S]*?await trigger\.mutateAsync[\s\S]*?finally \{\s*setShowConfirm\(false\)/,
    "확인 버튼은 요청이 끝날 때까지 모달에 남아 자기 진행 상태를 보여줘야 해요",
  );
});
