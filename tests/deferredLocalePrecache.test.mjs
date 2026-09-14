import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeferredLocaleChunk } from '../scripts/vite/deferredLocalePrecachePlugin.mjs';

test('추가 언어의 순수 화면 카탈로그만 지연하고 부팅·한국어·혼합 청크는 보존한다', () => {
  const prefix = '/project/src/i18n/generated/catalogs/';
  assert.equal(isDeferredLocaleChunk([`${prefix}en/parent.ts`]), true);
  assert.equal(isDeferredLocaleChunk([`${prefix}ko/parent.ts`]), false);
  assert.equal(isDeferredLocaleChunk([`${prefix}en/core.ts`]), false);
  assert.equal(isDeferredLocaleChunk([`${prefix}en/parent.ts`, '/project/src/app/App.tsx']), false);
  assert.equal(isDeferredLocaleChunk([`${prefix}en/parent.ts`, `${prefix}ja/parent.ts`]), false);
  assert.equal(isDeferredLocaleChunk([]), false);
});
