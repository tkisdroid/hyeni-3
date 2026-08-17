import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { tierAlertActivationLabel } from "../src/transform/tierAlertActivation.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const namespaces = ["billing", "reports", "notifications", "shared"];

const featureSurfaces = [
  "src/screens/feature/AiCredit.tsx", "src/screens/feature/AiSchedule.tsx",
  "src/screens/feature/AppUpdate.tsx", "src/screens/feature/ArrivalAlerts.tsx",
  "src/screens/feature/ChildInvite.tsx", "src/screens/feature/DailySafetyReport.tsx",
  "src/screens/feature/DangerAlert.tsx", "src/screens/feature/DangerZoneForm.tsx",
  "src/screens/feature/DataSync.tsx", "src/screens/feature/DaySummary.tsx",
  "src/screens/feature/FamilyConnection.tsx", "src/screens/feature/Feedback.tsx",
  "src/screens/feature/FriendPlay.tsx", "src/screens/feature/LocationSettings.tsx",
  "src/screens/feature/LocationStatus.tsx", "src/screens/feature/Notifications.tsx",
  "src/screens/feature/NotificationSettings.tsx", "src/screens/feature/PairingWizard.tsx",
  "src/screens/feature/PermDenied.tsx", "src/screens/feature/PhoneSetup.tsx",
  "src/screens/feature/PlaceForm.tsx", "src/screens/feature/PlaceManager.tsx",
  "src/screens/feature/PlaydateAccept.tsx", "src/screens/feature/ProfileEdit.tsx",
  "src/screens/feature/RemoteAudio.tsx", "src/screens/feature/RemoteAudioAudit.tsx",
  "src/screens/feature/RemoteRing.tsx", "src/screens/feature/RouteView.tsx",
  "src/screens/feature/SosReceive.tsx", "src/screens/feature/StickerSend.tsx",
  "src/screens/feature/Subscription.tsx", "src/screens/feature/Supplies.tsx",
  "src/screens/feature/TrialLock.tsx", "src/screens/feature/WeeklyFamilyReport.tsx",
  "src/screens/teacher/TeacherHome.tsx", "src/screens/teacher/TeacherNotice.tsx",
  "src/screens/teacher/TeacherReleaseGate.tsx", "src/screens/teacher/TeacherSettings.tsx",
  "src/screens/teacher/TeacherStudents.tsx", "src/screens/teacher/TeacherTimetable.tsx",
  "src/components/QrScanner.tsx", "src/screens/admin/AdminAiPrompt.tsx",
];

const catalogAwareContainers = new Set(["formatMessage", "FormattedMessage"]);
const userFacingJsxAttributes = new Set([
  "aria-label", "alt", "description", "heading", "label", "placeholder", "retryLabel",
  "screenTitle", "title",
]);
const userFacingPropertyNames = new Set([
  "badge", "description", "detail", "empty", "eyebrow", "greeting", "label", "message", "placeholder",
  "species", "subtitle", "text", "title", "tone",
]);

// locale-neutral/domain token만 파일+문맥+값으로 허용하며 실제 사용과 근거를 함께 검증한다.
const literalAllowlist = [];

function sourceFile(path) {
  const source = readFileSync(resolve(rootDir, path), "utf8");
  return {
    source,
    file: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  };
}

function insideCatalogCall(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const expression = current.expression;
      if (
        (ts.isIdentifier(expression) && catalogAwareContainers.has(expression.text))
        || (ts.isPropertyAccessExpression(expression) && expression.name.text === "formatMessage")
      ) return true;
    }
    if (ts.isStatement(current)) break;
    current = current.parent;
  }
  return false;
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) return current.parent.name.text;
    current = current.parent;
  }
  return null;
}

function displayWrapperParent(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (
    (ts.isParenthesizedExpression(parent) && parent.expression === node)
    || (ts.isJsxExpression(parent) && parent.expression === node)
    || (ts.isAsExpression(parent) && parent.expression === node)
    || (ts.isNonNullExpression(parent) && parent.expression === node)
  ) return parent;
  if (ts.isConditionalExpression(parent) && (parent.whenTrue === node || parent.whenFalse === node)) return parent;
  if (
    ts.isBinaryExpression(parent)
    && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.PlusToken,
    ].includes(parent.operatorToken.kind)
    && (parent.left === node || parent.right === node)
  ) return parent;
  return null;
}

function userFacingContext(node, text) {
  if (insideCatalogCall(node) || !/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^(?:core|parent|child|shared|billing|reports|notifications)\.[A-Za-z0-9_.${}-]+$/.test(text)) return null;
  if (ts.isJsxText(node)) return "jsx-text";
  let current = node;
  let wrapper = displayWrapperParent(current);
  while (wrapper) {
    current = wrapper;
    wrapper = displayWrapperParent(current);
  }
  const parent = current.parent;
  if (
    ts.isBinaryExpression(parent)
    && [
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(parent.operatorToken.kind)
  ) return null;
  if (ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    return userFacingJsxAttributes.has(name) ? `jsx-attribute:${name}` : null;
  }
  if (ts.isJsxExpression(current) && (ts.isJsxElement(parent) || ts.isJsxFragment(parent))) return "jsx-expression";
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText();
    if (callee === "buildKakaoToUrl" && parent.arguments[0] === current) {
      return `external-label:${callee}`;
    }
    if (/^(?:show|toast|setError|alert|confirm)$/.test(callee) && parent.arguments[0] === current) {
      return `call:${callee}:argument:0`;
    }
  }
  if (
    ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && parent.right === current
    && ts.isIdentifier(parent.left)
    && /(?:label|message|placeholder|subtitle|text|title)$/i.test(parent.left.text)
  ) {
    return `assignment:${parent.left.text}`;
  }
  if (ts.isPropertyAssignment(parent)) {
    const name = ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : null;
    if (name === "tone" && /^[a-z][a-z0-9_-]*$/i.test(text)) return null;
    if (name && userFacingPropertyNames.has(name)) return `property:${name}`;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    if (/(?:label|message|placeholder|subtitle|text|title)$/i.test(parent.name.text)) {
      return `variable:${parent.name.text}`;
    }
  }
  const functionName = enclosingFunctionName(node);
  if (functionName && /(?:label|copy|description|message|placeholder|text|title|view)$/i.test(functionName)) {
    current = node;
    while (current.parent && !ts.isReturnStatement(current.parent)) current = current.parent;
    if (current.parent && ts.isReturnStatement(current.parent)) return `return:${functionName}`;
  }
  return null;
}

function literalCandidatesFromSource(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const candidates = [];
  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ").trim();
      const context = userFacingContext(node, text);
      if (context) candidates.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, context, text });
    } else if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const text = ts.isJsxText(node) ? node.text.trim() : node.text;
      const context = userFacingContext(node, text);
      if (context) candidates.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, context, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return candidates;
}

function firstLiteralViolation(path) {
  const { source } = sourceFile(path);
  const violation = literalCandidatesFromSource(path, source).find(({ context, text }) => !literalAllowlist.some((entry) => (
    entry.path === path && entry.context === context && entry.value === text
  )));
  return {
    source,
    violation: violation
      ? `${path}:${violation.line} [${violation.context}]: ${violation.text.replace(/\s+/g, " ")}`
      : null,
  };
}

test("Task 8의 feature 34개·teacher 6개·QR/admin 2개는 파일별 사용자 문구를 카탈로그로 이관한다", () => {
  const failures = [];
  for (const path of featureSurfaces) {
    const { source, violation } = firstLiteralViolation(path);
    if (!/(?:useIntl|FormattedMessage|IntlShape|withDefaultIntl)/.test(source)) {
      failures.push(`${path}: React Intl 문구 배선이 없습니다`);
    }
    if (violation) failures.push(violation);
  }
  assert.deepEqual(failures, []);
});

test("Task 8 literal allowlist는 파일·문맥·값·근거가 있고 실제 사용자 표면에서만 사용된다", () => {
  for (const entry of literalAllowlist) {
    assert.ok(entry.reason.length >= 12, `${entry.path}:${entry.value}: 예외 근거가 필요합니다`);
    const source = sourceFile(entry.path).source;
    const used = literalCandidatesFromSource(entry.path, source).some((candidate) => (
      candidate.context === entry.context && candidate.text === entry.value
    ));
    assert.equal(used, true, `${entry.path} [${entry.context}] ${entry.value}: 미사용 allowlist`);
  }
});

test("Task 8 inventory는 상태 discriminant만 제외하고 실제 JSX 문구 탐지를 유지한다", () => {
  const sample = `
    function SampleView({ state, name }) {
      return (
        <section aria-label="경로 안내">
          {state === "ready" ? ` + "`도착 ${name}`" + ` : "경로 없음"}
          <span>다시 시도해 주세요</span>
        </section>
      );
    }
  `;
  const candidates = literalCandidatesFromSource("SampleView.tsx", sample);
  const values = candidates.map(({ text }) => text.replace(/\s+/g, " "));

  assert.ok(!values.includes("ready"), "내부 상태 비교 토큰은 사용자 문구가 아닙니다");
  assert.ok(values.includes("경로 안내"), "사용자-facing aria-label 탐지를 유지해야 합니다");
  assert.ok(values.includes("도착"), "사용자-facing template 탐지를 유지해야 합니다");
  assert.ok(values.includes("경로 없음"), "사용자-facing 조건 분기 문구 탐지를 유지해야 합니다");
  assert.ok(values.includes("다시 시도해 주세요"), "raw JSX text 탐지를 유지해야 합니다");
});

test("Task 8 inventory는 외부 지도 URL의 사용자 표시 라벨을 탐지한다", () => {
  const sample = `
    function buildKakaoToUrl(label, point) {
      return \`https://map.example/to/\${encodeURIComponent(label)},\${point.lat},\${point.lng}\`;
    }
    buildKakaoToUrl("도착지", { lat: 37.5, lng: 127 });
  `;
  const candidates = literalCandidatesFromSource("RouteViewFixture.tsx", sample);
  const destination = candidates.find(({ text }) => text === "도착지");

  assert.equal(destination?.context, "external-label:buildKakaoToUrl");
});

test("친구놀이·놀이 수락·스티커 전송 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const prefixes = ["shared.friendPlay.", "shared.playdateAccept.", "shared.stickerSend."];
  const english = JSON.parse(readFileSync(resolve(rootDir, "locales/en/shared.json"), "utf8"));
  const requiredIds = Object.keys(english).filter((id) => prefixes.some((prefix) => id.startsWith(prefix)));

  assert.ok(requiredIds.length >= 70, "세 화면의 사용자 문구 ID가 충분히 정의되어야 합니다");
  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/shared.json`), "utf8"));
    for (const id of requiredIds) {
      assert.equal(typeof catalog[id], "string", `${locale}:${id}`);
      assert.ok(catalog[id].trim().length > 0, `${locale}:${id}: 빈 번역`);
      if (!["ko", "en"].includes(locale)) {
        assert.notEqual(catalog[id], english[id], `${locale}:${id}: 영어 폴백`);
      }
    }
  }

  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/shared.json`), "utf8"));
    assert.match(catalog["shared.friendPlay.child.sentCount"], /\{count\}/, `${locale}: 전송 수 변수`);
    assert.match(catalog["shared.playdateAccept.inviteNote"], /\{friend\}/, `${locale}: 친구 이름 변수`);
    assert.match(catalog["shared.stickerSend.sent"], /\{childName\}.*\{stickerLabel\}|\{stickerLabel\}.*\{childName\}/, `${locale}: 원문 이름 변수`);
  }
});

test("아이 초대·페어링·가족 연결 문구는 10개 locale에 완전하고 영어 폴백이 없다", () => {
  const prefixes = ["parent.childInvite.", "parent.pairingWizard.", "parent.familyConnection."];
  const english = JSON.parse(readFileSync(resolve(rootDir, "locales/en/parent.json"), "utf8"));
  const requiredIds = Object.keys(english).filter((id) => prefixes.some((prefix) => id.startsWith(prefix)));

  assert.ok(requiredIds.length >= 80, "세 연결 화면의 사용자 문구 ID가 충분히 정의되어야 합니다");
  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/parent.json`), "utf8"));
    for (const id of requiredIds) {
      assert.equal(typeof catalog[id], "string", `${locale}:${id}`);
      assert.ok(catalog[id].trim().length > 0, `${locale}:${id}: 빈 번역`);
      if (!["ko", "en"].includes(locale)) {
        assert.notEqual(catalog[id], english[id], `${locale}:${id}: 영어 폴백`);
      }
    }
  }

  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/parent.json`), "utf8"));
    assert.match(catalog["parent.childInvite.shareText"], /\{pairCode\}/, `${locale}: 코드 변수`);
    assert.match(catalog["parent.childInvite.shareText"], /\{pairLink\}/, `${locale}: 링크 변수`);
    assert.match(catalog["parent.familyConnection.unpairConfirmTitle"], /\{childName\}/, `${locale}: 아이 이름 변수`);
  }
});

test("장소 알림 상태 라벨은 기존 한국어 폴백과 화면 Intl 경로를 모두 지원한다", () => {
  assert.equal(tierAlertActivationLabel("active"), "플랜 한도 안 · 알림 설정 가능");
  const messages = {
    "notifications.place.alert.active": "ACTIVE",
    "notifications.place.alert.premiumRequired": "PREMIUM",
    "notifications.place.alert.unknown": "UNKNOWN",
  };
  const intl = {
    formatMessage: ({ id }) => messages[id],
  };
  assert.equal(tierAlertActivationLabel("active", intl), "ACTIVE");
  assert.equal(tierAlertActivationLabel("premium_required", intl), "PREMIUM");
  assert.equal(tierAlertActivationLabel("unknown", intl), "UNKNOWN");
});

test("SOS·emergency는 무료 안전 기능이고 Premium 혜택으로 분류하지 않는다", () => {
  for (const locale of locales) {
    const billing = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/billing.json`), "utf8"));
    assert.ok(billing["billing.subscription.safetyFree"], `${locale}: 무료 안전 문구`);
    assert.doesNotMatch(
      billing["billing.subscription.safetyFree"],
      /(?:premium|프리미엄|プレミアム|高级|高級|cao cấp|พรีเมียม)/iu,
      `${locale}: SOS를 Premium으로 번역하면 안 됩니다`,
    );
  }
});

test("위급 주변소리는 숨기지 않고 아이 화면 지속 표시·1분 상한·감사 기록을 알린다", () => {
  const remoteAudio = sourceFile("src/screens/feature/RemoteAudio.tsx").source;
  for (const id of [
    "notifications.remoteAudio.visibleToChild",
    "notifications.remoteAudio.oneMinuteLimit",
    "notifications.remoteAudio.auditRecorded",
    "notifications.remoteAudio.fullScreenSafety",
  ]) assert.match(remoteAudio, new RegExp(id.replaceAll(".", "\\.")), `실제 RemoteAudio 배선: ${id}`);

  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/notifications.json`), "utf8"));
    for (const id of [
      "notifications.remoteAudio.visibleToChild",
      "notifications.remoteAudio.oneMinuteLimit",
      "notifications.remoteAudio.auditRecorded",
      "notifications.remoteAudio.fullScreenSafety",
    ]) {
      assert.equal(typeof catalog[id], "string", `${locale}:${id}`);
      assert.ok(catalog[id].trim().length > 0, `${locale}:${id}: 빈 번역`);
    }
    assert.match(catalog["notifications.remoteAudio.toast"], /\{state,\s*select,/);
    for (const state of ["requestExpired", "captureExpired", "auditUnavailable", "deviceUnavailable", "premiumOnly", "deviceNotFound", "other"]) {
      assert.match(catalog["notifications.remoteAudio.toast"], new RegExp(`${state}\\s*\\{`), `${locale}: ${state} selector`);
    }
    assert.doesNotMatch(
      Object.entries(catalog).filter(([id]) => id.startsWith("notifications.remoteAudio.")).map(([, value]) => value).join(" "),
      /(?:통화|phone call|DND|방해 금지 우회|무음으로 숨)/iu,
      `${locale}: 통화 위장·DND 우회 의미를 넣으면 안 됩니다`,
    );
  }
  const ko = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/notifications.json"), "utf8"));
  assert.match(ko["notifications.remoteAudio.visibleToChild"], /아이가 누르지 않아도 연결.*아이 화면에 계속 표시/);
  assert.match(ko["notifications.remoteAudio.oneMinuteLimit"], /1분 후 자동 종료/);
  assert.match(ko["notifications.remoteAudio.auditRecorded"], /투명성.*청취 기록/);
});

test("가격은 provider formattedPrice·서버 catalog 변수만 삽입하고 고정 금액·가짜 체험을 두지 않는다", () => {
  for (const locale of locales) {
    const billing = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/billing.json`), "utf8"));
    assert.match(billing["billing.subscription.providerPrice"], /\{formattedPrice\}/, `${locale}: provider 가격 변수`);
    assert.match(billing["billing.subscription.serverCatalogPrice"], /\{catalogPrice\}/, `${locale}: PWA 서버 가격 변수`);
    assert.match(billing["billing.subscription.eligibleTrial"], /\{trialDays\}/, `${locale}: eligible 체험 변수`);
    const values = Object.values(billing).join("\n");
    assert.doesNotMatch(values, /(?:₩\s*)?(?:2,900|4,900|27,840|39,000)(?:\s*원)?/u, `${locale}: 고정 금액`);
  }
});

test("billing·reports·notifications·shared는 10개 locale에서 ID parity와 비한국어 브랜드를 지킨다", () => {
  for (const namespace of namespaces) {
    const source = JSON.parse(readFileSync(resolve(rootDir, `locales/ko/${namespace}.json`), "utf8"));
    assert.ok(Object.keys(source).length > 0, `${namespace}: 한국어 카탈로그가 비었습니다`);
    for (const locale of locales) {
      const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/${namespace}.json`), "utf8"));
      assert.deepEqual(Object.keys(catalog).sort(), Object.keys(source).sort(), `${locale}/${namespace}`);
      for (const [id, value] of Object.entries(catalog)) {
        assert.equal(typeof value, "string", `${locale}:${id}`);
        assert.ok(value.trim().length > 0, `${locale}:${id}: 빈 번역`);
        if (locale !== "ko") assert.doesNotMatch(value, /혜니캘린더/, `${locale}:${id}: 비한국어 브랜드`);
      }
    }
  }
});

test("Teacher production gate와 admin prompt 원문 보존 계약을 유지한다", () => {
  const gate = sourceFile("src/screens/teacher/TeacherReleaseGate.tsx").source;
  const app = sourceFile("src/app/App.tsx").source;
  const admin = sourceFile("src/screens/admin/AdminAiPrompt.tsx").source;
  assert.match(app, /TEACHER_MODE_ENABLED/);
  assert.match(gate, /logout|로그아웃/);
  assert.match(gate, /account|delete|탈퇴/i);
  assert.match(gate, /PRIVACY_POLICY_URL/);
  assert.match(gate, /TERMS_OF_SERVICE_URL/);
  assert.doesNotMatch(admin, /formatMessage\([^)]*,\s*\{[^}]*(?:prompt|value|instruction)/s);
});
