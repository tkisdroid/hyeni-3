import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

function read(path) {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function catalog(locale, namespace) {
  return JSON.parse(read(`locales/${locale}/${namespace}.json`));
}

const feedback = read("src/screens/feature/Feedback.tsx");
const profile = read("src/screens/feature/ProfileEdit.tsx");

test("피드백 화면은 역할별 어조를 Intl ID로 고르고 사용자가 쓴 본문은 원문으로 보낸다", () => {
  assert.match(feedback, /useIntl\(\)/);
  assert.match(feedback, /shared\.feedback\./);
  assert.match(feedback, /childTone[\s\S]*\.child[\s\S]*\.formal/);
  assert.match(feedback, /const content = text\.trim\(\)/);
  assert.match(feedback, /requestId,\s*\n\s*feedbackKind,\s*\n\s*category,\s*\n\s*content/);
  assert.match(feedback, /value=\{text\}/);
  assert.doesNotMatch(feedback, /formatMessage\([^)]*,\s*\{[^}]*(?:content|body):/s);
});

test("피드백 접수는 requestId 멱등성과 sent·queued의 서로 다른 안내를 유지한다", () => {
  assert.match(feedback, /const \[requestId\] = useState\(createFeedbackRequestId\)/);
  assert.match(feedback, /result\.status === "sent"/);
  assert.match(feedback, /shared\.feedback\.result\.sent\.(?:child|formal)/);
  assert.match(feedback, /shared\.feedback\.result\.queued\.(?:child|formal)/);
  assert.match(feedback, /includeDiagnostics \? await collectFeedbackDiagnostics\(\) : null/);
  assert.match(feedback, /if \(includeDiagnostics\) clearFeedbackDiagnostics\(\)/);
  assert.doesNotMatch(feedback, /setText\(""\)/);
});

test("진단 안내는 허용 범위와 제외할 민감정보를 정확히 설명한다", () => {
  const ko = catalog("ko", "shared");
  assert.equal(
    ko["shared.feedback.diagnostics.summary.formal"],
    "앱 버전·실행 환경·현재 화면과 최근 24시간의 정규화된 오류를 최대 12건까지 보내요.",
  );
  assert.equal(
    ko["shared.feedback.diagnostics.privacy.formal"],
    "대화 내용·위치 좌표·사진·비밀번호·로그인·구매·주문 토큰과 오류 원문은 포함하지 않아요.",
  );
  assert.match(feedback, /shared\.feedback\.diagnostics\.summary\.(?:child|formal)/);
  assert.match(feedback, /shared\.feedback\.diagnostics\.privacy\.(?:child|formal)/);
});

test("프로필 편집은 UI 문구만 번역하고 이름·생일·전화·사진 값은 원문으로 유지한다", () => {
  assert.match(profile, /parent\.profileEdit\./);
  assert.match(profile, /value=\{name\}/);
  assert.match(profile, /value=\{birthday\}/);
  assert.match(profile, /value=\{phone\}/);
  assert.match(profile, /src=\{previewSrc\}/);
  assert.match(profile, /name:\s*name\.trim\(\)/);
  assert.match(profile, /birthdate:\s*birthdateToSave/);
  assert.match(profile, /phone:\s*phoneToSave/);
  assert.doesNotMatch(profile, /formatMessage\([^)]*,\s*\{[^}]*(?:name|birthday|phone|previewSrc)/s);
});

test("피드백·프로필 편집 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const targets = [
    { namespace: "shared", prefix: "shared.feedback.", minimum: 50 },
    { namespace: "parent", prefix: "parent.profileEdit.", minimum: 30 },
  ];

  for (const { namespace, prefix, minimum } of targets) {
    const english = catalog("en", namespace);
    const ids = Object.keys(english).filter((id) => id.startsWith(prefix));
    assert.ok(ids.length >= minimum, `${prefix}: 충분한 UI 문구 ID`);
    for (const locale of locales) {
      const messages = catalog(locale, namespace);
      for (const id of ids) {
        assert.equal(typeof messages[id], "string", `${locale}:${id}`);
        assert.ok(messages[id].trim(), `${locale}:${id}: 빈 번역`);
        if (!["ko", "en"].includes(locale)) {
          assert.notEqual(messages[id], english[id], `${locale}:${id}: 영어 폴백`);
        }
      }
    }
  }

  for (const locale of locales) {
    assert.match(catalog(locale, "shared")["shared.feedback.message.counter"], /\{count\}.*\{max\}|\{max\}.*\{count\}/);
    assert.match(catalog(locale, "parent")["parent.profileEdit.age"], /\{age(?:,\s*number)?\}/);
  }
});
