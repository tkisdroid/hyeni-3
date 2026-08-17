import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "settings-copy-verify");
mkdirSync(outDir, { recursive: true });

const payload = Buffer.from(JSON.stringify({
  sub: "parent-verify",
  role: "parent",
  family_id: "fam-verify",
  is_anonymous: false,
})).toString("base64url");
const access = `eyJhbGciOiJub25lIn0.${payload}.x`;

const family = {
  familyId: "fam-verify",
  myName: "엄마",
  myRole: "parent",
  parentName: "엄마",
  isPrimaryParent: true,
  isCoParent: false,
  members: [
    { id: "m-parent", user_id: "parent-verify", role: "parent", name: "엄마", gender: "mom", is_active: 1 },
    { id: "m-child", user_id: "child-verify", role: "child", name: "혜니", emoji: "🐰", is_active: 1 },
  ],
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.includes("/api/family/mine")) return route.fulfill(json(family));
  if (url.includes("/api/notif-settings/family")) {
    return route.fulfill(json({
      family_id: "fam-verify",
      recipients: [
        {
          target_user_id: "parent-verify",
          role: "parent",
          enabled: false,
          start_minute: 1320,
          end_minute: 420,
          updated_at: null,
          configured: false,
        },
        {
          target_user_id: "child-verify",
          role: "child",
          enabled: false,
          start_minute: 1320,
          end_minute: 420,
          updated_at: null,
          configured: false,
        },
      ],
    }));
  }
  if (url.includes("/api/notif-settings")) {
    return route.fulfill(json({
      user_id: "parent-verify",
      family_id: "fam-verify",
      child_enabled: true,
      parent_enabled: true,
      location_enabled: true,
      registered_place_enabled: true,
      playdate_enabled: true,
      minutes_before: [15, 5],
      quiet_hours: { enabled: false, start_minute: 1320, end_minute: 420, updated_at: null, configured: false },
    }));
  }
  if (url.includes("/api/location-prefs")) {
    return route.fulfill(json({
      family_id: "fam-verify",
      background_enabled: true,
      interval_mode: "balanced",
      battery_saver_exception: true,
    }));
  }
  if (url.includes("/api/entitlement")) {
    return route.fulfill(json({
      family: { user_tier: "free" },
    }));
  }
  if (url.includes("/api/") && !url.includes("localhost:5217") && !url.includes("127.0.0.1:5217")) {
    return route.fulfill(json({}));
  }
  return route.continue();
});

await page.addInitScript(({ access, user }) => {
  localStorage.setItem("hyeni-api-session-v1", JSON.stringify({
    access,
    refresh: "refresh-verify",
    user,
    session_instance_id: "sess-verify",
  }));
}, {
  access,
  user: { id: "parent-verify", role: "parent", family_id: "fam-verify", is_anonymous: false },
});

async function openHash(hash) {
  await page.goto(`http://127.0.0.1:5217/${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
}

await openHash("#/notification-settings");
const chipMetrics = await page.evaluate(() => {
  const row = document.querySelector(".nst-minutes__row");
  const chips = [...document.querySelectorAll(".nst-minutes__row .nst-minute")];
  if (!row || chips.length === 0) {
    return { found: false, labels: chips.map((chip) => chip.textContent?.trim() ?? "") };
  }
  const rowBox = row.getBoundingClientRect();
  const tops = chips.map((chip) => Math.round(chip.getBoundingClientRect().top));
  const sameRow = tops.every((top) => top === tops[0]);
  return {
    found: true,
    labels: chips.map((chip) => chip.textContent?.trim() ?? ""),
    ariaLabels: chips.map((chip) => chip.getAttribute("aria-label") ?? ""),
    count: chips.length,
    rowWidth: Math.round(rowBox.width),
    tops,
    sameRow,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    subs: [...document.querySelectorAll(".nst-row__sub")].map((el) => el.textContent?.trim() ?? ""),
    safety: [...document.querySelectorAll(".nst-safety-note .hy-explain__line")].map((el) => el.textContent?.trim() ?? ""),
    quiet: [...document.querySelectorAll(".nst-quiet__copy p")].map((el) => el.textContent?.trim() ?? ""),
  };
});
await page.screenshot({ path: resolve(outDir, "notification-settings-390.png"), fullPage: true });

await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(400);
const chipMetrics360 = await page.evaluate(() => {
  const chips = [...document.querySelectorAll(".nst-minutes__row .nst-minute")];
  const tops = chips.map((chip) => Math.round(chip.getBoundingClientRect().top));
  return {
    labels: chips.map((chip) => chip.textContent?.trim() ?? ""),
    sameRow: chips.length > 0 && tops.every((top) => top === tops[0]),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
await page.screenshot({ path: resolve(outDir, "notification-settings-360.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await openHash("#/location-settings");
const locationCopy = await page.evaluate(() => ({
  desc: document.querySelector(".lset-desc")?.textContent?.trim() ?? "",
  notes: [...document.querySelectorAll(".lset-note .hy-explain__line")].map((el) => el.textContent?.trim() ?? ""),
  title: document.querySelector(".lset-title")?.textContent?.trim() ?? "",
}));
await page.screenshot({ path: resolve(outDir, "location-settings.png"), fullPage: true });

await openHash("#/parent/settings");
const parentSettings = await page.evaluate(() => ({
  title: document.querySelector(".ps-head-title")?.textContent?.trim() ?? "",
  rows: [...document.querySelectorAll(".ps-nav__label, .ps-feature__label, .ps-account__label")].map((el) => el.textContent?.trim() ?? ""),
}));
await page.screenshot({ path: resolve(outDir, "parent-settings.png"), fullPage: true });

await openHash("#/data-sync");
const dataSync = await page.evaluate(() => ({
  title: document.querySelector(".ds-head-title")?.textContent?.trim() ?? "",
  descs: [...document.querySelectorAll(".ds-card__desc, .ds-note")].map((el) => el.textContent?.trim() ?? ""),
}));
await page.screenshot({ path: resolve(outDir, "data-sync.png"), fullPage: true });

const result = { chipMetrics, chipMetrics360, locationCopy, parentSettings, dataSync };
writeFileSync(resolve(outDir, "report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

await browser.close();
if (!chipMetrics.found || !chipMetrics.sameRow || !chipMetrics360.sameRow) {
  process.exit(1);
}
