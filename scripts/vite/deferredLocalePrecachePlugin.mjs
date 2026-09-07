/** 한국어·공통 부팅 문구는 보존하고 다른 언어의 화면 문구만 사용 시 내려받는다. */
export function isDeferredLocaleChunk(moduleIds) {
  let locale;
  return moduleIds.length > 0 && moduleIds.every((id) => {
    const match = id.replaceAll('\\', '/').match(/\/src\/i18n\/generated\/catalogs\/([^/]+)\/([^/]+)\.ts$/);
    if (!match || match[1] === 'ko' || match[2] === 'core') return false;
    locale ??= match[1];
    return match[1] === locale;
  });
}

export function deferredLocalePrecachePlugin(deferredUrls) {
  return {
    name: 'hyeni-deferred-locale-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      deferredUrls.clear();
      const byLocale = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && isDeferredLocaleChunk(Object.keys(chunk.modules))) {
          deferredUrls.add(chunk.fileName);
          const locale = Object.keys(chunk.modules)[0].replaceAll('\\', '/').match(/\/catalogs\/([^/]+)\//)[1];
          (byLocale[locale] ??= []).push(chunk.fileName);
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'deferred-locale-chunks.json',
        source: JSON.stringify(Object.fromEntries(Object.entries(byLocale).sort().map(([locale, urls]) => [locale, urls.sort()]))),
      });
    },
  };
}
