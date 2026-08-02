import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Free 위치 설정의 실시간 모드는 저장보다 먼저 상황형 업셀로 닫는다", () => {
  const source = read("src/screens/feature/LocationSettings.tsx");
  const pickStart = source.indexOf("const pickInterval");
  const premiumGate = source.indexOf('interval === "live" && tier !== TIERS.PREMIUM', pickStart);
  const mutation = source.indexOf("void update(`interval:${interval}`", pickStart);

  assert.ok(pickStart >= 0 && premiumGate > pickStart && mutation > premiumGate);
  assert.match(source.slice(premiumGate, mutation), /setLiveUpsellOpen\(true\)/);
  assert.match(source, /source="location_live_interval"/);
  assert.match(source, /실시간 위치 전송 \(프리미엄\)/);
});

test("결제 복귀 live 초안은 미저장 선택으로 복원하고 사용자 확인 뒤에만 저장한다", () => {
  const source = read("src/screens/feature/LocationSettings.tsx");
  const pendingSave = source.indexOf("const savePendingInterval");
  const pendingButton = source.indexOf("void savePendingInterval()", pendingSave);
  const upgrade = source.indexOf("source=\"location_live_interval\"");
  const saveIntent = source.indexOf("const saved = storage && returnTo", upgrade);
  const navigate = source.indexOf('navigate("/subscription")', saveIntent);

  assert.match(source, /useLocation/);
  assert.match(source, /premiumReturnSource\?: string/);
  assert.match(source, /premiumEntitlementConfirmed\?: boolean/);
  assert.match(source, /premiumReturnDraft\?: unknown/);
  assert.match(source, /restoredLiveIntervalIntent\(routeState\)/);
  assert.match(source, /const selectedInterval = pendingInterval \?\? prefs\.interval/);
  assert.match(source, /pendingInterval === "live"/);
  assert.ok(pendingSave >= 0 && pendingButton > pendingSave);
  assert.match(source.slice(pendingSave, pendingButton), /update\("return-live", \{ interval: "live" \}/);
  assert.match(source, /아직 저장되지 않았어요/);
  assert.ok(upgrade >= 0 && saveIntent > upgrade && navigate > saveIntent);
  assert.match(source.slice(saveIntent, navigate), /savePremiumReturnIntent/);
  assert.match(source.slice(saveIntent, navigate), /if \(!saved\) throw new Error/);

  const effects = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[[^\]]*\]\);/g)]
    .map((match) => match[1])
    .join("\n");
  assert.doesNotMatch(effects, /savePendingInterval|update\("return-live"|savePreferences\.mutateAsync/);
});

test("Worker는 Free의 live 저장과 만료 뒤 저장된 live 재노출을 서버에서 차단한다", () => {
  const source = read("worker/routes/location-prefs.ts");
  assert.match(source, /resolveFamilyEntitlement/);
  assert.match(source, /effectiveLocationIntervalMode/);
  assert.match(source, /premium_required/);
  assert.match(source, /location_entitlement_unavailable/);
});
