import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "child-ai-fab-verify");
mkdirSync(outDir, { recursive: true });

const payload = Buffer.from(JSON.stringify({
  sub: "child-verify",
  role: "child",
  family_id: "fam-verify",
  is_anonymous: false,
})).toString("base64url");
const access = `eyJhbGciOiJub25lIn0.${payload}.x`;

const family = {
  id: "fam-verify",
  members: [
    { id: "m-child", user_id: "child-verify", role: "child", name: "혜니", emoji: "🐰", is_active: 1 },
    { id: "m-parent", user_id: "parent-verify", role: "parent", name: "엄마", gender: "mom", is_active: 1 },
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
  if (url.includes("/api/ai/settings/friend")) {
    return route.fulfill(json({ ai_enabled: true, ai_friend_name: "통통이", daily_limit: 5 }));
  }
  if (url.includes("/api/ai/credits/public") || url.includes("/api/ai/usage/today")) {
    return route.fulfill(json({
      is_premium: false,
      daily_included_limit: 5,
      daily_included_used: 1,
      daily_reset_date: "2026-08-17",
      purchased_credits: 0,
      parent_daily_used: 1,
      parent_daily_limit: 5,
      available_remaining: 4,
      remaining: 4,
      daily_limit: 5,
    }));
  }
  if (url.includes("/api/ai/messages")) return route.fulfill(json([]));
  if (url.includes("/api/events")) return route.fulfill(json([]));
  if (url.includes("/api/daily-supplies")) return route.fulfill(json([]));
  if (url.includes("/api/saved-places") || url.includes("/api/location")) return route.fulfill(json([]));
  if (url.includes("/api/stickers")) return route.fulfill(json([]));
  if (url.includes("/api/notif") || url.includes("/api/notification")) {
    return route.fulfill(json({
      minutes_before: [15, 5],
      quiet_hours: { enabled: false, start_minute: 1320, end_minute: 420, updated_at: null, configured: true },
    }));
  }
  if (url.includes("/api/ai/child-chat") && route.request().method() === "POST") {
    return route.fulfill(json({
      reply: "안녕! 오늘 준비물 같이 챙기자.",
      remaining: 3,
      emotion: "happy",
      detectedIntent: "general_chat",
      assistantMessageId: "msg-1",
    }));
  }
  if (url.includes("/api/") && !url.includes("localhost:5199") && !url.includes("127.0.0.1:5199")) {
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
  user: { id: "child-verify", role: "child", family_id: "fam-verify", is_anonymous: false },
});

await page.goto("http://localhost:5199/#/child/home", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const fab = page.locator(".caf");
const homeHasFab = await fab.isVisible();
const fabMetrics = homeHasFab
  ? await fab.evaluate((el) => {
      const style = getComputedStyle(el);
      const img = el.querySelector("img");
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        imgSrc: img?.getAttribute("src") || "",
      };
    })
  : null;
await page.screenshot({ path: resolve(outDir, "child-home-fab.png") });
if (homeHasFab) await fab.click();
await page.waitForTimeout(1400);
const chatVisible = await page.locator(".afc").isVisible();
const chatMetrics = chatVisible
  ? await page.evaluate(() => {
      const avatar = document.querySelector(".afc-avatar img");
      const mini = document.querySelector(".afc-mini img");
      return {
        avatarSrc: avatar?.getAttribute("src") || "",
        miniSrc: mini?.getAttribute("src") || "",
      };
    })
  : null;
await page.screenshot({ path: resolve(outDir, "child-ai-chat.png") });

const sameFamily = Boolean(
  fabMetrics?.imgSrc.includes("mascot-status")
  && chatMetrics?.avatarSrc.includes("mascot-status")
  && chatMetrics?.miniSrc.includes("mascot-status")
  && !chatMetrics?.miniSrc.includes("/animal/"),
);
const transparentFab = fabMetrics?.backgroundColor === "rgba(0, 0, 0, 0)"
  || fabMetrics?.backgroundColor === "transparent";

const report = {
  homeHasFab,
  chatVisible,
  fabMetrics,
  chatMetrics,
  sameFamily,
  transparentFab,
  url: page.url(),
};
writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (!homeHasFab || !chatVisible || !sameFamily || !transparentFab) process.exit(1);
