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
    'const PARENT_STUDY_NAMESPACES = ["core", "onboarding", "parent", "shared"] as const;',
    'const CHILD_STUDY_NAMESPACES = ["core", "onboarding", "child", "shared"] as const;',
    // 결제 화면은 티어 라벨·잠금 안내가 parent.* id 를 쓰므로 parent 를 함께 싣는다(2026-08-17).
    'const BILLING_NAMESPACES = ["core", "billing", "parent", "shared"] as const;',
    'const REPORT_NAMESPACES = ["core", "reports", "parent", "shared"] as const;',
    'const PARENT_NOTIFICATION_NAMESPACES = ["core", "notifications", "parent", "shared"] as const;',
    // 위치 탭은 위치·장소(notifications)와 프리미엄 안내(billing) 문구를 함께 쓴다(2026-08-17).
    'const PARENT_LOCATION_NAMESPACES = ["core", "parent", "notifications", "billing", "shared"] as const;',
    'const CHILD_NOTIFICATION_NAMESPACES = ["core", "notifications", "child", "shared"] as const;',
    'const SHARED_NAMESPACES = ["core", "shared"] as const;',
  ]) {
    assert.equal(app.includes(declaration), true, `${declaration} 누락`);
  }

  const routeMappings = [
    ["onboarding", "ONBOARDING_NAMESPACES"],
    ["parent/home", "PARENT_NAMESPACES"],
    ["parent/location", "PARENT_LOCATION_NAMESPACES"],
    ["place-manager", "PARENT_NOTIFICATION_NAMESPACES"],
    ["location-status", "PARENT_NOTIFICATION_NAMESPACES"],
    ["location-settings", "PARENT_NOTIFICATION_NAMESPACES"],
    ["child/home", "CHILD_NAMESPACES"],
    ["study", "PARENT_STUDY_NAMESPACES"],
    ["study/learn", "CHILD_STUDY_NAMESPACES"],
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

test("화면이 쓰는 모든 message namespace를 그 라우트가 싣는다", () => {
  // 2026-08-17 실제 결함 2건: /subscription 은 플랜 비교 열 제목이 "parent.tier.free" 로,
  // /place-manager 는 제목이 "notifications.placeManager.title" 로 보였다(실기기 콜드 스타트 확인).
  // namespace 는 화면을 지나며 누적되므로 다른 화면을 먼저 들른 세션에서는 가려진다 —
  // 그래서 눈으로는 못 잡고 이렇게 정적으로 고정한다.
  const app = readSource("src/app/App.tsx");

  const groups = new Map();
  for (const [, name, list] of app.matchAll(/const (\w+_NAMESPACES) = \[([^\]]+)\] as const;/g)) {
    groups.set(name, [...list.matchAll(/"([a-z-]+)"/g)].map(([, value]) => value));
  }
  assert.ok(groups.size >= 8, "namespace 묶음 선언을 찾지 못했어요");

  const screenFiles = new Map();
  for (const [, name, path] of app.matchAll(/const (\w+) = lazyScreen\(\(\) => import\("@\/([^"]+)"\)/g)) {
    screenFiles.set(name, `src/${path}.tsx`);
  }

  // 공용 transform·컴포넌트가 만드는 문구도 화면 몫이다(직접 import 로 판정).
  const sharedCopyModules = [
    ["@/transform/tierPolicy", "parent"],
    ["@/transform/premiumUpsell", "parent"],
    ["@/components/PremiumUpsell", "parent"],
    // 로그인 방식 라벨(providerLabel)은 parent.account.provider.* 를 쓴다 —
    // 2026-09-27 선생님 설정이 core·shared 만 싣고 있어 키 원문이 그대로 보였다.
    ["@/queries/useAccount", "parent"],
  ];

  const offenders = [];
  const descriptions = JSON.parse(readSource("locales/descriptions.json"));
  let checked = 0;
  for (const [, screen, group] of app.matchAll(/routeElement\(<(\w+)\s*\/>,\s*(\w+_NAMESPACES)\)/g)) {
    const file = screenFiles.get(screen);
    const namespaces = groups.get(group);
    if (!file || !namespaces) continue;
    let source;
    try {
      source = readSource(file);
    } catch {
      continue;
    }
    checked += 1;
    // 표시 ID의 접두사와 실제 카탈로그가 다를 수 있어 번역 정본의 namespace를 따른다.
    const used = new Set([...source.matchAll(/id: "([a-z][a-zA-Z]*\.[^"]+)"/g)]
      .map(([, id]) => descriptions[id]?.namespace ?? id.split(".")[0]));
    for (const [module, namespace] of sharedCopyModules) {
      if (source.includes(module)) used.add(namespace);
    }
    for (const namespace of used) {
      if (!groups.has(`${namespace.toUpperCase()}_NAMESPACES`) && !namespace.match(/^[a-z]+$/)) continue;
      if (!namespaces.includes(namespace)) offenders.push(`${screen} (${group}) → ${namespace}.*`);
    }
  }

  assert.ok(checked >= 40, `라우트 화면을 충분히 검사하지 못했어요(${checked}개)`);
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    `라우트가 싣지 않는 namespace 문구를 쓰는 화면: ${[...new Set(offenders)].join(", ")}`,
  );
});

test("locale runtime은 인증·쿼리·활성 아이 세션을 변경하지 않는다", () => {
  const provider = readSource("src/i18n/LocaleProvider.tsx");

  assert.doesNotMatch(provider, /clearApiSession|logout|anonymousLogin|setActiveChildId|AuthProvider|QueryProvider/);
  assert.doesNotMatch(provider, /hyeni-api-session-v1|hyeni-active-child/);
});

test("초기 catalog 실패 화면은 raw 오류 없이 사용자 retry를 연결한다", () => {
  const provider = readSource("src/i18n/LocaleProvider.tsx");

  assert.match(provider, /if \(!runtime\.readyNamespaces\.has\("core"\)\)/);
  assert.match(provider, /const bootstrap = localeBootstrapCopy\(runtime\.locale\)/);
  assert.match(provider, /role="alert"[\s\S]*bootstrap\.title[\s\S]*bootstrap\.body[\s\S]*bootstrap\.retry/);
  assert.match(provider, /onClick=\{\(\) => void coordinator\.retry\(\)\.catch/);
  assert.doesNotMatch(provider, /loadError\.message|runtime\.error\.message|JSON\.stringify\(runtime\.error/);
});

test("LocaleBoundary는 route lifetime waiter를 lease ready/release에 연결한다", () => {
  const boundary = readSource("src/i18n/LocaleBoundary.tsx");

  assert.match(boundary, /useLocaleBoundaryLease\(\)/);
  assert.match(boundary, /const lease = acquireNamespaceLease\(namespaces\)/);
  assert.match(boundary, /lease\.ready\.catch/);
  assert.match(boundary, /return \(\) => \{[\s\S]*lease\.release\(\)/);
});
