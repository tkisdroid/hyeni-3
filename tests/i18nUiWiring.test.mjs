import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("LocaleProvider는 App과 그 안의 Query/Auth provider보다 바깥에 있다", () => {
  const main = readSource("src/main.tsx");
  const app = readSource("src/app/App.tsx");

  assert.match(main, /<LocaleProvider>\s*<App\s*\/>\s*<\/LocaleProvider>/s);
  assert.match(app, /<QueryProvider>\s*<AuthProvider>/s);
  assert.doesNotMatch(app, /<AuthProvider>[\s\S]*<LocaleProvider>/);
});

test("routeElement는 화면보다 먼저 locale namespace를 준비한다", () => {
  const app = readSource("src/app/App.tsx");

  assert.match(
    app,
    /function routeElement\(\s*element: ReactElement,\s*namespaces: readonly MessageNamespace\[\] = \["core"\],\s*\)/s,
  );
  assert.match(
    app,
    /<Suspense fallback=\{<RouteLoading\s*\/>\}>\s*<LocaleBoundary namespaces=\{namespaces\}>\{element\}<\/LocaleBoundary>\s*<\/Suspense>/s,
  );
});

test("라우트 역할과 기능별 namespace 묶음이 명시되어 있다", () => {
  const app = readSource("src/app/App.tsx");

  for (const declaration of [
    'const ONBOARDING_NAMESPACES = ["core", "onboarding", "shared"] as const;',
    'const PARENT_NAMESPACES = ["core", "parent", "shared"] as const;',
    'const CHILD_NAMESPACES = ["core", "child", "shared"] as const;',
    'const BILLING_NAMESPACES = ["core", "billing", "shared"] as const;',
    'const REPORT_NAMESPACES = ["core", "reports", "parent", "shared"] as const;',
    'const PARENT_NOTIFICATION_NAMESPACES = ["core", "notifications", "parent", "shared"] as const;',
    'const CHILD_NOTIFICATION_NAMESPACES = ["core", "notifications", "child", "shared"] as const;',
    'const SHARED_NAMESPACES = ["core", "shared"] as const;',
  ]) {
    assert.equal(app.includes(declaration), true, `${declaration} 누락`);
  }

  const routeMappings = [
    ["onboarding", "ONBOARDING_NAMESPACES"],
    ["parent/home", "PARENT_NAMESPACES"],
    ["child/home", "CHILD_NAMESPACES"],
    ["subscription", "BILLING_NAMESPACES"],
    ["ai-credit", "BILLING_NAMESPACES"],
    ["trial-lock", "BILLING_NAMESPACES"],
    ["day-summary", "REPORT_NAMESPACES"],
    ["daily-report", "REPORT_NAMESPACES"],
    ["weekly-report", "REPORT_NAMESPACES"],
    ["notifications", "PARENT_NOTIFICATION_NAMESPACES"],
    ["arrival-alerts", "PARENT_NOTIFICATION_NAMESPACES"],
    ["danger-alert", "PARENT_NOTIFICATION_NAMESPACES"],
    ["remote-audio", "PARENT_NOTIFICATION_NAMESPACES"],
    ["child/sos", "CHILD_NOTIFICATION_NAMESPACES"],
    ["teacher/home", "SHARED_NAMESPACES"],
    ["admin/ai-prompt", "SHARED_NAMESPACES"],
  ];
  for (const [path, namespaces] of routeMappings) {
    assert.match(
      app,
      new RegExp(`path: "${path.replaceAll("/", "\\/")}"[\\s\\S]{0,200}${namespaces}`),
      `${path} namespace mapping 누락`,
    );
  }
});

test("locale runtime은 인증·쿼리·활성 아이 세션을 변경하지 않는다", () => {
  const provider = readSource("src/i18n/LocaleProvider.tsx");

  assert.doesNotMatch(provider, /clearApiSession|logout|anonymousLogin|setActiveChildId|AuthProvider|QueryProvider/);
  assert.doesNotMatch(provider, /hyeni-api-session-v1|hyeni-active-child/);
});
