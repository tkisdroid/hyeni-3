import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const readabilityFiles = [
  "src/screens/onboarding/Onboarding.css",
  "src/screens/child/AiFriendSetup.css",
  "src/screens/parent/EventForm.css",
  "src/screens/parent/ParentAccount.css",
  "src/screens/shared/MemoChat.css",
  "src/screens/feature/DangerZoneForm.css",
  "src/screens/feature/Feedback.css",
  "src/screens/feature/PlaceForm.css",
  "src/screens/feature/StickerSend.css",
];

const tokens = readSource("src/styles/tokens.css");
const components = readSource("src/styles/components.css");
const messageSafetyDialogCss = readSource("src/components/MessageSafetyDialog.css");
const onboardingCss = readSource("src/screens/onboarding/Onboarding.css");
const onboarding = readSource("src/screens/onboarding/Onboarding.tsx");
const eventFormCss = readSource("src/screens/parent/EventForm.css");
const eventForm = readSource("src/screens/parent/EventForm.tsx");
const aiScheduleCss = readSource("src/screens/feature/AiSchedule.css");
const aiSchedule = readSource("src/screens/feature/AiSchedule.tsx");
const remoteAudioCss = readSource("src/screens/feature/RemoteAudio.css");
const remoteAudio = readSource("src/screens/feature/RemoteAudio.tsx");
const remoteRingCss = readSource("src/screens/feature/RemoteRing.css");
const remoteRing = readSource("src/screens/feature/RemoteRing.tsx");
const componentSpec = readSource("design-system/spec/COMPONENTS.md");
const readme = readSource("design-system/README.md");

function cssBlocks(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2],
  }));
}

test("화면별 placeholder override는 모두 접근 가능한 placeholder 토큰을 사용한다", () => {
  for (const relativePath of readabilityFiles) {
    const source = readSource(relativePath);
    const placeholders = cssBlocks(source).filter(({ selector }) => selector.includes("::placeholder"));

    for (const { selector, declarations } of placeholders) {
      assert.match(
        declarations,
        /color:\s*var\(--fg-placeholder\)/,
        `${relativePath} ${selector}가 전역 placeholder 대비를 덮어씁니다`,
      );
    }
  }
});

test("화면에서 읽는 보조 문구는 faint·disabled·저대비 리터럴을 사용하지 않는다", () => {
  const lowContrastColor = /color:\s*(?:#(?:8b7e84|b7adb2|b3a4c9|a99fa4)|var\(--fg-(?:faint|disabled)\))/i;

  for (const relativePath of readabilityFiles) {
    for (const { selector, declarations } of cssBlocks(readSource(relativePath))) {
      if (selector.includes(":disabled")) continue;
      assert.doesNotMatch(
        declarations,
        lowContrastColor,
        `${relativePath} ${selector}의 읽는 문구가 저대비 색을 사용합니다`,
      );
    }
  }
});

test("dialog의 textarea focus-visible은 전역 focus 토큰보다 약한 색으로 덮지 않는다", () => {
  assert.match(
    messageSafetyDialogCss,
    /\.msd-detail textarea:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--focus-ring-color\)/s,
  );
  assert.doesNotMatch(
    messageSafetyDialogCss,
    /\.msd-detail textarea:focus-visible\s*\{[^}]*outline:[^;]*var\(--lav-line\)/s,
  );
});

test("일반 disabled와 진행 중 busy는 서로 다른 의미 토큰을 사용한다", () => {
  assert.match(tokens, /--busy-opacity:\s*0\.78;/);
  assert.match(onboardingCss, /\.ob-back:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(eventFormCss, /\.ef-save:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(eventFormCss, /\.ef-save\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
  assert.match(aiScheduleCss, /\.ais-mic:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(aiScheduleCss, /\.ais-mic\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
  assert.match(remoteAudioCss, /\.ra-start:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(remoteAudioCss, /\.ra-start\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
  assert.match(remoteRingCss, /\.rr-cta:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(remoteRingCss, /\.rr-cta\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
});

test("busy 상태는 실제 버튼의 aria-busy와 중복 실행 차단 조건에 연결된다", () => {
  assert.match(onboarding, /aria-disabled=\{disabled\}[\s\S]{0,120}disabled=\{disabled\}/);
  assert.match(eventForm, /className="ef-save hy-press"[\s\S]{0,160}disabled=\{busy \|\| !familyReady\}[\s\S]{0,100}aria-busy=\{busy \|\| familyQuery\.isLoading\}/);
  assert.match(aiSchedule, /className=\{listening[\s\S]{0,220}disabled=\{parseM\.isPending\}[\s\S]{0,100}aria-busy=\{parseM\.isPending\}/);
  assert.match(remoteAudio, /className="ra-start hy-press"[\s\S]{0,180}disabled=\{starting \|\| requestListen\.isPending \|\| !childUserId\}[\s\S]{0,120}aria-busy=\{starting \|\| requestListen\.isPending\}/);
  assert.match(remoteRing, /className="rr-cta hy-press"[\s\S]{0,180}disabled=\{!quotaAllowed \|\| !targetChild \|\| ringing \|\| trigger\.isPending\}[\s\S]{0,120}aria-busy=\{ringing \|\| trigger\.isPending\}/);
  assert.match(remoteRing, /ringing \|\| trigger\.isPending \? "울리는 중…" : "지금 울리기"/);
});

test("공통 아이콘 버튼과 문서는 현재 제품의 실제 액션·아이콘 언어를 반영한다", () => {
  assert.match(components, /\.hy-iconbtn\s*\{[^}]*min-width:\s*var\(--control-min-size\)[^}]*min-height:\s*var\(--control-min-size\)[^}]*flex:\s*none/s);
  assert.doesNotMatch(componentSpec, /## 2\.[^\n]*(?:하트|꾹)|Heart "kkuk"/);
  assert.match(componentSpec, /스티커/);
  assert.match(readme, /기능·hero[^\n]*검증된 3D[^\n]*텍스트 행·utility[^\n]*Lucide/);
  assert.doesNotMatch(readme, /플랫 라인 아이콘이 아니라/);
});
