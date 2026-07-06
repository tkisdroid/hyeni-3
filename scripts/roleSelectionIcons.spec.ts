import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROLE_ICON_ASSETS } from "../src/transform/roleIconAssets";

assert.equal(ROLE_ICON_ASSETS.parent, "ui/parent-mom.webp");
assert.equal(ROLE_ICON_ASSETS.child, "mascot/wave.webp");
assert.equal(ROLE_ICON_ASSETS.teacher, "mascot/teacher-glasses.webp");

for (const path of Object.values(ROLE_ICON_ASSETS)) {
  assert.equal(existsSync(join("public", "assets", path)), true, `${path} 파일이 public/assets 아래에 있어야 해요`);
}

const onboarding = readFileSync("src/screens/onboarding/Onboarding.tsx", "utf8");

assert.match(onboarding, /ROLE_ICON_ASSETS\.parent/);
assert.match(onboarding, /ROLE_ICON_ASSETS\.child/);
assert.match(onboarding, /ROLE_ICON_ASSETS\.teacher/);

console.log("roleSelectionIcons contract ok");
