import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(
  new URL("../src/screens/feature/LocationSettings.tsx", import.meta.url),
  "utf8",
);
const locationHook = readFileSync(
  new URL("../src/queries/useLocation.ts", import.meta.url),
  "utf8",
);

test("위치 설정은 현재 가족의 서버 snapshot을 state에 hydrate한 뒤에만 컨트롤을 연다", () => {
  assert.match(screen, /const \[hydratedFamilyId, setHydratedFamilyId\] = useState<string \| null>\(null\)/);
  assert.match(screen, /const \[hydratedPreferencesKey, setHydratedPreferencesKey\] = useState<string \| null>\(null\)/);
  assert.match(
    screen,
    /locationSettingsDataReady[\s\S]{0,320}hydratedFamilyId === familyId[\s\S]{0,160}hydratedPreferencesKey === serverPreferencesKey/,
  );
  assert.match(screen, /locationSettingsQueryState === "loading" \|\| locationSettingsHydrating/);
  assert.match(screen, /disabled=\{saving \|\| !locationSettingsDataReady\}/);
});

test("가족 scope가 바뀌면 이전 초안과 늦게 끝난 저장 응답은 새 가족에 적용하지 않는다", () => {
  assert.match(
    screen,
    /setHydratedFamilyId\(null\);[\s\S]{0,120}setHydratedPreferencesKey\(null\);[\s\S]{0,120}\}, \[familyId\]\)/,
  );
  assert.match(screen, /const updateFamilyId = familyId;/);
  assert.match(screen, /currentFamilyIdRef\.current !== updateFamilyId/);
  assert.match(
    screen,
    /setPrefs\(confirmed\);[\s\S]{0,120}setHydratedFamilyId\(updateFamilyId\);[\s\S]{0,120}setHydratedPreferencesKey\(/,
  );
});

test("위치 설정 저장 mutation은 시작 가족을 variables로 고정해 정확한 cache만 갱신한다", () => {
  assert.match(
    locationHook,
    /mutationFn: \(\{ familyId, prefs \}: SaveLocationPreferencesVariables\)[\s\S]{0,180}saveLocationPreferences\(familyId, prefs\)/,
  );
  assert.match(
    locationHook,
    /onSuccess: \(saved, \{ familyId \}\)[\s\S]{0,160}saved\.family_id !== familyId[\s\S]{0,200}qk\.locationPreferences\(familyId\)/,
  );
  assert.doesNotMatch(
    locationHook,
    /export function useSaveLocationPreferences\(\)[\s\S]{0,160}const \{ familyId \} = useAuth\(\)/,
  );
  assert.match(
    screen,
    /savePreferences\.mutateAsync\(\{[\s\S]{0,100}familyId: updateFamilyId,[\s\S]{0,100}prefs: \{/,
  );
});
