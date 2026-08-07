import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("운영 결제 제어 API는 GET 상태와 원자 PUT 응답을 엄격히 검증한다", () => {
  const endpoint = source("src/lib/api/endpoints/admin.ts");

  assert.match(endpoint, /export interface AdminCommerceControlValues/);
  assert.match(endpoint, /webSubscriptionNewCheckoutsEnabled:\s*boolean/);
  assert.match(endpoint, /webAiCreditNewCheckoutsEnabled:\s*boolean/);
  assert.match(endpoint, /export interface AdminCommerceControls[\s\S]*configured:\s*boolean/);
  assert.match(endpoint, /parseAdminCommerceControlsResponse/);
  assert.match(endpoint, /parseAdminCommerceControlValuesResponse/);
  assert.match(endpoint, /typeof record\.webSubscriptionNewCheckoutsEnabled !== "boolean"/);
  assert.match(endpoint, /typeof record\.webAiCreditNewCheckoutsEnabled !== "boolean"/);
  assert.match(endpoint, /typeof record\.configured !== "boolean"/);
  assert.match(endpoint, /invalid_admin_commerce_controls_response/);
  assert.match(endpoint, /apiGet<unknown>[\s\S]*parseAdminCommerceControlsResponse/);
  assert.match(endpoint, /apiPut<unknown>[\s\S]*parseAdminCommerceControlValuesResponse/);
});

test("운영 결제 제어 query는 전용 키를 쓰고 두 값을 한 mutation으로 저장한다", () => {
  const endpoint = source("src/lib/api/endpoints/admin.ts");
  const query = source("src/queries/useAdmin.ts");
  const keys = source("src/queries/keys.ts");

  assert.match(endpoint, /fetchAdminCommerceControls/);
  assert.match(endpoint, /saveAdminCommerceControls/);
  assert.match(endpoint, /\/api\/admin\/commerce-controls/);
  assert.match(query, /qk\.adminCommerceControls/);
  assert.match(
    query,
    /mutationFn:\s*\(controls:\s*AdminCommerceControlValues\)\s*=>\s*saveAdminCommerceControls\(controls\)/,
  );
  assert.match(query, /configured:\s*true/);
  assert.match(keys, /adminCommerceControls:\s*\["admin",\s*"commerceControls"\]/);
});

test("운영 화면은 두 결제 채널을 명시 선택한 뒤 한 번에 저장하고 fail-closed 상태를 구분한다", () => {
  const screen = source("src/screens/admin/AdminAiPrompt.tsx");

  assert.match(screen, /신규 결제 운영 제어/);
  assert.match(screen, /웹 구독 신규 결제/);
  assert.match(screen, /웹 AI 크레딧 신규 결제/);
  assert.match(screen, /운영 기본은 중지/);
  assert.match(screen, /설정이 아직 만들어지지 않아 신규 결제가 안전하게 중지되어 있습니다/);
  assert.match(screen, /운영 제어 저장소 오류\(503\)/);
  assert.match(screen, /기존 주문의 완료·대사·해지·환불은 계속 처리됩니다/);
  assert.match(screen, /두 설정을 한 번에 저장/);
  assert.match(screen, /saveCommerceControls\.mutateAsync\(\{/);
  assert.match(screen, /webSubscriptionNewCheckoutsEnabled:\s*subscriptionEnabled/);
  assert.match(screen, /webAiCreditNewCheckoutsEnabled:\s*aiCreditEnabled/);
  assert.match(screen, /aria-busy=\{saveCommerceControls\.isPending\}/);
  assert.match(screen, /disabled=\{saveCommerceControls\.isPending/);
  assert.match(screen, /aria-live="polite"/);
  assert.match(screen, /role="alert"/);
  assert.equal((screen.match(/type="radio"/g) ?? []).length, 4);
  assert.doesNotMatch(screen, /onChange=\{[^}]*mutate/);
});

test("운영 제어의 라디오와 저장 버튼은 44px 이상이며 좁은 화면에서 한 열로 정리된다", () => {
  const css = source("src/screens/admin/AdminAiPrompt.css");

  assert.match(css, /\.aap-commerce-option\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(css, /\.aap-commerce-save\s*\{[^}]*min-height:\s*48px/s);
  assert.match(css, /@media\s*\(max-width:\s*360px\)[\s\S]*?\.aap-commerce-options\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
