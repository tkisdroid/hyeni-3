import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const readSource = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

function collectCssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(absolutePath);
    if (!entry.isFile() || !entry.name.endsWith(".css")) return [];
    return [relative(repoRoot, absolutePath).split(sep).join("/")];
  });
}

const srcCssFiles = collectCssFiles(join(repoRoot, "src")).sort();

const tokens = readSource("src/styles/tokens.css");
const components = readSource("src/styles/components.css");
const messageSafetyDialogCss = readSource("src/components/MessageSafetyDialog.css");
const onboardingCss = readSource("src/screens/onboarding/Onboarding.css");
const onboarding = readSource("src/screens/onboarding/Onboarding.tsx");
const eventFormCss = readSource("src/screens/parent/EventForm.css");
const eventForm = readSource("src/screens/parent/EventForm.tsx");
const aiScheduleCss = readSource("src/screens/feature/AiSchedule.css");
const aiSchedule = readSource("src/screens/feature/AiSchedule.tsx");
const aiFriendSetupCss = readSource("src/screens/child/AiFriendSetup.css");
const parentAccountCss = readSource("src/screens/parent/ParentAccount.css");
const remoteAudioCss = readSource("src/screens/feature/RemoteAudio.css");
const remoteAudio = readSource("src/screens/feature/RemoteAudio.tsx");
const remoteRingCss = readSource("src/screens/feature/RemoteRing.css");
const remoteRing = readSource("src/screens/feature/RemoteRing.tsx");
const componentSpec = readSource("design-system/spec/COMPONENTS.md");
const readme = readSource("design-system/README.md");

function cssBlocks(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2],
  }));
}

function hexToRgb(hex) {
  const normalized = hex.slice(1);
  const expanded = normalized.length === 3
    ? normalized.split("").map((digit) => `${digit}${digit}`).join("")
    : normalized.slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
}

function relativeLuminance(hex) {
  const channels = hexToRgb(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenHex(tokenName) {
  return tokens.match(new RegExp(`${tokenName}:\\s*(#[0-9a-f]{3,8})`, "i"))?.[1] ?? null;
}

// 실제 colored surface 위 장식·상태 텍스트만 selector 단위로 허용합니다.
// 각 예외는 아래 repo-wide 후보 감사에서 실제 배경 대비와 의미를 확인한 근거를 함께 둡니다.
const smallTextContrastExceptions = new Map([
  [
    "src/components/QrScanner.css::.qrs-error",
    "#0f172a 계열의 QR 스캐너 전체 화면 위 오류 문구로 실제 대비가 8:1 이상입니다.",
  ],
  [
    "src/screens/feature/RemoteAudio.css::.ra-live",
    "어두운 원격청취 패널의 LIVE 상태 배지로 실제 전경·배경 대비가 충분합니다.",
  ],
]);

test("src CSS의 placeholder color override는 정본 토큰을 사용한다", () => {
  for (const relativePath of srcCssFiles) {
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

test("14px 이하 중간톤 텍스트 후보는 기본 밝은 표면에서 AA 대비를 갖거나 근거가 있다", () => {
  const violations = [];
  const defaultSurfaces = ["#ffffff", "#fbf7f4"];

  for (const relativePath of srcCssFiles) {
    for (const { selector, declarations } of cssBlocks(readSource(relativePath))) {
      if (selector.includes("::placeholder")) continue;
      const size = Number.parseFloat(declarations.match(/(?:^|;)\s*font-size:\s*([0-9.]+)px/im)?.[1] ?? "NaN");
      if (!Number.isFinite(size) || size > 14) continue;

      const colorValue = declarations.match(/(?:^|;)\s*color:\s*(#[0-9a-f]{3,8}|var\(--fg-(?:faint|disabled)\))/im)?.[1];
      if (!colorValue) continue;
      const resolvedColor = colorValue.startsWith("#")
        ? colorValue
        : tokenHex(colorValue.slice(4, -1));
      if (!resolvedColor || /^#(?:fff|ffffff)$/i.test(resolvedColor)) continue;

      const ratio = Math.min(...defaultSurfaces.map((surface) => contrastRatio(resolvedColor, surface)));
      if (ratio >= 4.5) continue;
      const key = `${relativePath}::${selector}`;
      if (smallTextContrastExceptions.has(key)) continue;
      violations.push(`${key} (${size}px, ${colorValue}, ${ratio.toFixed(2)}:1)`);
    }
  }

  assert.deepEqual(violations, [], `검토가 필요한 selector ${violations.length}개:\n${violations.join("\n")}`);
});

test("리뷰에서 확인된 작은 보조 문구는 배경에 맞는 접근 가능한 의미 토큰을 사용한다", () => {
  assert.match(aiFriendSetupCss, /\.afs-preview__tone\s*\{[^}]*color:\s*var\(--lav-text\)/s);
  assert.match(aiFriendSetupCss, /\.afs-trait-hint\s*\{[^}]*color:\s*var\(--lav-text\)/s);
  assert.match(parentAccountCss, /\.pa-uid\s*\{[^}]*color:\s*var\(--fg-muted\)/s);
  assert.match(onboardingCss, /\.ob-teacher-sub\s*\{[^}]*color:\s*var\(--mint-text\)/s);
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
  assert.match(aiScheduleCss, /\.ais-confirm:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(aiScheduleCss, /\.ais-confirm\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
  assert.match(remoteAudioCss, /\.ra-start:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(remoteAudioCss, /\.ra-start\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
  assert.match(remoteRingCss, /\.rr-cta:disabled\s*\{[^}]*opacity:\s*var\(--disabled-opacity\)[^}]*cursor:\s*not-allowed/s);
  assert.match(remoteRingCss, /\.rr-cta\[aria-busy="true"\]:disabled\s*\{[^}]*opacity:\s*var\(--busy-opacity\)[^}]*cursor:\s*progress/s);
});

test("busy 상태는 실제 버튼의 aria-busy와 중복 실행 차단 조건에 연결된다", () => {
  assert.match(onboarding, /aria-disabled=\{disabled\}[\s\S]{0,120}disabled=\{disabled\}/);
  assert.match(eventForm, /className="ef-save hy-press"[\s\S]{0,160}disabled=\{busy \|\| !eventFormDataReady\}[\s\S]{0,80}aria-busy=\{busy\}/);
  assert.match(eventForm, /eventFormQueryState === "loading"/);
  assert.match(eventForm, /eventFormQueryState === "error" \|\| eventFormDataMissing/);
  assert.match(eventForm, /onRetry=\{\(\) => void retryEventForm\(\)\}/);
  assert.match(aiSchedule, /className=\{listening[\s\S]{0,220}disabled=\{parseM\.isPending\}[\s\S]{0,100}aria-busy=\{parseM\.isPending\}/);
  assert.match(aiSchedule, /className="ais-confirm hy-press"[\s\S]{0,150}disabled=\{createM\.isPending\}[\s\S]{0,80}aria-busy=\{createM\.isPending\}/);
  assert.match(aiSchedule, /className="ais-confirm hy-press"[\s\S]{0,170}disabled=\{!canParse \|\| parseM\.isPending\}[\s\S]{0,80}aria-busy=\{parseM\.isPending\}/);
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
