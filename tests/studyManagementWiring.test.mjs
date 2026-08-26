import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("학습관리는 부모 보호 PushShell route 하나로 연결된다", () => {
  const app = read("src/app/App.tsx");
  assert.match(app, /lazyScreen\(\(\) => import\("@\/screens\/feature\/StudyManagement"\), "StudyManagement"\)/);
  assert.match(app, /path: "study-management"/);
  const pushParent = app.slice(
    app.indexOf("// 부모 전용 푸시/상세"),
    app.indexOf("// 아이 전용 푸시/상세"),
  );
  assert.match(pushParent, /<RequireRole role="parent"/);
  assert.match(pushParent, /routeElement\(<StudyManagement \s*\/>, PARENT_NAMESPACES\)/);
  assert.doesNotMatch(app, /child\/study-management|teacher\/study-management/);
});

test("Study 문구는 Calendar locale catalog가 아니라 한국어 전용 모듈을 쓴다", () => {
  const copy = read("src/components/study/studyCopy.ko.ts");
  const screen = read("src/screens/feature/StudyManagement.tsx");
  assert.match(copy, /학습관리/);
  assert.match(screen, /STUDY_COPY_KO/);
  assert.doesNotMatch(screen, /useIntl|formatMessage/);
});

test("부모 홈 full-width Study 카드는 기존 8개 바로가기 앞에 있고 disabled에서만 숨는다", () => {
  const home = read("src/screens/parent/ParentHome.tsx");
  assert.ok(home.indexOf("ph-study-card") < home.indexOf('className="ph-shortcuts"'));
  assert.match(home, /studyFeatureState !== "disabled"/);
  assert.match(home, /navigate\("\/study-management"\)/);
  assert.match(home, /STUDY_COPY_KO\.card/);

  const css = read("src/screens/parent/ParentHome.css")
    + read("src/screens/parent/ParentHome.redesign.css");
  assert.match(css, /\.ph-study-card[\s\S]*?width:\s*100%/);
  assert.match(css, /\.ph-study-card[\s\S]*?min-height:\s*var\(--control-min-size\)/);
  assert.doesNotMatch(css.match(/\.ph-study-card[\s\S]*?\}/)?.[0] ?? "", /gradient|#[0-9a-f]{3,8}/i);
});

test("학습관리 상세는 exact member report와 서버 권한 기반 기기 관리를 쓴다", () => {
  const sources = [
    "src/screens/feature/StudyManagement.tsx",
    "src/components/study/StudyChildTabs.tsx",
    "src/components/study/StudyReportPanel.tsx",
    "src/components/study/StudyDevicesPanel.tsx",
  ].map(read).join("\n");

  assert.match(sources, /useStudyReport\(\s*selectedStudyMember/);
  assert.match(sources, /useStudyDevices\(selectedStudyMember/);
  assert.match(sources, /canManageLinks/);
  assert.match(sources, /createStudyMutationRequest\(memberId\)/);
  assert.doesNotMatch(sources, /children\s*\[\s*0\s*\]/);
  assert.doesNotMatch(sources, /<input[^>]+(?:grade|학년)|startMission|recommendation|submit/i);
});
