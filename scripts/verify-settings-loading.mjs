// 운영 세션 없이 부모 설정의 지연·실패·캐시 재진입 화면을 검증한다.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { mockApi, newDocumentScript } from './final-browser-qa.mjs';

const base = process.env.SETTINGS_QA_URL ?? 'http://127.0.0.1:4175';
const out = fileURLToPath(new URL('../artifacts/settings-20260920/', import.meta.url));
await mkdir(out, { recursive: true });
const results = [];
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const browser = await engine.launch({ headless: true });
  for (const scenario of ['profile-slow', 'subscription-slow', 'profile-error', 'subscription-error', 'profile-empty', 'cached-navigation']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript({ content: newDocumentScript() });
    let release;
    const gate = new Promise(resolveGate => { release = resolveGate; });
    let failed = scenario === 'profile-error' || scenario === 'subscription-error';
    let familyRequests = 0;
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === base) return route.continue();
      if (req.resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
      if (url.pathname === '/api/family/mine') {
        familyRequests++;
        if (scenario === 'profile-slow') await gate;
        if (scenario === 'profile-empty') return route.fulfill({ contentType: 'application/json', body: 'null' });
        if (failed && scenario === 'profile-error') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
      }
      if (failed && scenario === 'subscription-error' && url.pathname.includes('entitlement')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
      if (scenario === 'subscription-slow' && url.pathname.includes('entitlement')) await gate;
      let body = null; try { body = req.postDataJSON(); } catch {}
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(mockApi(url.pathname, { role: 'parent', tier: 'premium' }, req.method(), body) ?? {}) });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/${scenario === 'cached-navigation' ? 'parent/home' : 'parent/settings'}`);
    if (scenario === 'cached-navigation') {
      await page.locator('.ph-section-shell').first().waitFor();
      await page.waitForTimeout(1800);
      const before = familyRequests;
      await page.locator('.hy-tabbar').getByRole('button', { name: '설정', exact: true }).click();
      await page.locator('.ps-profile').waitFor();
      assert.equal(familyRequests, before, '캐시가 신선한 홈→설정 이동에서 가족 정보를 중복 요청했습니다');
    } else {
      await page.locator('.ps-head').waitFor();
      await page.waitForTimeout(1800);
    }
    await page.locator('.ps-nav').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('.ps-head').count(), 1);
    if (scenario === 'profile-slow') await page.locator('.ps-profile-pending').waitFor();
    if (scenario === 'subscription-slow') {
      await page.locator('.ps-profile').waitFor();
      assert.equal(await page.locator('.ps-account__badge').count(), 0, '미확정 구독을 무료로 표시했습니다');
    }
    if (scenario === 'profile-error') await page.locator('.sqs-card--error').waitFor({ timeout: 20000 });
    if (scenario === 'subscription-error') await page.locator('.ps-entitlement-retry').waitFor({ timeout: 20000 });
    if (scenario === 'profile-empty') await page.locator('.sqs-card--empty').waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.ps-content,.ps-profile-pending,.sqs-card')].some(el => el.scrollWidth > el.clientWidth + 1));
      assert.equal(overflow, false, `${name}/${scenario}/${width} 가로 넘침`);
      await page.screenshot({ path: resolve(out, `${name}-${scenario}-${width}.png`) });
    }
    if (scenario === 'profile-slow') {
      release(); await page.locator('.ps-profile').waitFor();
    } else if (scenario === 'subscription-slow') {
      release(); await page.locator('.ps-account__badge').waitFor();
    } else if (scenario === 'profile-error') {
      failed = false;
      await page.locator('.sqs-retry').click();
      await page.locator('.ps-profile').waitFor();
    }
    if (scenario === 'subscription-error') {
      failed = false; await page.locator('.ps-entitlement-retry button').click();
      await page.locator('.ps-account__badge').waitFor();
    }
    assert.deepEqual(errors, []);
    results.push({ engine: name, scenario, familyRequests, widths: [390, 320], errors });
    release(); await context.close();
  }
  await browser.close();
}
await writeFile(resolve(out, 'report.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
